import matter from 'gray-matter';
import path from 'node:path';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { ArticleTask } from '../shared/types.js';

export type ImportedMarkdown = {
  task: ArticleTask;
  frontmatter: Record<string, unknown>;
  originalBody: string;
};

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function frontmatterDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value.slice(0, 10);
  return undefined;
}

function plainTitle(value: string): string {
  return value.replace(/\s+#*\s*$/, '').replace(/[*_`~]/g, '').trim();
}

export function makeSlug(value: string): string {
  const slug = value.normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '');
  return slug || 'new-article';
}

export function importMarkdown(sourceName: string, source: string, id: string, prompt: string, promptVersion: string): ImportedMarkdown {
  const parsed = matter(source);
  const frontmatterMatch = source.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  // gray-matter removes the structural line break after the closing delimiter;
  // restore the exact body bytes after that delimiter for later serialization.
  const originalBody = frontmatterMatch ? source.slice(frontmatterMatch[0].length) : source;
  const frontmatter = parsed.data as Record<string, unknown>;
  const h1 = originalBody.match(/^\s*#\s+(.+?)\s*#*\s*$/m)?.[1];
  const fileTitle = path.basename(sourceName, path.extname(sourceName)).replace(/[-_]+/g, ' ').trim();
  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : plainTitle(h1 ?? fileTitle) || '未命名文章';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const coverAlt = typeof frontmatter.coverAlt === 'string' ? frontmatter.coverAlt : '';
  const publishedAt = frontmatterDate(frontmatter.publishedAt) ?? localDate();
  const warnings: string[] = [];
  if (!description.trim()) warnings.push('缺少摘要；请填写或让 Codex 起草。');

  const task: ArticleTask = {
    id,
    sourceName: path.basename(sourceName),
    slug: makeSlug(title !== '未命名文章' ? title : fileTitle),
    title,
    description,
    publishedAt,
    coverAlt,
    prompt,
    promptVersion,
    body: originalBody,
    format: 'markdown',
    warnings,
    status: 'draft',
  };
  return { task, frontmatter, originalBody };
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

function findHtmlElement(node: HtmlNode, tag: string): HtmlElement | undefined {
  if ('tagName' in node && node.tagName === tag) return node as HtmlElement;
  if ('childNodes' in node) for (const child of node.childNodes) {
    const found = findHtmlElement(child, tag);
    if (found) return found;
  }
}

function htmlText(node: HtmlNode | undefined, blocked = false): string {
  if (!node || blocked) return '';
  if ('tagName' in node) {
    const element = node as HtmlElement;
    if (['script', 'style', 'noscript', 'template'].includes(element.tagName)
      || element.attrs.some((attr) => attr.name === 'hidden' || attr.name === 'aria-hidden' && attr.value === 'true')) return '';
  }
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('childNodes' in node) return node.childNodes.map((child) => htmlText(child)).join(' ');
  return '';
}

export function importHtml(sourceName: string, source: string, id: string, prompt: string, promptVersion: string): ArticleTask {
  const document = parse(source);
  const titleElement = findHtmlElement(document, 'title');
  const headingElement = findHtmlElement(document, 'h1');
  const title = [titleElement, headingElement]
    .map((element) => htmlText(element).replace(/\s+/g, ' ').trim())
    .find(Boolean)
    || path.basename(sourceName, path.extname(sourceName)).replace(/[-_]+/g, ' ').trim()
    || '未命名文章';
  const meta: HtmlElement[] = [];
  const collectMeta = (node: HtmlNode): void => {
    if ('tagName' in node && node.tagName === 'meta') meta.push(node as HtmlElement);
    if ('childNodes' in node) for (const child of node.childNodes) collectMeta(child);
  };
  collectMeta(document);
  const value = (name: string, key: string) => meta.find((element) => element.attrs.some((attr) => attr.name.toLowerCase() === name && attr.value.toLowerCase() === key))?.attrs.find((attr) => attr.name.toLowerCase() === 'content')?.value ?? '';
  const description = value('name', 'description') || value('property', 'og:description');
  return {
    id,
    sourceName: path.basename(sourceName),
    slug: makeSlug(title),
    title,
    description,
    publishedAt: localDate(),
    coverAlt: '',
    prompt,
    promptVersion,
    body: htmlText(findHtmlElement(document, 'body')).replace(/\s+/g, ' ').trim(),
    format: 'html',
    warnings: description.trim() ? [] : ['缺少摘要；请填写或让 Codex 起草。'],
    status: 'draft',
  };
}

export function localMarkdownReferences(body: string): string[] {
  const references = new Set<string>();
  const patterns = [
    /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\s*\)/g,
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const source = (match[1] ?? match[2] ?? '').trim().replace(/&amp;/g, '&');
      if (!source || source.startsWith('#') || /^(?:https?:|data:|mailto:|blob:|\/\/)/i.test(source)) continue;
      if (source.startsWith('/')) references.add(source);
      else references.add(source.split(/[?#]/, 1)[0]);
    }
  }
  return [...references].filter(Boolean);
}
