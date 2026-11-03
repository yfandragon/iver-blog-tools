import { fromBufferPromise } from 'yauzl';
import type { Entry } from 'yauzl';
import { AppError } from './errors.js';

export const PACKAGE_LIMITS = {
  archiveBytes: 100 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  files: 2_000,
  fileBytes: 50 * 1024 * 1024,
} as const;

export type PackageFile = { path: string; bytes: Buffer };

export function normalizePackagePath(input: string): string {
  if (!input || input.includes('\0') || input.includes('\\') || input.startsWith('/') || /^[a-zA-Z]:/.test(input)) {
    throw new AppError(`导入路径必须是包内相对路径：${JSON.stringify(input)}`, 400);
  }
  const pieces = input.split('/');
  if (pieces.some((piece) => piece === '..')) throw new AppError(`导入包包含路径穿越：${input}`, 400);
  const normalized = pieces.filter((piece) => piece && piece !== '.').join('/').normalize('NFC');
  if (!normalized || normalized.startsWith('../') || normalized === '..') throw new AppError(`导入路径无效：${input}`, 400);
  return normalized;
}

export function validatePackageFiles(files: PackageFile[]): PackageFile[] {
  if (!files.length) throw new AppError('所选目录没有可导入的文件。', 400);
  if (files.length > PACKAGE_LIMITS.files) throw new AppError(`导入包最多允许${PACKAGE_LIMITS.files}个文件。`, 413);
  const seen = new Set<string>();
  let total = 0;
  const normalized = files.map((file) => {
    const filePath = normalizePackagePath(file.path);
    if (file.bytes.byteLength > PACKAGE_LIMITS.fileBytes) throw new AppError(`单个文件不能超过50 MiB：${filePath}`, 413);
    total += file.bytes.byteLength;
    if (total > PACKAGE_LIMITS.expandedBytes) throw new AppError('导入包展开后不能超过256 MiB。', 413);
    if (seen.has(filePath)) throw new AppError(`导入包包含重复规范化路径：${filePath}`, 400);
    seen.add(filePath);
    return { path: filePath, bytes: file.bytes };
  });
  return normalized;
}

function readEntry(zip: Awaited<ReturnType<typeof fromBufferPromise>>, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error ?? new Error(`无法读取ZIP条目 ${entry.fileName}`));
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > PACKAGE_LIMITS.fileBytes) stream.destroy(new AppError(`单个文件不能超过50 MiB：${entry.fileName}`, 413));
        else chunks.push(chunk);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(Buffer.concat(chunks, size)));
    });
  });
}

export async function readZipPackage(bytes: Buffer): Promise<PackageFile[]> {
  if (bytes.byteLength > PACKAGE_LIMITS.archiveBytes) throw new AppError('ZIP文件不能超过100 MiB。', 413);
  const zip = await fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true, autoClose: true });
  if (zip.entryCount > PACKAGE_LIMITS.files) { zip.close(); throw new AppError(`ZIP最多允许${PACKAGE_LIMITS.files}个条目。`, 413); }
  const result = new Map<string, Buffer>();
  let expanded = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      const detail = cause instanceof Error ? cause.message : '未知错误';
      const safeCause = /invalid relative path:/i.test(detail)
        ? new AppError(`ZIP包含路径穿越或无效相对路径：${detail}`, 400)
        : cause instanceof AppError ? cause : new AppError(`ZIP无法安全读取：${detail}`, 400);
      reject(safeCause);
    };
    zip.on('error', fail);
    zip.on('entry', async (entry: Entry) => {
      try {
        const entryPath = normalizePackagePath(entry.fileName.replace(/\/$/, ''));
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) throw new AppError(`ZIP包含符号链接，已拒绝：${entryPath}`, 400);
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        if (entry.isEncrypted() || !entry.canDecodeFileData()) throw new AppError(`ZIP包含加密或不支持的条目：${entryPath}`, 400);
        if (entry.uncompressedSize > PACKAGE_LIMITS.fileBytes) throw new AppError(`单个文件不能超过50 MiB：${entryPath}`, 413);
        expanded += entry.uncompressedSize;
        if (expanded > PACKAGE_LIMITS.expandedBytes) throw new AppError('ZIP展开后不能超过256 MiB。', 413);
        if (result.has(entryPath)) throw new AppError(`ZIP包含重复规范化路径：${entryPath}`, 400);
        const contents = await readEntry(zip, entry);
        if (contents.byteLength !== entry.uncompressedSize) throw new AppError(`ZIP条目长度校验失败：${entryPath}`, 400);
        result.set(entryPath, contents);
        zip.readEntry();
      } catch (cause) { fail(cause); }
    });
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolve([...result].map(([filePath, fileBytes]) => ({ path: filePath, bytes: fileBytes })));
    });
    zip.readEntry();
  });
}
