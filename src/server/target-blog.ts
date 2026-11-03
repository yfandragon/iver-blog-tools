import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { access, lstat, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import matter from 'gray-matter';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import type { ArticleTask, DiffFile, FileManifestItem, PreviewContext } from '../shared/types.js';
import type { TaskRecord } from './task-store.js';
import { emitProgress } from './task-store.js';
import type { PackageFile } from './package-input.js';
import { AppError } from './errors.js';

const execFileAsync = promisify(execFile);
const children = new Map<string, ReturnType<typeof spawn>>();

async function gitRaw(root: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    return result.stdout;
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & { stderr?: string };
    throw new AppError(`Git 命令失败：${error.stderr?.trim() || error.message}`, 409);
  }
}

async function git(root: string, args: string[]): Promise<string> {
  return (await gitRaw(root, args)).trimEnd();
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true).catch(() => false);
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export type TargetInspection = {
  root: string;
  articleDirectory: string;
  coverDirectory: string;
  resourceDirectory: string;
  htmlSupported: boolean;
  branch: string;
  pushRemote: string;
  pushBranch: string;
  pushTarget: string;
};

export async function inspectTarget(targetPath: string): Promise<TargetInspection> {
  if (!path.isAbsolute(targetPath)) throw new AppError('目标博客路径必须是绝对路径。');
  const root = await realpath(targetPath).catch(() => { throw new AppError('目标目录不存在，或当前用户无法读取。'); });
  const packageFile = path.join(root, 'package.json');
  let packageJson: Record<string, unknown>;
  try { packageJson = JSON.parse(await readFile(packageFile, 'utf8')) as Record<string, unknown>; }
  catch { throw new AppError('目标目录缺少可读取的package.json。'); }
  const allDeps = { ...(packageJson.dependencies as object ?? {}), ...(packageJson.devDependencies as object ?? {}) } as Record<string, string>;
  if (!allDeps.astro) throw new AppError('v1只接受安装Astro的博客仓库。');

  const schemaFile = path.join(root, 'src/content.config.ts');
  const schema = await readFile(schemaFile, 'utf8').catch(() => '');
  const requiredMarkers = ["base: './src/content/articles'", 'title: z.string().trim()', 'description: z.string().trim()', 'publishedAt: z.coerce.date()', 'cover: image().optional()'];
  const missing = requiredMarkers.filter((marker) => !schema.includes(marker));
  if (missing.length) throw new AppError(`内容schema与已核对的IverBlog约定不兼容，缺少：${missing.join('、')}`);
  const articleDirectory = path.join(root, 'src/content/articles');
  const coverDirectory = path.join(root, 'src/assets/covers');
  const resourceDirectory = path.join(root, 'public/note-assets');
  for (const directory of [articleDirectory, coverDirectory]) {
    if (!(await stat(directory).then((result) => result.isDirectory()).catch(() => false))) throw new AppError(`目标仓库缺少目录：${path.relative(root, directory)}`);
    const resolved = await realpath(directory);
    if (!isInside(root, resolved)) throw new AppError(`目标目录通过符号链接越出仓库：${path.relative(root, directory)}`);
  }
  for (const directory of [path.join(root, 'public'), resourceDirectory]) {
    if (!(await exists(directory))) continue;
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new AppError(`目标资源目录不是普通目录：${path.relative(root, directory)}`);
    const resolved = await realpath(directory);
    if (!isInside(root, resolved)) throw new AppError(`目标资源目录通过符号链接越出仓库：${path.relative(root, directory)}`);
  }
  const gitRoot = await git(root, ['rev-parse', '--show-toplevel']);
  if (path.resolve(gitRoot) !== root) throw new AppError('所选目录不是Git仓库根目录。');
  const branch = await git(root, ['branch', '--show-current']);
  if (!branch) throw new AppError('当前处于detached HEAD，不能进入发布准备。');
  let pushRemote = '';
  let pushBranch = '';
  try {
    pushRemote = await git(root, ['config', '--get', `branch.${branch}.remote`]);
    const mergeRef = await git(root, ['config', '--get', `branch.${branch}.merge`]);
    if (mergeRef.startsWith('refs/heads/')) pushBranch = mergeRef.slice('refs/heads/'.length);
  } catch { /* upstream is mandatory only for explicit publishing */ }
  if (pushRemote === '.') pushRemote = '';
  const pushTarget = pushRemote && pushBranch ? `${pushRemote}/${pushBranch}` : '未设置上游远端';
  const htmlSchema = ['contentFormat: z.enum([\'markdown\', \'html\'])', 'htmlSource: z.string().trim().min(1).optional()', 'htmlBasePath: z.string().optional()'].every((marker) => schema.includes(marker));
  const articlePage = await readFile(path.join(root, 'src/pages/articles/[...id].astro'), 'utf8').catch(() => '');
  const fullPage = await readFile(path.join(root, 'src/pages/articles/[id]/full.astro'), 'utf8').catch(() => '');
  const renderer = await readFile(path.join(root, 'src/lib/html-note.ts'), 'utf8').catch(() => '');
  const pagefindScript = await readFile(path.join(root, 'scripts/build-pagefind.mjs'), 'utf8').catch(() => '');
  const htmlSupported = htmlSchema
    && articlePage.includes('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"')
    && articlePage.includes('srcdoc={htmlDocument}')
    && fullPage.includes('renderHtmlNote')
    && renderer.includes('export async function renderHtmlNote')
    && pagefindScript.includes('addCustomRecord');
  return { root, articleDirectory, coverDirectory, resourceDirectory, htmlSupported, branch, pushRemote, pushBranch, pushTarget };
}

function articleBodyWithMetadata(record: TaskRecord, coverReference: string, htmlSource: string): string {
  const task = record.task;
  const data = {
    ...record.frontmatter,
    title: task.title.trim(),
    description: task.description.trim(),
    publishedAt: task.publishedAt,
    cover: coverReference,
    coverAlt: task.coverAlt,
  };
  if (task.format === 'html') {
    return matter.stringify('', {
      title: task.title.trim(),
      description: task.description.trim(),
      publishedAt: task.publishedAt,
      contentFormat: 'html',
      htmlSource,
      htmlBasePath: path.posix.dirname(task.entryPath ?? '') === '.' ? '' : path.posix.dirname(task.entryPath ?? ''),
      cover: coverReference,
      coverAlt: task.coverAlt,
    });
  }
  return matter.stringify(record.derivedBody ?? task.body, data);
}

async function validateSiteRootResources(task: ArticleTask, target: TargetInspection): Promise<void> {
  const missing: string[] = [];
  for (const item of task.resourceManifest ?? []) {
    if (item.status !== 'external' || !item.path.startsWith('/')) continue;
    const pathOnly = item.path.split(/[?#]/, 1)[0]!;
    let decoded: string;
    try { decoded = decodeURIComponent(pathOnly); } catch { decoded = pathOnly; }
    const file = path.resolve(target.root, 'public', `.${decoded}`);
    if (!isInside(path.join(target.root, 'public'), file) || !(await exists(file))) missing.push(item.path);
  }
  if (missing.length) throw new AppError(`站点根路径引用未在目标博客 public 中找到：${missing.join('、')}`, 409);
}

async function nextCoverName(directory: string, slug: string): Promise<string> {
  for (let version = 1; version <= 99; version += 1) {
    const name = `${slug}-v${version}.webp`;
    if (!(await exists(path.join(directory, name)))) return name;
  }
  throw new AppError('该文章封面已存在过多版本，请手动检查目标目录。', 409);
}

function patchLines(file: string, body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const shown = lines.slice(0, 500);
  const suffix = lines.length > shown.length ? `\n… 截断显示；完整文件 SHA-256 在清单中校验。共 ${lines.length} 行。` : '';
  return [`--- /dev/null`, `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...shown.map((line) => `+${line}`)].join('\n') + suffix;
}

function coverPatch(file: string, bytes: number, width: number, height: number, hash: string): string {
  return `Binary file added\nFormat: WebP\nDimensions: ${width} × ${height}\nBytes: ${bytes}\nSHA-256: ${hash}`;
}

function sha256(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }

function outputPatch(file: string, bytes: Buffer, kind: FileManifestItem['kind']): string {
  if (kind === 'cover' || kind === 'resource' && /\.(?:png|jpe?g|webp|gif|avif|svg|woff2?|ttf|otf|mp4|webm|mp3|wav)$/i.test(file)) {
    return `Binary/resource file added\nBytes: ${bytes.byteLength}\nSHA-256: ${sha256(bytes)}`;
  }
  return patchLines(file, bytes.toString('utf8'));
}

async function safeOutputPath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => part === '..')) throw new AppError(`输出路径无效：${relative}`, 409);
  const absolute = path.resolve(root, relative);
  if (!isInside(root, absolute)) throw new AppError(`输出路径越出了目标博客：${relative}`, 409);
  const parent = path.dirname(absolute);
  const parentRelative = path.relative(root, parent).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parentRelative) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new AppError(`目标输出目录包含符号链接：${path.relative(root, current)}`, 409);
      if (!info.isDirectory()) throw new AppError(`目标输出路径不是目录：${path.relative(root, current)}`, 409);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      await mkdir(current);
    }
  }
  return absolute;
}

async function writeOutputs(root: string, outputs: Map<string, Buffer>, oldContents?: Map<string, Buffer>): Promise<void> {
  const absolutePaths = new Map<string, string>();
  for (const relative of outputs.keys()) absolutePaths.set(relative, await safeOutputPath(root, relative));
  const created: string[] = [];
  const changed: string[] = [];
  const temporary: string[] = [];
  try {
    for (const [relative, bytes] of outputs) {
      const destination = absolutePaths.get(relative)!;
      if (oldContents?.has(relative)) {
        const temp = `${destination}.codex-${randomUUID()}.tmp`;
        temporary.push(temp);
        await writeFile(temp, bytes, { flag: 'wx' });
        await rename(temp, destination);
        temporary.pop();
        changed.push(relative);
      } else {
        await writeFile(destination, bytes, { flag: 'wx' });
        created.push(destination);
      }
    }
  } catch (cause) {
    for (const relative of changed.reverse()) {
      const destination = absolutePaths.get(relative)!;
      const prior = oldContents?.get(relative);
      if (prior) await writeFile(destination, prior).catch(() => undefined);
    }
    for (const file of created.reverse()) await unlink(file).catch(() => undefined);
    for (const file of temporary) await unlink(file).catch(() => undefined);
    throw cause;
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not allocate preview port'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPreview(url: string, process: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError = '本地开发服务器未就绪';
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new AppError(`目标博客开发服务器提前退出（${process.exitCode}）。${lastError}`, 502);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (cause) { lastError = cause instanceof Error ? cause.message : lastError; }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new AppError(`等待目标博客预览超时：${lastError}`, 504);
}

export async function prepareTarget(record: TaskRecord, targetPath: string, emit: (stage: 'prepare' | 'preview', status: 'running' | 'complete' | 'failed', message: string) => void): Promise<{ diff: DiffFile[]; context: PreviewContext }> {
  const task = record.task;
  if (!task.entryPath || !task.format) throw new AppError('请先选择一个Markdown或HTML入口文件。');
  if (!task.cover || !record.coverFile) throw new AppError('请先通过现有封面流程生成并校验独立封面图片。');
  if (task.blockers?.length) throw new AppError(`导入资源仍有阻塞问题：${task.blockers.join('；')}`, 409);
  if (!task.title.trim() || !task.description.trim() || !task.publishedAt) throw new AppError('标题、摘要和发布日期都必须填写。');
  const parsedDate = new Date(`${task.publishedAt}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.publishedAt) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== task.publishedAt) throw new AppError('发布日期无效。');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,119}$/u.test(task.slug) || task.slug.includes('..')) throw new AppError('文章文件名包含不支持的字符。');
  const target = await inspectTarget(targetPath);
  if (task.format === 'html' && !target.htmlSupported) throw new AppError('目标博客缺少经检查的 HTML 承载基础（同集合 schema、sandbox/srcdoc 文章页、完整页或 Pagefind HTML 记录）；拒绝写入。');
  await validateSiteRootResources(task, target);

  const metadataName = `${task.slug}.md`;
  const htmlName = `${task.slug}.html`;
  const relativeMetadata = `src/content/articles/${metadataName}`;
  const relativeHtml = `src/content/articles/${htmlName}`;
  const priorPrepared = Boolean(record.preparedSnapshot?.size && record.preparedPaths?.length);
  if (priorPrepared && path.resolve(task.targetPath ?? '') !== target.root) throw new AppError('已有预览只能在原目标博客中安全更新；更换目标请重新导入。', 409);

  let coverName: string;
  if (priorPrepared && task.coverPath) coverName = path.basename(task.coverPath);
  else coverName = await nextCoverName(target.coverDirectory, task.slug);
  const relativeCover = `src/assets/covers/${coverName}`;
  const coverBytes = await sharp(record.coverFile).resize(1200, 675, { fit: 'cover', position: 'attention' }).webp({ quality: 86 }).toBuffer();
  const coverRef = `../../assets/covers/${coverName}`;
  const htmlSource = `${task.slug}.html`;
  const metadataText = articleBodyWithMetadata(record, coverRef, htmlSource);
  const outputs = new Map<string, { bytes: Buffer; kind: FileManifestItem['kind'] }>();
  outputs.set(relativeMetadata, { bytes: Buffer.from(metadataText), kind: 'metadata' });
  if (task.format === 'html') {
    const entry = record.packageFiles.find((file) => file.path === task.entryPath);
    if (!entry) throw new AppError('HTML 原稿不在已验证的导入包快照中。', 409);
    outputs.set(relativeHtml, { bytes: entry.bytes, kind: 'html' });
  } else if (record.derivedBody !== undefined) {
    // articleBodyWithMetadata serializes only the derived Markdown body; source bytes stay in the task package snapshot.
  }
  const packageFiles = new Map(record.packageFiles.map((file) => [file.path, file.bytes]));
  for (const resource of task.resourceManifest ?? []) {
    if (resource.status !== 'ready') continue;
    const bytes = packageFiles.get(resource.path);
    if (!bytes) throw new AppError(`任务快照中缺少资源文件：${resource.path}`, 409);
    outputs.set(`public/note-assets/${task.slug}/${resource.path}`, { bytes, kind: 'resource' });
  }
  outputs.set(relativeCover, { bytes: coverBytes, kind: 'cover' });
  const relativePaths = [...outputs.keys()].sort();

  let oldContents: Map<string, Buffer> | undefined;
  if (priorPrepared) {
    const previous = record.preparedPaths ?? [];
    if (JSON.stringify([...previous].sort()) !== JSON.stringify(relativePaths)) throw new AppError('任务文件清单相较上次预览发生变化；请重新导入后再准备。', 409);
    oldContents = new Map();
    for (const relative of previous) {
      const absolute = path.resolve(target.root, relative);
      if (!isInside(target.root, absolute)) throw new AppError(`旧预览文件路径越界：${relative}`, 409);
      const info = await lstat(absolute).catch(() => undefined);
      if (!info?.isFile() || info.isSymbolicLink()) throw new AppError(`旧预览文件缺失或不是普通文件：${relative}`, 409);
      const bytes = await readFile(absolute);
      if (sha256(bytes) !== record.preparedSnapshot?.get(relative)) throw new AppError(`旧预览文件已被修改，拒绝安全更新：${relative}`, 409);
      oldContents.set(relative, bytes);
    }
  } else {
    const conflicts: string[] = [];
    for (const relative of relativePaths) if (await exists(path.resolve(target.root, relative))) conflicts.push(relative);
    if (conflicts.length) throw new AppError(`目标文件已存在，拒绝覆盖：${conflicts.join('、')}`, 409);
  }

  emit('prepare', 'running', '核对目标承载能力、完整文件清单和 SHA-256 快照…');
  const outputBytes = new Map([...outputs].map(([file, item]) => [file, item.bytes]));
  await writeOutputs(target.root, outputBytes, oldContents);
  const coverMeta = await sharp(coverBytes).metadata();
  const coverHash = sha256(coverBytes);
  task.targetPath = target.root;
  task.currentBranch = target.branch;
  task.articlePath = relativeMetadata;
  task.coverPath = relativeCover;
  task.diff = relativePaths.map((file) => {
    const item = outputs.get(file)!;
    const patch = file === relativeCover
      ? coverPatch(file, item.bytes.byteLength, coverMeta.width ?? 1200, coverMeta.height ?? 675, coverHash)
      : outputPatch(file, item.bytes, item.kind);
    return { path: file, change: priorPrepared ? 'modified' as const : 'added' as const, patch };
  });
  const manifest: FileManifestItem[] = relativePaths.map((file) => {
    const item = outputs.get(file)!;
    return { path: file, bytes: item.bytes.byteLength, sha256: sha256(item.bytes), kind: item.kind };
  });
  task.fileManifest = manifest;
  record.preparedSnapshot = new Map(manifest.map((item) => [item.path, item.sha256]));
  record.preparedContents = new Map(outputBytes);
  record.preparedPaths = relativePaths;
  record.metadataDirty = false;
  record.pushRemote = target.pushRemote;
  record.pushBranch = target.pushBranch;
  record.localBranch = target.branch;
  task.pushTarget = target.pushTarget;
  task.status = 'prepared';
  task.error = undefined;
  emit('prepare', 'complete', `已准备${manifest.length}个文件（元数据、${task.format === 'html' ? 'HTML 原稿、' : ''}配套资源和独立封面），并记录 SHA-256。`);

  const previousPreview = children.get(task.id);
  if (previousPreview?.pid) {
    try { if (process.platform !== 'win32') process.kill(-previousPreview.pid, 'SIGTERM'); else previousPreview.kill('SIGTERM'); } catch { previousPreview.kill('SIGTERM'); }
  }
  task.status = 'previewing';
  emit('preview', 'running', '正在启动目标仓库自己的 Astro 开发预览…');
  const port = await findFreePort();
  const previewProcess = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: target.root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
    shell: false,
    detached: process.platform !== 'win32',
  });
  let output = '';
  let spawnError = '';
  previewProcess.stdout.setEncoding('utf8').on('data', (chunk: string) => { output = (output + chunk).slice(-4000); });
  previewProcess.stderr.setEncoding('utf8').on('data', (chunk: string) => { output = (output + chunk).slice(-4000); });
  previewProcess.once('error', (cause) => { spawnError = cause.message; });
  children.set(task.id, previewProcess);
  record.previewProcess = previewProcess;
  previewProcess.once('exit', () => children.delete(task.id));
  const origin = `http://127.0.0.1:${port}`;
  const homeUrl = `${origin}/`;
  const articleUrl = `${origin}/articles/${encodeURIComponent(task.slug)}/`;
  const fullPageUrl = task.format === 'html' ? `${origin}/articles/${encodeURIComponent(task.slug)}/full/` : undefined;
  try {
    if (spawnError) throw new AppError(`无法启动目标博客 npm 开发命令：${spawnError}`, 503);
    await waitForPreview(homeUrl, previewProcess);
    const articleResponse = await fetch(articleUrl, { signal: AbortSignal.timeout(15_000) });
    if (!articleResponse.ok) throw new AppError(`首页预览已启动，但文章页请求失败：HTTP ${articleResponse.status}。${output.slice(-900)}`, 502);
    const articleHtml = await articleResponse.text();
    if (!articleHtml.includes(task.title.trim())) throw new AppError('文章页已响应，但页面中未找到本次文章标题，预览不视为通过。', 502);
    if (task.format === 'html' && (!articleHtml.includes('srcdoc=') || !articleHtml.includes('allow-scripts allow-popups allow-popups-to-escape-sandbox'))) throw new AppError('HTML 文章页缺少隔离 iframe 或 srcdoc，预览不视为通过。', 502);
    const homeResponse = await fetch(homeUrl, { signal: AbortSignal.timeout(15_000) });
    const homeHtml = await homeResponse.text();
    if (!homeResponse.ok || !homeHtml.includes(task.title.trim())) throw new AppError('首页已响应，但没有找到本次文章卡片标题。', 502);
    if (fullPageUrl) {
      const fullResponse = await fetch(fullPageUrl, { signal: AbortSignal.timeout(15_000) });
      const fullHtml = await fullResponse.text();
      if (!fullResponse.ok || !fullHtml.includes('srcdoc=') || !fullHtml.includes('返回文章页')) throw new AppError(`完整 HTML 页面未通过本地检查：HTTP ${fullResponse.status}。${output.slice(-900)}`, 502);
    }
  } catch (cause) {
    task.status = 'prepared';
    task.error = cause instanceof Error ? cause.message : '目标博客预览失败';
    emit('preview', 'failed', task.error);
    throw cause;
  }
  task.previewUrl = homeUrl;
  task.articlePreviewUrl = articleUrl;
  task.fullPagePreviewUrl = fullPageUrl;
  task.status = 'prepared';
  task.error = undefined;
  emit('preview', 'complete', '首页卡片、文章页和适用的完整页面均返回并通过结构检查；等待作者本地评审。');
  return { diff: task.diff, context: { homeUrl, articleUrl, fullPageUrl, branch: target.branch, pushTarget: target.pushTarget } };
}

async function verifyPrepared(record: TaskRecord, root: string): Promise<string[]> {
  const task = record.task;
  if (!record.preparedSnapshot?.size || !record.preparedPaths?.length || !task.fileManifest?.length) throw new AppError('尚无可提交的完整预览文件清单。');
  for (const relative of record.preparedPaths) {
    const absolute = path.resolve(root, relative);
    if (!isInside(root, absolute)) throw new AppError(`预览文件路径越界：${relative}`, 409);
    const info = await lstat(absolute).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink()) throw new AppError(`预览文件已丢失或不是普通文件：${relative}`, 409);
    const bytes = await readFile(absolute);
    if (sha256(bytes) !== record.preparedSnapshot.get(relative)) throw new AppError(`预览后文件内容发生变化；拒绝使用旧快照：${relative}`, 409);
  }
  return [...record.preparedPaths];
}

async function stagedNames(root: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root, encoding: 'utf8' });
  return stdout.split('\0').filter(Boolean).sort();
}

export async function publishTask(record: TaskRecord, emit: (stage: 'publish', status: 'running' | 'complete' | 'failed', message: string) => void): Promise<ArticleTask> {
  const task = record.task;
  if (!task.targetPath || !record.pushRemote || !record.pushBranch || !record.localBranch) throw new AppError('当前分支没有配置上游推送目标；请先在目标仓库配置后重新确认。', 409);
  if (task.blockers?.length) throw new AppError(`导入资源仍有阻塞问题：${task.blockers.join('；')}`, 409);
  if (task.pushTarget !== `${record.pushRemote}/${record.pushBranch}`) throw new AppError('推送目标与确认时记录的上游不一致，请重新准备预览。', 409);
  const target = await inspectTarget(task.targetPath);
  if (target.branch !== record.localBranch) throw new AppError(`当前分支已变化（${target.branch}），与已预览的分支不一致。`, 409);
  const expected = await verifyPrepared(record, target.root);
  const alreadyStaged = await stagedNames(target.root);
  if (alreadyStaged.length) throw new AppError(`目标仓库已有暂存改动，发布已停止：${alreadyStaged.join('、')}`, 409);
  emit('publish', 'running', task.commitHash ? '已有本地提交，正在重试推送至已确认的上游…' : '核对暂存区与本次文件范围…');
  if (!task.commitHash) {
    const statusResult = await execFileAsync('git', ['status', '--porcelain', '-z', '--', ...expected], { cwd: target.root, encoding: 'utf8' });
    const statusEntries = statusResult.stdout.split('\0').filter(Boolean);
    const untrackedOrChanged = statusEntries.map((entry) => `${entry.slice(0, 2)} ${entry.slice(3)}`).sort();
    const expectedStatus = expected.map((file) => `?? ${file}`).sort();
    if (JSON.stringify(untrackedOrChanged) !== JSON.stringify(expectedStatus)) {
      throw new AppError(`本次文件状态不符合新建文件预期，已停止：${untrackedOrChanged.join('、') || '没有检测到待发布文件'}`, 409);
    }
    await git(target.root, ['add', '--', ...expected]);
    const staged = await stagedNames(target.root);
    if (JSON.stringify(staged) !== JSON.stringify([...expected].sort())) {
      await git(target.root, ['reset', '--', ...expected]).catch(() => undefined);
      throw new AppError(`暂存范围不精确，已撤回本次暂存：${staged.join('、') || '空'}`, 409);
    }
    try { await git(target.root, ['diff', '--cached', '--check']); }
    catch (cause) { await git(target.root, ['reset', '--', ...expected]).catch(() => undefined); throw cause; }
    for (const relative of expected) {
      const stagedObject = await git(target.root, ['rev-parse', `:0:${relative}`]);
      const workingObject = await git(target.root, ['hash-object', relative]);
      if (stagedObject !== workingObject) {
        await git(target.root, ['reset', '--', ...expected]).catch(() => undefined);
        throw new AppError(`暂存文件与预览快照不一致：${relative}`, 409);
      }
    }
    try {
      await git(target.root, ['diff', '--quiet', '--', ...expected]);
    } catch (cause) {
      await git(target.root, ['reset', '--', ...expected]).catch(() => undefined);
      throw new AppError('暂存后检测到目标文件又发生变化，已取消本次暂存。', 409);
    }
    try { await git(target.root, ['commit', '-m', `feat: add ${task.format === 'html' ? 'HTML note' : 'article'} ${task.slug}`]); }
    catch (cause) {
      await git(target.root, ['reset', '--', ...expected]).catch(() => undefined);
      throw cause;
    }
    task.commitHash = await git(target.root, ['rev-parse', 'HEAD']);
    task.status = 'committed';
  }
  emit('publish', 'running', `本地提交 ${task.commitHash?.slice(0, 12)} 已创建，正在推送 ${task.pushTarget}…`);
  try {
    await git(target.root, ['push', record.pushRemote, `${record.pushBranch}:${record.pushBranch}`]);
  } catch (cause) {
    task.status = 'committed';
    task.error = `提交已创建（${task.commitHash}），推送失败；可在确认目标仍正确后重试。${cause instanceof Error ? cause.message : ''}`;
    emit('publish', 'failed', task.error);
    throw new AppError(task.error, 502);
  }
  task.status = 'published';
  task.error = undefined;
  emit('publish', 'complete', `推送到${task.pushTarget}成功；平台构建和公开页面未验证。`);
  return task;
}

export function stopAllPreviews(): void {
  for (const child of children.values()) {
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); continue; } catch { /* fall through */ }
    }
    child.kill('SIGTERM');
  }
  children.clear();
}
