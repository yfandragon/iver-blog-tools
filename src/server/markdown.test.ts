import assert from 'node:assert/strict';
import test from 'node:test';
import matter from 'gray-matter';
import { importHtml, importMarkdown, localMarkdownReferences, makeSlug } from './markdown.js';

test('imports frontmatter suggestions while keeping body bytes stable through serialization', () => {
  const body = '\n# 标题建议\r\n\r\n正文有 CRLF、emoji 🪶 和末尾空格。  \n';
  const source = `---\ntitle: ""\nquickReference:\n  label: Existing\n---\n${body}`;
  const imported = importMarkdown('draft-file.md', source, 'task-1', 'prompt', 'article-cover-v1');
  assert.equal(imported.task.title, '标题建议');
  assert.equal(imported.task.body, body);
  assert.deepEqual(imported.frontmatter.quickReference, { label: 'Existing' });
  assert.equal(Object.hasOwn(imported.frontmatter, 'description'), false);
  const rewritten = matter.stringify(imported.task.body, { ...imported.frontmatter, title: imported.task.title, description: 'summary', publishedAt: imported.task.publishedAt });
  assert.equal(matter(rewritten).content, body);
  assert.equal(imported.task.publishedAt.length, 10);
});

test('uses filename as title fallback and creates a safe slug', () => {
  const imported = importMarkdown('My_New-Article.markdown', 'text body', 'task-2', 'prompt', 'v1');
  assert.equal(imported.task.title, 'My New Article');
  assert.equal(imported.task.slug, 'my-new-article');
  assert.equal(makeSlug('../../Unsafe name'), 'unsafe-name');
});

test('detects unresolved local image references and keeps remote images out of the local list', () => {
  assert.deepEqual(localMarkdownReferences([
    '![one](./assets/one.webp)',
    '![two](https://cdn.example.test/two.png)',
    '<img src="/images/local.png">',
    '<img src="data:image/png;base64,abc">',
  ].join('\n')), ['./assets/one.webp', '/images/local.png']);
});


test('imports HTML metadata with title, h1, then filename fallback and excludes executable text', () => {
  const html = '<html><head><title></title><meta property="og:description" content="描述"></head><body><h1>正文标题</h1><p>可搜索正文 faster-whisper</p><script>secretScript()</script><style>.hidden { color: red }</style><div hidden>hidden words</div></body></html>';
  const imported = importHtml('folder/My_Note.html', html, 'task-html', 'prompt', 'v2');
  assert.equal(imported.title, '正文标题');
  assert.equal(imported.description, '描述');
  assert.equal(imported.format, 'html');
  assert.match(imported.body, /faster-whisper/);
  assert.doesNotMatch(imported.body, /secretScript|hidden words|color: red/);
  assert.equal(importHtml('plain-note.html', '<html><head><title></title></head><body>text</body></html>', 'task-html-2', 'prompt', 'v2').title, 'plain note');
});
