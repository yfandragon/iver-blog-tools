import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { access, copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { ImageArtifact, ModelInfo, ProviderStatus } from '../shared/types.js';
import { AppError } from './errors.js';

const knownCodexImageModel = 'gpt-6.1-sol';
const cli = process.env.CODEX_BIN || 'codex';
const activeCodex = new Set<ChildProcessWithoutNullStreams>();
let runtimeModelIds = new Set([knownCodexImageModel]);

type CatalogModel = { id?: unknown; model?: unknown; displayName?: unknown; hidden?: unknown };

async function readCodexModelCatalog(timeoutMs = 8_000): Promise<CatalogModel[] | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cli, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      shell: false,
    });
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    const models: CatalogModel[] = [];
    const seenCursors = new Set<string>();
    let finished = false;
    let initialized = false;
    let requestId = 1;
    let timeout: NodeJS.Timeout;

    const finish = (result?: CatalogModel[]) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      lines.close();
      child.kill('SIGTERM');
      resolve(result);
    };
    const sendModelPage = (cursor?: string) => {
      const params: Record<string, unknown> = { limit: 100, includeHidden: false };
      if (cursor) params.cursor = cursor;
      child.stdin.write(`${JSON.stringify({ method: 'model/list', id: requestId, params })}\n`);
    };

    timeout = setTimeout(() => finish(undefined), timeoutMs);
    child.once('error', () => finish(undefined));
    child.once('close', () => finish(undefined));
    lines.on('line', (line) => {
      let message: { id?: unknown; result?: { data?: CatalogModel[]; nextCursor?: unknown }; error?: unknown };
      try { message = JSON.parse(line) as typeof message; } catch { return; }
      if (message.id === 0) {
        if (message.error || initialized) return finish(undefined);
        initialized = true;
        child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
        sendModelPage();
        return;
      }
      if (message.id !== requestId) return;
      if (message.error || !Array.isArray(message.result?.data)) return finish(undefined);
      models.push(...message.result.data.filter((item) => item && item.hidden !== true));
      const cursor = message.result.nextCursor;
      if (typeof cursor === 'string' && cursor && models.length < 500 && !seenCursors.has(cursor)) {
        seenCursors.add(cursor);
        requestId += 1;
        sendModelPage(cursor);
        return;
      }
      finish(models);
    });

    child.stdin.write(`${JSON.stringify({
      method: 'initialize', id: 0,
      params: { clientInfo: { name: 'iverblog_tools', title: 'IverBlog Tools', version: '0.1.0' } },
    })}\n`);
  });
}

export function isCodexModelAllowed(model: string, imageOnly = false): boolean {
  return runtimeModelIds.has(model) && (!imageOnly || model === knownCodexImageModel);
}

function stopCodex(child: ChildProcessWithoutNullStreams): void {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); return; } catch { /* fall through to direct process signal */ }
  }
  child.kill('SIGTERM');
}

export function stopCodexTasks(): void {
  for (const child of activeCodex) stopCodex(child);
  activeCodex.clear();
}

async function findCodexVersion(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cli, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.once('error', () => resolve(undefined));
    child.once('close', (code) => resolve(code === 0 ? output.trim() : undefined));
  });
}

export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const version = await findCodexVersion();
  const catalog = version ? await readCodexModelCatalog() : undefined;
  const models: ModelInfo[] = [];
  const catalogIds = new Set<string>();
  for (const entry of catalog ?? []) {
    const id = typeof entry.id === 'string' ? entry.id : typeof entry.model === 'string' ? entry.model : undefined;
    if (!id || !/^[a-zA-Z0-9_.-]+$/.test(id) || catalogIds.has(id)) continue;
    catalogIds.add(id);
    models.push({
      id,
      displayName: typeof entry.displayName === 'string' ? entry.displayName : id,
      available: 'catalog',
      imageCapability: id === knownCodexImageModel ? 'verified' : 'unverified',
    });
  }
  if (version && !catalogIds.has(knownCodexImageModel)) {
    models.push({
      id: knownCodexImageModel,
      displayName: knownCodexImageModel,
      available: 'unknown',
      imageCapability: 'verified',
    });
  }
  runtimeModelIds = new Set(models.map((model) => model.id));
  return [
    {
      id: 'codex',
      label: 'Codex CLI',
      installed: Boolean(version),
      enabled: Boolean(version),
      version,
      message: version
        ? catalog
          ? `${version} · 已通过官方 app-server model/list 读取模型目录；目录不代表当前账号对模型有调用权限，生图能力单独标注。`
          : `${version} · 本地CLI可运行；读取 model/list 失败，显示历史实测路径作为待确认项。`
        : '未找到 codex CLI，请安装并完成登录。',
      models,
    },
    {
      id: 'antigravity',
      label: 'Antigravity CLI',
      installed: false,
      enabled: false,
      message: '许可确认前保持关闭；不会检查或启动 agy。',
      models: [],
    },
  ];
}

function runCodex(args: string[], cwd: string, prompt: string, timeoutMs: number, onChunk?: (chunk: string) => void): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(cli, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    });
    activeCodex.add(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stopCodex(child);
      setTimeout(() => {
        if (process.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* fall through */ }
        }
        child.kill('SIGKILL');
      }, 3_000).unref();
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-400_000);
      onChunk?.(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-40_000); });
    child.once('error', (cause) => { clearTimeout(timer); activeCodex.delete(child); reject(new AppError(`无法启动 Codex CLI：${cause.message}`, 503)); });
    child.once('close', (code) => { clearTimeout(timer); activeCodex.delete(child); resolve({ code: code ?? -1, stdout, stderr }); });
    child.stdin.end(prompt);
  });
}

async function readImageArtifact(file: string, originalName: string): Promise<ImageArtifact> {
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new AppError('生成文件为空或超过30 MB。', 422);
  let image;
  try {
    image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) {
      throw new Error('仅支持PNG、JPEG或WebP图片。');
    }
    // Force a full decode so a plausible header cannot pass as a real artifact.
    await image.clone().raw().toBuffer();
    const mimeType = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}` as ImageArtifact['mimeType'];
    return {
      originalName,
      mimeType,
      width: metadata.width,
      height: metadata.height,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (cause) {
    throw new AppError(`找到图片文件，但无法通过完整解码校验：${cause instanceof Error ? cause.message : '未知图片错误'}`, 422);
  }
}

async function latestImage(directory: string, before: Set<string>): Promise<string | undefined> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (/\.(?:png|jpe?g|webp)$/i.test(entry.name) && !before.has(full)) files.push(full);
    }
  }
  await visit(directory);
  const candidates = await Promise.all(files.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })));
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.file;
}

async function imageFiles(directory: string): Promise<Set<string>> {
  const found = new Set<string>();
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (/\.(?:png|jpe?g|webp)$/i.test(entry.name)) found.add(full);
    }
  }
  await visit(directory);
  return found;
}

export async function draftDescription(options: { model: string; title: string; body: string; workDir: string }): Promise<string> {
  if (!runtimeModelIds.has(options.model)) throw new AppError('请选择当前Codex目录中列出的模型。', 400);
  const prompt = [
    '请根据下面的Markdown文章起草一条中文摘要。只输出摘要正文，不要引号、标题或解释。摘要应准确、简洁，约40到100个汉字；不要添加正文没有的事实。',
    `文章标题：${options.title}`,
    '文章正文开始：',
    options.body,
    '文章正文结束。',
  ].join('\n\n');
  const result = await runCodex(['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', options.model, '--output-last-message', path.join(options.workDir, 'description.txt'), '-'], options.workDir, prompt, 180_000);
  if (result.code !== 0) throw new AppError(`Codex 摘要任务失败（退出码 ${result.code}）：${result.stderr.trim().slice(-1200) || '没有错误详情'}`, 502);
  const answer = (await readFile(path.join(options.workDir, 'description.txt'), 'utf8')).trim();
  if (!answer) throw new AppError('Codex 没有返回摘要文本。', 502);
  return answer.replace(/^['"“”]+|['"“”]+$/g, '').trim();
}

export async function generateCover(options: { model: string; prompt: string; title: string; body: string; workDir: string }): Promise<{ artifact: ImageArtifact; file: string; note: string }> {
  if (options.model !== knownCodexImageModel || !runtimeModelIds.has(options.model)) throw new AppError('此版本只允许使用目录可见或历史实测的Codex生图模型。', 400);
  const outputDirectory = path.join(options.workDir, 'generated');
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `cover-${randomUUID()}`);
  const before = await imageFiles(options.workDir);
  const prompt = [
    '使用 Codex 当前可用的原生图像生成工具生成封面图片。必须创建真实的PNG、JPEG或WebP文件；不要只回复Markdown链接或描述。',
    `请把一张最终图片文件保存在这个精确路径：${outputFile}.png`,
    '如果图像工具会自行决定扩展名，请将它生成的文件写在本次工作目录内。不要覆盖目录中已有文件。',
    `本次可编辑的提示词副本：\n${options.prompt}`,
    `文章标题：${options.title}`,
    '以下文章正文只用于理解主题，不得改写或输出：',
    options.body.slice(0, 80_000),
  ].join('\n\n');
  const result = await runCodex([
    'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write',
    '--model', options.model, '--json', '--output-last-message', path.join(options.workDir, 'cover-result.txt'), '-',
  ], options.workDir, prompt, 8 * 60_000);
  if (result.code !== 0) throw new AppError(`Codex 封面任务失败（退出码 ${result.code}）：${result.stderr.trim().slice(-1600) || '没有错误详情'}`, 502);
  let candidate = await access(`${outputFile}.png`).then(() => `${outputFile}.png`).catch(() => undefined);
  if (!candidate) candidate = await latestImage(options.workDir, before);
  if (!candidate) throw new AppError('Codex 任务已结束，但没有找到本次新生成的图片文件；不会把文字回复当作生图成功。', 422);
  const artifact = await readImageArtifact(candidate, path.basename(candidate));
  const stableFile = path.join(options.workDir, `cover-${randomUUID()}.${artifact.mimeType.split('/')[1].replace('jpeg', 'jpg')}`);
  await copyFile(candidate, stableFile);
  await access(stableFile);
  const finalArtifact = await readImageArtifact(stableFile, artifact.originalName);
  return { artifact: finalArtifact, file: stableFile, note: '实际文件已完整解码并校验尺寸。图像生成工具名称与底层图像模型无法从文件本身确认。' };
}

export const providerInternals = { readImageArtifact, readCodexModelCatalog, knownCodexImageModel };
