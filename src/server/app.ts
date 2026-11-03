import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import type { ArticleTask } from '../shared/types.js';
import { AppError } from './errors.js';
import { draftDescription, generateCover, getProviderStatuses, isCodexModelAllowed, stopCodexTasks } from './provider.js';
import { createTask, emitProgress, getTask, subscribeTask, updateTask } from './task-store.js';
import { readZipPackage, type PackageFile } from './package-input.js';
import { prepareTarget, publishTask, stopAllPreviews } from './target-blog.js';

type ApplicationOptions = { vite?: ViteDevServer };

function localSessionCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie ?? '';
  return cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('local_session='))?.slice('local_session='.length);
}

function validateText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`${field}不能为空。`);
  return value.trim();
}

function getModel(body: unknown, imageOnly = false): string {
  if (!body || typeof body !== 'object') throw new AppError('缺少模型选择。');
  const model = (body as { model?: unknown }).model;
  if (typeof model !== 'string' || !isCodexModelAllowed(model, imageOnly)) {
    throw new AppError(imageOnly ? '当前只开放此前完成过生图实测的Codex推理模型。' : '请选择Codex当前模型目录中的模型。');
  }
  return model;
}

export async function createApplication(options: ApplicationOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: false, bodyLimit: 270 * 1024 * 1024 });
  const session = randomBytes(32).toString('hex');
  await app.register(multipart, { limits: { parts: 2_001, files: 2_000, fileSize: 100 * 1024 * 1024, fields: 1, fieldSize: 4 * 1024 * 1024 } });

  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host ?? '';
    const hostname = host.split(':')[0].replace(/^\[|\]$/g, '');
    if (hostname !== 'localhost') {
      reply.code(403).send({ error: '本地工具只接受 localhost 访问。' });
      return;
    }
    const address = request.raw.socket.remoteAddress ?? '';
    if (!(address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1')) {
      reply.code(403).send({ error: '请求来源不是本机回环接口。' });
      return;
    }
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname === '/') {
      reply.header('Set-Cookie', `local_session=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200`);
    }
    if (!url.pathname.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'http:' || parsed.host !== host) {
          reply.code(403).send({ error: '只接受本地同源请求。' });
          return;
        }
      } catch {
        reply.code(403).send({ error: '请求来源无效。' });
        return;
      }
    }
    if (localSessionCookie(request) !== session) {
      reply.code(401).send({ error: '本地会话已失效，请重新打开工具页面。' });
      return;
    }
    reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = error instanceof AppError ? error.statusCode : Number((error as { statusCode?: number }).statusCode) || 500;
    reply.code(statusCode).send({ error: error instanceof Error ? error.message : '本地服务发生错误。' });
  });

  app.get('/api/providers', async () => ({ providers: await getProviderStatuses() }));

  app.post('/api/tasks/import', async (request) => {
    let manifestRaw = '';
    const uploaded: Buffer[] = [];
    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'manifest' && typeof part.value === 'string') manifestRaw = part.value;
      else if (part.type === 'file' && part.fieldname === 'files') uploaded.push(await part.toBuffer());
      else throw new AppError('导入表单格式无效。', 400);
    }
    if (!uploaded.length || !manifestRaw) throw new AppError('请选择Markdown、HTML、目录或ZIP文件。');
    let inputManifest: unknown;
    try { inputManifest = JSON.parse(manifestRaw); } catch { throw new AppError('导入文件清单不是有效JSON。', 400); }
    if (!Array.isArray(inputManifest) || inputManifest.length !== uploaded.length || inputManifest.some((item) => !item || typeof item.path !== 'string')) {
      throw new AppError('导入文件清单与上传文件数不一致。', 400);
    }
    const entries = inputManifest as Array<{ path: string }>;
    const sourceName = path.basename(entries[0]!.path);
    let files: PackageFile[];
    if (/\.zip$/i.test(entries[0]!.path)) {
      if (uploaded.length !== 1) throw new AppError('ZIP只能作为单个导入文件上传。', 400);
      files = await readZipPackage(uploaded[0]!);
    } else {
      if (entries.some((entry) => /\.zip$/i.test(entry.path))) throw new AppError('ZIP不能与目录文件混合上传。', 400);
      files = entries.map((entry, index) => ({ path: entry.path, bytes: uploaded[index]! }));
    }
    stopAllPreviews();
    const task = await createTask(sourceName, files);
    return { task };
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request) => ({ task: getTask(request.params.id).task }));

  app.post<{ Params: { id: string }; Body: Partial<ArticleTask> }>('/api/tasks/:id', async (request) => ({ task: await updateTask(request.params.id, request.body ?? {}) }));

  app.get<{ Params: { id: string } }>('/api/tasks/:id/cover', async (request, reply) => {
    const record = getTask(request.params.id);
    if (!record.coverFile || !record.task.cover) throw new AppError('这篇文章还没有可预览的封面。', 404);
    const bytes = await readFile(record.coverFile);
    reply.type(record.task.cover.mimeType).header('Content-Length', String(bytes.length)).header('Cache-Control', 'no-store').send(bytes);
  });

  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (request, reply) => {
    const record = getTask(request.params.id);
    const raw = reply.raw;
    reply.hijack();
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write(`event: snapshot\ndata: ${JSON.stringify({ task: record.task })}\n\n`);
    const unsubscribe = subscribeTask(request.params.id, (event) => raw.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`));
    const keepalive = setInterval(() => raw.write(': keepalive\n\n'), 20_000);
    raw.on('close', () => { clearInterval(keepalive); unsubscribe(); });
  });

  app.post<{ Params: { id: string }; Body: { model?: string } }>('/api/tasks/:id/description', async (request) => {
    const record = getTask(request.params.id);
    const model = getModel(request.body);
    emitProgress(record.task.id, 'description', 'running', 'Codex正在阅读文章并起草摘要…');
    try {
      const description = await draftDescription({ model, title: record.task.title, body: record.task.body, workDir: record.workDir });
      const task = await updateTask(record.task.id, { description });
      emitProgress(record.task.id, 'description', 'complete', '摘要草稿已返回，可继续编辑。');
      return { task };
    } catch (cause) {
      emitProgress(record.task.id, 'description', 'failed', cause instanceof Error ? cause.message : '摘要生成失败');
      throw cause;
    }
  });

  app.post<{ Params: { id: string }; Body: { model?: string } }>('/api/tasks/:id/cover', async (request) => {
    const record = getTask(request.params.id);
    const model = getModel(request.body, true);
    const priorStatus = record.task.cover ? 'ready' : 'draft';
    record.task.status = 'generating';
    record.task.error = undefined;
    emitProgress(record.task.id, 'cover', 'running', 'Codex正在生成封面候选…');
    try {
      const result = await generateCover({ model, prompt: record.task.prompt, title: record.task.title, body: record.task.body, workDir: record.workDir });
      record.coverFile = result.file;
      record.coverPromptNote = result.note;
      record.task.cover = result.artifact;
      record.task.status = 'ready';
      record.task.error = undefined;
      emitProgress(record.task.id, 'cover', 'complete', result.note);
      return { task: record.task };
    } catch (cause) {
      record.task.status = priorStatus;
      record.task.error = cause instanceof Error ? cause.message : '封面生成失败';
      emitProgress(record.task.id, 'cover', 'failed', record.task.error);
      throw cause;
    }
  });

  app.post<{ Params: { id: string }; Body: { targetPath?: string } }>('/api/tasks/:id/prepare', async (request) => {
    const record = getTask(request.params.id);
    const targetPath = validateText(request.body?.targetPath, '目标路径');
    const emit = (stage: 'prepare' | 'preview', status: 'running' | 'complete' | 'failed', message: string) => emitProgress(record.task.id, stage, status, message);
    const result = await prepareTarget(record, targetPath, emit);
    return { task: record.task, context: result.context };
  });

  app.post<{ Params: { id: string }; Body: { confirm?: string } }>('/api/tasks/:id/publish', async (request) => {
    if (request.body?.confirm !== 'commit-and-push') throw new AppError('需要从发布确认页面明确确认本次提交和推送。', 403);
    const record = getTask(request.params.id);
    const emit = (stage: 'publish', status: 'running' | 'complete' | 'failed', message: string) => emitProgress(record.task.id, stage, status, message);
    const task = await publishTask(record, emit);
    return { task };
  });

  if (options.vite) {
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET') return reply.code(404).send({ error: '找不到此本地资源。' });
      const raw = reply.raw;
      reply.hijack();
      if (new URL(request.url, 'http://localhost').pathname === '/') {
        raw.setHeader('Set-Cookie', `local_session=${session}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=43200`);
      }
      await new Promise<void>((resolve) => {
        let completed = false;
        const finish = () => { if (!completed) { completed = true; resolve(); } };
        raw.once('finish', finish);
        options.vite!.middlewares(request.raw, raw, (cause?: Error) => {
          if (cause && !raw.headersSent) {
            raw.statusCode = 500;
            raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
            raw.end('Vite middleware failed.');
          } else if (!raw.writableEnded) {
            raw.statusCode = 404;
            raw.end('Not found');
          }
          finish();
        });
      });
    });
  } else {
    const staticRoot = path.resolve(process.cwd(), 'dist/client');
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) return reply.code(404).send({ error: '找不到此本地资源。' });
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
      const candidate = path.resolve(staticRoot, pathname || 'index.html');
      if (!candidate.startsWith(`${staticRoot}${path.sep}`) && candidate !== staticRoot) return reply.code(400).send({ error: '无效资源路径。' });
      return reply.sendFile(await (await import('node:fs/promises')).access(candidate).then(() => pathname || 'index.html').catch(() => 'index.html'));
    });
  }

  app.addHook('onClose', async () => { stopAllPreviews(); stopCodexTasks(); });
  return app;
}
