import assert from 'node:assert/strict';
import test from 'node:test';
import { scanResources } from './resource-scanner.js';
import type { PackageFile } from './package-input.js';

function file(path: string, text: string): PackageFile { return { path, bytes: Buffer.from(text) }; }

test('scans nested HTML, CSS, and module references without confusing SVG fragments or external URLs', () => {
  const files = [
    file('notes/vlearn.html', `<!doctype html><html><head><meta name="description" content="一份笔记"><meta property="og:image" content="assets/封面 图.png"><base href="./"><link rel="stylesheet" href="styles/main.css"><script type="module" src="scripts/main.js"></script></head><body><img src="图像/流程 图.png?size=2#wide"><img src="https://cdn.example.test/picture.png"><a href="https://example.test/">外链</a><div style="background:url(#local)"></div><iframe src="./missing.html"></iframe><script type="module">import("./scripts/dynamic.js")</script></body></html>`),
    file('notes/assets/封面 图.png', 'image'),
    file('notes/图像/流程 图.png', 'image'),
    file('notes/styles/main.css', `@import "../theme/base.css"; .hero{background-image:url("../图像/装饰 图.svg#shape")} @font-face{src:url('../fonts/正文.woff2')}`),
    file('notes/theme/base.css', `.x{mask:url(#mask);background:url(data:image/png;base64,AAAA)}`),
    file('notes/图像/装饰 图.svg', '<svg/>'),
    file('notes/fonts/正文.woff2', 'font'),
    file('notes/scripts/main.js', `import './modules/子模块.js'; document.querySelector('button').addEventListener('click', () => {});`),
    file('notes/scripts/modules/子模块.js', `export const ready = true;`),
  ];
  const result = scanResources({ format: 'html', entryPath: 'notes/vlearn.html', noteId: 'dual-note', source: files[0]!.bytes.toString(), files });
  const paths = new Map(result.manifest.map((item) => [item.path, item]));
  for (const asset of ['notes/assets/封面 图.png', 'notes/图像/流程 图.png', 'notes/styles/main.css', 'notes/theme/base.css', 'notes/图像/装饰 图.svg', 'notes/fonts/正文.woff2', 'notes/scripts/main.js', 'notes/scripts/modules/子模块.js']) {
    assert.equal(paths.get(asset)?.status, 'ready', asset);
  }
  assert.ok(result.manifest.some((item) => item.status === 'blocked' && item.reason?.includes('包内其他笔记')));
  assert.ok(result.blockers.some((problem) => problem.includes('包内其他笔记')));
  assert.ok(result.manifest.some((item) => item.status === 'external' && item.path.startsWith('https://')));
  assert.equal(paths.has('#local'), false);
  assert.equal(paths.has('data:image/png;base64,AAAA'), false);
  assert.equal(paths.get('notes/图像/装饰 图.svg')?.kind, 'image');
});

test('reports missing and local absolute dependencies, and blocks computed dynamic imports', () => {
  const source = `<img src="./absent.png"><img src="file:///Users/me/private.png"><script type="module">const name = 'x'; import('./' + name);</script>`;
  const result = scanResources({ format: 'html', entryPath: 'vlearn.html', noteId: 'note', source, files: [file('vlearn.html', source)] });
  assert.ok(result.manifest.some((item) => item.status === 'missing' && item.path === 'absent.png'));
  assert.ok(result.manifest.some((item) => item.status === 'blocked' && item.reason?.includes('本机绝对路径')));
  assert.ok(result.blockers.some((problem) => problem.includes('动态 import 参数无法静态解析')));
});

test('rewrites only parsed Markdown resource destinations and preserves body text and suffixes', () => {
  const source = `---\ntitle: Note\n---\n\n\`\`\`md\n![example](./not-real.png)\n\`\`\`\n\n![同名地址 ./assets/中文 图.webp](<./assets/中文 图.webp?width=2#crop>)\n`;
  const files = [file('folder/note.md', source), file('folder/assets/中文 图.webp', 'image')];
  const result = scanResources({ format: 'markdown', entryPath: 'folder/note.md', noteId: 'note-id', source, files });
  assert.equal(result.blockers.length, 0);
  assert.ok(result.manifest.some((item) => item.path === 'folder/assets/中文 图.webp' && item.status === 'ready'));
  assert.match(result.derivedBody ?? '', /!\[example\]\(\.\/not-real\.png\)/);
  assert.match(result.derivedBody ?? '', /!\[同名地址 \.\/assets\/中文 图\.webp\]\(<\/note-assets\/note-id\/folder\/assets\/%E4%B8%AD%E6%96%87%20%E5%9B%BE\.webp\?width=2#crop>\)/);
  assert.equal(result.derivedBody?.startsWith('\n'), true);
});
