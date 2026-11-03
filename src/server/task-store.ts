import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArticleTask, FileManifestItem, ProgressEvent } from '../shared/types.js';
import { importHtml, importMarkdown } from './markdown.js';
import { scanResources } from './resource-scanner.js';
import { validatePackageFiles, type PackageFile } from './package-input.js';
import { AppError } from './errors.js';

export type TaskRecord = {
  task: ArticleTask;
  frontmatter: Record<string, unknown>;
  workDir: string;
  coverFile?: string;
  coverPromptNote?: string;
  preparedSnapshot?: Map<string, string>;
  preparedContents?: Map<string, Buffer>;
  packageFiles: PackageFile[];
  selectedEntryPath?: string;
  derivedBody?: string;
  importWarnings: string[];
  preparedPaths?: string[];
  metadataDirty?: boolean;
  pushRemote?: string;
  pushBranch?: string;
  localBranch?: string;
  previewProcess?: import('node:child_process').ChildProcess;
};

const taskRecords = new Map<string, TaskRecord>();
const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(0);

export async function createTask(sourceName: string, inputFiles: PackageFile[]): Promise<ArticleTask> {
  const files = validatePackageFiles(inputFiles);
  const candidates = files.filter((file) => /\.(?:md|markdown|html?)$/i.test(file.path)).map((file) => file.path).sort((a, b) => a.localeCompare(b, 'en'));
  if (!candidates.length) throw new AppError('导入包中没有Markdown或HTML入口文件。', 400);
  const id = randomUUID();
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'iverblog-tools-'));
  const promptVersion = 'article-cover-v2';
  const prompt = await readFile(path.resolve(process.cwd(), 'prompts/article-cover/v2.md'), 'utf8');
  for (const file of files) {
    const target = path.resolve(workDir, 'package', file.path);
    if (!target.startsWith(`${path.resolve(workDir, 'package')}${path.sep}`)) throw new AppError(`导入路径越界：${file.path}`);
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(target), { recursive: true }));
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  await writeFile(path.join(workDir, 'prompt-copy.md'), prompt, { flag: 'wx' });
  const task: ArticleTask = {
    id, sourceName, slug: '', title: '', description: '', publishedAt: new Date().toISOString().slice(0, 10),
    coverAlt: '', prompt, promptVersion, body: '', entryCandidates: candidates, resourceManifest: [], blockers: candidates.length > 1 ? ['请选择一个Markdown或HTML入口文件。'] : [],
    warnings: [], status: 'draft',
  };
  taskRecords.set(id, { task, frontmatter: {}, workDir, packageFiles: files, importWarnings: [] });
  if (candidates.length === 1) await selectTaskEntry(id, candidates[0]!);
  emitProgress(id, 'description', 'complete', candidates.length === 1 ? `${task.format === 'html' ? 'HTML' : 'Markdown'}已导入；原稿与资源包已保留。` : '导入包包含多个候选入口，请选择要导入的文件。');
  return task;
}

export async function selectTaskEntry(id: string, entryPath: string): Promise<ArticleTask> {
  const record = getTask(id);
  if (!record.task.entryCandidates?.includes(entryPath)) throw new AppError('所选入口不在原始导入包中。', 400);
  if (record.selectedEntryPath && record.selectedEntryPath !== entryPath) throw new AppError('任务入口已确认；如需选择另一个入口，请重新导入原始包。', 409);
  const file = record.packageFiles.find((candidate) => candidate.path === entryPath);
  if (!file) throw new AppError('所选入口文件已不在导入包中。', 404);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
  catch { throw new AppError('入口文件不是有效的UTF-8文本。', 400); }
  const format = /\.html?$/i.test(entryPath) ? 'html' : 'markdown';
  const imported = format === 'html'
    ? { task: importHtml(entryPath, source, id, record.task.prompt, record.task.promptVersion), frontmatter: {} as Record<string, unknown> }
    : importMarkdown(entryPath, source, id, record.task.prompt, record.task.promptVersion);
  const scan = scanResources({ format, entryPath, noteId: imported.task.slug, source, files: record.packageFiles });
  const preservedCover = record.task.cover;
  const preservedCoverFile = record.coverFile;
  Object.assign(record.task, imported.task, {
    id,
    sourceName: record.task.sourceName,
    entryPath,
    entryCandidates: record.task.entryCandidates,
    format,
    resourceManifest: scan.manifest,
    blockers: scan.blockers,
    warnings: [...imported.task.warnings, ...scan.warnings],
    cover: preservedCover,
  });
  record.coverFile = preservedCoverFile;
  record.frontmatter = imported.frontmatter;
  record.selectedEntryPath = entryPath;
  record.derivedBody = scan.derivedBody;
  record.importWarnings = [...imported.task.warnings, ...scan.warnings];
  record.metadataDirty = false;
  await writeFile(path.join(record.workDir, 'source.md'), source, { flag: 'w' });
  return record.task;
}

export function getTask(id: string): TaskRecord {
  const record = taskRecords.get(id);
  if (!record) throw new AppError('找不到这篇本机任务，可能已随服务重启清除。', 404);
  return record;
}

export function emitProgress(taskId: string, stage: ProgressEvent['stage'], status: ProgressEvent['status'], message: string): void {
  const event: ProgressEvent = { taskId, at: new Date().toISOString(), stage, status, message };
  taskEvents.emit(taskId, event);
}

export function subscribeTask(taskId: string, listener: (event: ProgressEvent) => void): () => void {
  taskEvents.on(taskId, listener);
  return () => taskEvents.off(taskId, listener);
}

export async function updateTask(id: string, patch: Partial<ArticleTask>): Promise<ArticleTask> {
  const record = getTask(id);
  if (patch.entryPath !== undefined) await selectTaskEntry(id, patch.entryPath);
  const allowed = ['title', 'description', 'publishedAt', 'coverAlt', 'prompt'] as const;
  for (const key of allowed) {
    const value = patch[key];
    if (value !== undefined && typeof value !== 'string') throw new AppError(`${key} 必须是文本。`);
  }
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 160)) throw new AppError('标题须为1到160个字符。');
  if (patch.description !== undefined && patch.description.length > 360) throw new AppError('摘要不能超过360个字符。');
  if (patch.publishedAt !== undefined) {
    const parsedDate = new Date(`${patch.publishedAt}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.publishedAt) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== patch.publishedAt) throw new AppError('发布日期格式无效。');
  }
  if (patch.prompt !== undefined && patch.prompt.length > 8000) throw new AppError('本次提示词不能超过8000个字符。');
  if (patch.coverAlt !== undefined && patch.coverAlt.length > 300) throw new AppError('封面替代文本不能超过300个字符。');
  const outputMetadataKeys = ['title', 'description', 'publishedAt', 'coverAlt'] as const;
  const outputMetadataChanged = outputMetadataKeys.some((key) => patch[key] !== undefined && patch[key] !== record.task[key]);
  Object.assign(record.task, Object.fromEntries(allowed.filter((key) => patch[key] !== undefined).map((key) => [key, patch[key]])));
  if (patch.prompt !== undefined) await writeFile(path.join(record.workDir, 'prompt-copy.md'), patch.prompt, 'utf8');
  const externalWarnings = record.importWarnings.filter((warning) => warning.startsWith('外部依赖：'));
  record.task.warnings = [...externalWarnings, ...(record.task.description.trim() ? [] : ['缺少摘要；请填写或让 Codex 起草。'])];
  if (outputMetadataChanged && record.task.targetPath) {
    record.metadataDirty = true;
    record.task.previewUrl = undefined;
    record.task.articlePreviewUrl = undefined;
    record.task.fullPagePreviewUrl = undefined;
    record.task.diff = undefined;
    record.task.fileManifest = undefined;
    record.task.status = record.task.cover ? 'ready' : 'draft';
    const child = record.previewProcess;
    if (child?.pid) {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch { child.kill('SIGTERM'); }
    }
    record.previewProcess = undefined;
  }
  if (patch.title !== undefined && record.task.status === 'draft') {
    // Keep the file slug stable after import so changing its display title cannot silently retarget paths.
  }
  return record.task;
}
