import { init, parse as parseModule } from 'es-module-lexer';
import { parse as parseHtml, type DefaultTreeAdapterTypes } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { normalizePackagePath, type PackageFile } from './package-input.js';

await init;

export type ResourceStatus = 'ready' | 'unused' | 'external' | 'missing' | 'blocked';
export type ResourceKind = 'image' | 'style' | 'script' | 'font' | 'media' | 'document' | 'other';
export type ResourceManifestItem = {
  path: string;
  kind: ResourceKind;
  status: ResourceStatus;
  bytes?: number;
  references: string[];
  reason?: string;
};

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;
type MdNode = { type: string; url?: string; value?: string; identifier?: string; referenceType?: string; position?: { start?: { offset?: number; line: number; column: number }; end?: { offset?: number } }; children?: MdNode[] };
type ScanOptions = { format: 'markdown' | 'html'; entryPath: string; noteId: string; source: string; files: PackageFile[] };
type Reference = { value: string; kind: ResourceKind; location: string; activeDocument?: boolean; replacement?: { start: number; end: number }; rawUrl?: string };

const ignoredUrl = /^(?:#|data:|blob:|mailto:|tel:|javascript:)/i;
const remoteUrl = /^(?:https?:|\/\/)/i;

function markdownBody(source: string): string {
  const match = source.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
}

function location(line = 1, column = 1): string { return `${line}:${column}`; }
function sourceLocation(node: HtmlNode): string {
  const loc = 'sourceCodeLocation' in node ? node.sourceCodeLocation : undefined;
  return loc ? location(loc.startLine, loc.startCol) : '1:1';
}

function kindFromPath(filePath: string, suggested?: ResourceKind): ResourceKind {
  if (suggested) return suggested;
  const ext = filePath.toLowerCase().split('.').pop();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'ico'].includes(ext ?? '')) return 'image';
  if (ext === 'css') return 'style';
  if (['js', 'mjs', 'cjs'].includes(ext ?? '')) return 'script';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext ?? '')) return 'font';
  if (['mp4', 'webm', 'mp3', 'wav', 'ogg'].includes(ext ?? '')) return 'media';
  if (['html', 'htm', 'svg'].includes(ext ?? '')) return 'document';
  return 'other';
}

function stripSuffix(value: string): { pathname: string; suffix: string } {
  const index = value.search(/[?#]/);
  return index < 0 ? { pathname: value, suffix: '' } : { pathname: value.slice(0, index), suffix: value.slice(index) };
}

function normalizeLocalReference(value: string, entryPath: string): { path?: string; reason?: string; external?: boolean; ignored?: boolean } {
  const source = value.trim().replace(/&amp;/g, '&');
  if (!source || ignoredUrl.test(source)) return { ignored: true };
  if (remoteUrl.test(source)) return { external: true };
  if (/^(?:file:|[a-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/Volumes\/|\/private\/|\/tmp\/)/i.test(source)) return { reason: '引用指向本机绝对路径，不能随笔记包移入博客。' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return { external: true };
  if (source.startsWith('/')) return { external: true };
  const { pathname } = stripSuffix(source);
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = pathname; }
  if (decoded.includes('\0') || decoded.includes('\\')) return { reason: '引用路径含无效或不安全字符。' };
  const base = decoded.startsWith('/') ? '' : entryPath.includes('/') ? entryPath.slice(0, entryPath.lastIndexOf('/') + 1) : '';
  const joined = decoded.startsWith('/') ? decoded.slice(1) : `${base}${decoded}`;
  const normalized = joined.split('/').reduce<string[]>((parts, segment) => {
    if (!segment || segment === '.') return parts;
    if (segment === '..') { if (!parts.length) return ['..']; parts.pop(); return parts; }
    parts.push(segment);
    return parts;
  }, []).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return { reason: '引用路径越出了导入包根目录。' };
  try { return { path: normalizePackagePath(normalized) }; }
  catch { return { reason: '引用路径不是安全的包内相对路径。' }; }
}

function recordTextReference(source: string, offset: number): string {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return location(lines.length, (lines.at(-1)?.length ?? 0) + 1);
}

function findDestinationSpan(node: MdNode, source: string): { start: number; end: number } | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return undefined;
  let bracketDepth = 0;
  let close = -1;
  for (let index = start; index < end; index += 1) {
    const char = source[index]!;
    if (char === '\\') { index += 1; continue; }
    if (char === '[') bracketDepth += 1;
    else if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth === 0) { close = index; break; }
    }
  }
  if (close < 0) return undefined;
  let cursor = close + 1;
  while (cursor < end && /\s/.test(source[cursor]!)) cursor += 1;
  if (source[cursor] !== '(') return undefined;
  cursor += 1;
  while (cursor < end && /\s/.test(source[cursor]!)) cursor += 1;
  if (source[cursor] === '<') {
    const destinationStart = cursor + 1;
    for (let index = destinationStart; index < end; index += 1) {
      if (source[index] === '\\') { index += 1; continue; }
      if (source[index] === '>') return { start: destinationStart, end: index };
    }
    return undefined;
  }
  const destinationStart = cursor;
  let parentheses = 0;
  for (; cursor < end; cursor += 1) {
    const char = source[cursor]!;
    if (char === '\\') { cursor += 1; continue; }
    if (char === '(') parentheses += 1;
    else if (char === ')') {
      if (parentheses === 0) return { start: destinationStart, end: cursor };
      parentheses -= 1;
    } else if (/\s/.test(char) && parentheses === 0) return { start: destinationStart, end: cursor };
  }
  return { start: destinationStart, end: cursor };
}

function walkMd(node: MdNode, visit: (node: MdNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkMd(child, visit);
}

function srcsetUrls(value: string): string[] {
  const values: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (cursor < value.length && /[\s,]/.test(value[cursor]!)) cursor += 1;
    if (cursor >= value.length) break;
    const start = cursor;
    while (cursor < value.length && !/\s/.test(value[cursor]!)) cursor += 1;
    const url = value.slice(start, cursor).replace(/,+$/, '');
    if (url) values.push(url);
    while (cursor < value.length && value[cursor] !== ',') cursor += 1;
    if (value[cursor] === ',') cursor += 1;
  }
  return values;
}

function cssReferences(source: string, baseLocation: string, add: (reference: Reference) => void): void {
  try {
    const root = postcss.parse(source);
    root.walkAtRules((rule) => {
      if (rule.name.toLowerCase() !== 'import') return;
      const parsed = valueParser(rule.params);
      const value = parsed.nodes.find((node) => node.type !== 'space' && node.type !== 'comment');
      if (value?.type === 'string' || value?.type === 'word') add({ value: value.value, kind: 'style', location: location(rule.source?.start?.line, rule.source?.start?.column) });
      else if (value?.type === 'function' && value.value.toLowerCase() === 'url') {
        const inner = value.nodes?.find((node) => node.type !== 'space' && node.type !== 'comment');
        if (inner && (inner.type === 'string' || inner.type === 'word')) add({ value: inner.value, kind: 'style', location: location(rule.source?.start?.line, rule.source?.start?.column) });
      }
    });
    root.walkDecls((decl) => {
      const parsed = valueParser(decl.value);
      parsed.walk((node) => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'url') return;
        const inner = node.nodes?.find((child) => child.type !== 'space' && child.type !== 'comment');
        if (inner && (inner.type === 'string' || inner.type === 'word')) add({ value: inner.value, kind: kindFromPath(inner.value), location: location(decl.source?.start?.line, decl.source?.start?.column) });
      });
    });
  } catch (cause) {
    const error = cause as { line?: number; column?: number; reason?: string };
    add({ value: `${baseLocation} CSS`, kind: 'other', location: location(error.line, error.column), activeDocument: true, rawUrl: `CSS语法无法静态解析：${error.reason ?? '解析失败'}` });
  }
}

function scriptReferences(source: string, baseLocation: string, add: (reference: Reference) => void): void {
  try {
    const [imports] = parseModule(source);
    for (const item of imports) {
      if (item.type === 'import-meta') continue;
      const specifier = item.specifier;
      const loc = recordTextReference(source, item.start);
      if (item.type === 'dynamic' && !specifier) add({ value: `${baseLocation} JavaScript`, kind: 'script', location: loc, activeDocument: true, rawUrl: '动态 import 参数无法静态解析。' });
      else if (specifier && /^(?:https?:|\/\/)/i.test(specifier)) add({ value: specifier, kind: 'script', location: loc });
      else if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/')) add({ value: specifier, kind: 'script', location: loc, activeDocument: true, rawUrl: '裸模块依赖需要打包或 import map，当前无法随包运行。' });
      else if (specifier) add({ value: specifier, kind: 'script', location: loc });
    }
  } catch (cause) {
    add({ value: `${baseLocation} JavaScript`, kind: 'script', location: '1:1', activeDocument: true, rawUrl: `JavaScript 模块无法静态解析：${cause instanceof Error ? cause.message : '解析失败'}` });
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|\bnew\s+URL\s*\(/.test(source)) {
    add({ value: `${baseLocation} JavaScript`, kind: 'script', location: '1:1', activeDocument: true, rawUrl: '发现运行时资源加载 API；目标路径无法由静态模块语法确认。' });
  }
}

export function scanResources(options: ScanOptions): { manifest: ResourceManifestItem[]; blockers: string[]; warnings: string[]; derivedBody?: string } {
  const files = new Map(options.files.map((file) => [file.path, file.bytes]));
  const initial = new Map<string, ResourceManifestItem>();
  for (const file of options.files) {
    if (file.path === options.entryPath || /\.(?:md|markdown|html?)$/i.test(file.path)) continue;
    initial.set(file.path, { path: file.path, kind: kindFromPath(file.path), status: 'unused', bytes: file.bytes.byteLength, references: [] });
  }
  const references: Reference[] = [];
  const visitedAssets = new Set<string>();
  const blockers = new Set<string>();
  const add = (reference: Reference) => references.push(reference);

  if (options.format === 'markdown') {
    const body = markdownBody(options.source);
    const tree = unified().use(remarkParse).parse(body) as unknown as MdNode;
    walkMd(tree, (node) => {
      if ((node.type !== 'image' && node.type !== 'link') || !node.url) return;
      const span = findDestinationSpan(node, body);
      const resourceKind = node.type === 'image' ? 'image' : kindFromPath(node.url);
      if (node.type === 'image' || !remoteUrl.test(node.url)) references.push({ value: node.url, kind: resourceKind, location: location(node.position?.start?.line, node.position?.start?.column) });
    });
    walkMd(tree, (node) => { if (node.type === 'html' && node.value) scanHtml(node.value, add); });
  } else scanHtml(options.source, add);

  const manifestMap = initial;
  const queue: string[] = [];
  const addReference = (reference: Reference, fromPath: string) => {
    if (reference.rawUrl && reference.activeDocument) {
      const key = `blocked:${fromPath}:${reference.location}:${reference.value}`;
      manifestMap.set(key, { path: key, kind: reference.kind, status: 'blocked', references: [reference.location], reason: reference.rawUrl });
      blockers.add(`${reference.location}：${reference.rawUrl}`);
      return;
    }
    const normalized = normalizeLocalReference(reference.value, fromPath);
    if (normalized.ignored) return;
    if (normalized.external) {
      const item = manifestMap.get(reference.value) ?? { path: reference.value, kind: reference.kind, status: 'external' as const, references: [], reason: '保留原有 HTTP(S) 外部依赖。' };
      item.status = 'external';
      if (!item.references.includes(reference.location)) item.references.push(reference.location);
      manifestMap.set(reference.value, item);
      return;
    }
    if (normalized.reason) {
      const item = { path: reference.value, kind: reference.kind, status: 'blocked' as const, references: [reference.location], reason: normalized.reason };
      manifestMap.set(`blocked:${fromPath}:${reference.location}:${reference.value}`, item);
      blockers.add(`${reference.location} ${reference.value}：${normalized.reason}`);
      return;
    }
    const target = normalized.path!;
    const targetBytes = files.get(target);
    if (target !== options.entryPath && /\.(?:md|markdown|html?)$/i.test(target)) {
      const reason = '包内其他笔记不能作为公开资源直接写入；请将其作为单独任务导入。';
      manifestMap.set(`blocked:${fromPath}:${reference.location}:${target}`, { path: target, kind: 'document', status: 'blocked', references: [reference.location], reason });
      blockers.add(`${reference.location} ${reference.value}：${reason}`);
      return;
    }
    let item = manifestMap.get(target);
    if (!item) {
      item = targetBytes
        ? { path: target, kind: reference.kind, status: 'ready', bytes: targetBytes.byteLength, references: [] }
        : { path: target, kind: reference.kind, status: 'missing', references: [], reason: '导入包中没有此文件。' };
      manifestMap.set(target, item);
    }
    item.kind = item.kind === 'other' ? reference.kind : item.kind;
    if (item.status === 'unused') item.status = 'ready';
    if (!item.references.includes(reference.location)) item.references.push(reference.location);
    if (item.status === 'missing') blockers.add(`${reference.location} ${reference.value}：导入包中缺少此资源。`);
    if (targetBytes && !visitedAssets.has(target) && /\.(?:css|mjs|js|cjs)$/i.test(target)) {
      visitedAssets.add(target);
      queue.push(target);
    }
    if (targetBytes && /\.(?:svg|html?)$/i.test(target) && (reference.activeDocument || reference.kind === 'document')) {
      item.status = 'blocked';
      item.reason = /\.svg$/i.test(target) ? 'SVG 作为活动文档不能直接运行；仅支持图片用途。' : '包内其他HTML文档不能作为活动页面直接运行。';
      blockers.add(`${reference.location} ${reference.value}：${item.reason}`);
    }
  };

  for (const reference of references) addReference(reference, options.entryPath);
  while (queue.length) {
    const assetPath = queue.shift()!;
    const bytes = files.get(assetPath);
    if (!bytes) continue;
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { blockers.add(`${assetPath}：文本资源不是有效的UTF-8，无法检查其依赖。`); continue; }
    const nested: Reference[] = [];
    if (/\.css$/i.test(assetPath)) cssReferences(source, assetPath, (reference) => nested.push(reference));
    else scriptReferences(source, assetPath, (reference) => nested.push(reference));
    for (const reference of nested) addReference(reference, assetPath);
  }

  const derivedBody = options.format === 'markdown' ? rewriteMarkdownBody(options.source, options.entryPath, options.noteId, options.files) : undefined;
  return {
    manifest: [...manifestMap.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')),
    blockers: [...blockers],
    warnings: [...manifestMap.values()].filter((item) => item.status === 'external').map((item) => `外部依赖：${item.path}`),
    derivedBody,
  };
}

function scanHtml(source: string, add: (reference: Reference) => void): void {
  const document = parseHtml(source, { sourceCodeLocationInfo: true });
  const walk = (node: HtmlNode) => {
    if ('tagName' in node) {
      const element = node as HtmlElement;
      const tag = element.tagName.toLowerCase();
      const loc = sourceLocation(element);
      const attrs = new Map(element.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
      const srcKind: ResourceKind = ['img', 'image'].includes(tag) ? 'image' : ['video', 'audio', 'source'].includes(tag) ? 'media' : tag === 'link' && /stylesheet|preload/i.test(attrs.get('rel') ?? '') ? 'style' : tag === 'script' ? 'script' : ['iframe', 'object', 'embed'].includes(tag) ? 'document' : 'other';
      for (const name of ['src', 'poster', 'data', 'href', 'xlink:href']) {
        const value = attrs.get(name);
        if (!value) continue;
        if (name === 'href' && tag !== 'link' && !['image', 'use', 'script'].includes(tag)) continue;
        if (tag === 'script' && name !== 'src') continue;
        add({ value, kind: name === 'href' && tag === 'link' ? (srcKind === 'style' ? 'style' : 'other') : srcKind, location: loc, activeDocument: ['iframe', 'object', 'embed'].includes(tag) });
      }
      const srcset = attrs.get('srcset');
      if (srcset) for (const value of srcsetUrls(srcset)) add({ value, kind: 'image', location: loc });
      const metaImage = tag === 'meta' && ((attrs.get('property') ?? '').toLowerCase() === 'og:image' || (attrs.get('name') ?? '').toLowerCase() === 'twitter:image');
      if (metaImage && attrs.get('content')) add({ value: attrs.get('content')!, kind: 'image', location: loc });
      const style = attrs.get('style');
      if (style) cssReferences(style, loc, add);
      if (tag === 'style') {
        const css = element.childNodes.map((child) => 'value' in child ? child.value : '').join('');
        cssReferences(css, loc, add);
      }
      if (tag === 'script') {
        const scriptType = (attrs.get('type') ?? '').toLowerCase();
        if (!attrs.get('src') && !/(?:json|ld\+json)/i.test(scriptType)) {
          const script = element.childNodes.map((child) => 'value' in child ? child.value : '').join('');
          scriptReferences(script, loc, add);
        }
      }
      if (attrs.has('srcdoc')) add({ value: `${loc} srcdoc`, kind: 'document', location: loc, activeDocument: true, rawUrl: '内嵌 srcdoc 文档尚未纳入资源静态分析。' });
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  };
  walk(document);
}

function rewriteMarkdownBody(source: string, entryPath: string, noteId: string, files: PackageFile[]): string {
  const body = markdownBody(source);
  const tree = unified().use(remarkParse).parse(body) as unknown as MdNode;
  const filePaths = new Set(files.map((file) => file.path));
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  walkMd(tree, (node) => {
    if ((node.type !== 'image' && node.type !== 'link') || !node.url) return;
    const normalized = normalizeLocalReference(node.url, entryPath);
    if (!normalized.path || !filePaths.has(normalized.path)) return;
    const span = findDestinationSpan(node, body);
    if (!span) return;
    const raw = body.slice(span.start, span.end);
    const { suffix } = stripSuffix(raw);
    const target = `/note-assets/${encodeURIComponent(noteId)}/${normalized.path.split('/').map(encodeURIComponent).join('/')}${suffix}`;
    replacements.push({ start: span.start, end: span.end, value: target });
  });
  let output = body;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  return output;
}
