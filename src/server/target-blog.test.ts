import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectTarget, prepareTarget, publishTask } from './target-blog.js';
import { createHash } from 'node:crypto';
import type { TaskRecord } from './task-store.js';
import type { ArticleTask } from '../shared/types.js';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);
const schema = `import { defineCollection } from 'astro:content';\nimport { z } from 'astro/zod';\nimport { glob } from 'astro/loaders';\nconst articles = defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/articles' }), schema: ({ image }) => z.object({ title: z.string().trim().min(1), description: z.string().trim().min(1), publishedAt: z.coerce.date(), cover: image().optional(), coverAlt: z.string().optional() }) });`;

async function createTarget(root: string, compatible = true): Promise<void> {
  await mkdir(path.join(root, 'src/content/articles'), { recursive: true });
  await mkdir(path.join(root, 'src/assets/covers'), { recursive: true });
  await mkdir(path.join(root, 'src/pages'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'temp-blog', scripts: { dev: 'node dev.mjs' }, devDependencies: { astro: '5.0.0' } }));
  await writeFile(path.join(root, 'src/content.config.ts'), compatible ? schema : 'export const collections = {};');
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), 'temporary fixture\n');
  await execFileAsync('git', ['add', 'README.md', 'package.json', 'src'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'fixture'], { cwd: root });
}

function recordFor(root: string, coverFile: string): TaskRecord {
  const task: ArticleTask = {
    id: 'fixture-task', sourceName: 'draft.md', slug: 'fixture-post', title: 'Fixture Post',
    description: 'An integration fixture.', publishedAt: '2026-10-28', coverAlt: '',
    prompt: 'prompt copy', promptVersion: 'article-cover-v1', body: '\n# Fixture Post\n\nBody stays intact.\n',
    format: 'markdown', entryPath: 'draft.md',
    warnings: [], status: 'ready', cover: { originalName: 'generated.png', mimeType: 'image/png', width: 16, height: 9, bytes: 0, sha256: 'x' },
  };
  return { task, frontmatter: {}, workDir: root, coverFile, packageFiles: [], importWarnings: [] };
}

test('only recognizes a compatible Astro content schema and Git root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-target-test-'));
  try {
    await createTarget(root);
    const inspected = await inspectTarget(root);
    assert.equal(inspected.root, await realpath(root));
    assert.equal(inspected.branch, 'main');
    await writeFile(path.join(root, 'src/content.config.ts'), 'export const collections = {};');
    await assert.rejects(inspectTarget(root), /schema与已核对的IverBlog约定不兼容/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stops before writing when a relative resource is missing or the article already exists', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-prepare-test-'));
  try {
    await createTarget(root);
    const coverFile = path.join(root, 'generated.png');
    await sharp({ create: { width: 16, height: 9, channels: 3, background: '#79998a' } }).png().toFile(coverFile);
    const record = recordFor(root, coverFile);
    record.task.body = '\n![missing](./not-here.png)\n';
    record.task.blockers = ['1:2 ./not-here.png：导入包中缺少此资源。'];
    await assert.rejects(prepareTarget(record, root, () => undefined), /资源仍有阻塞问题/);
    assert.equal(await readFile(path.join(root, 'src/content/articles'), 'utf8').catch(() => ''), '');

    record.task.body = '\nSafe body.\n';
    record.task.blockers = [];
    const articlePath = path.join(root, 'src/content/articles/fixture-post.md');
    await writeFile(articlePath, 'existing content');
    await assert.rejects(prepareTarget(record, root, () => undefined), /目标文件已存在，拒绝覆盖/);
    assert.equal(await readFile(articlePath, 'utf8'), 'existing content');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blocks other staged changes, then commits and pushes only the prepared files', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-publish-test-'));
  const root = path.join(workspace, 'blog');
  const remote = path.join(workspace, 'publish.git');
  try {
    await mkdir(root, { recursive: true });
    await createTarget(root);
    await execFileAsync('git', ['init', '--bare', '-q', remote], { cwd: workspace });
    await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: root });
    await execFileAsync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: root });

    const articlePath = 'src/content/articles/测试文章.md';
    const coverPath = 'src/assets/covers/测试文章-v1.webp';
    const articleText = `---\ntitle: Fixture Post\ndescription: Fixture summary.\npublishedAt: '2026-10-28'\ncover: ../../assets/covers/测试文章-v1.webp\ncoverAlt: ''\n---\n\n# Fixture Post\n\nOriginal body.\n`;
    const coverBytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#52796f' } }).webp().toBuffer();
    await writeFile(path.join(root, articlePath), articleText, { flag: 'wx' });
    await writeFile(path.join(root, coverPath), coverBytes, { flag: 'wx' });

    const record = recordFor(root, path.join(workspace, 'unused.png'));
    record.task.slug = '测试文章';
    record.task.entryPath = '测试文章.md';
    record.task.format = 'markdown';
    record.task.targetPath = await realpath(root);
    record.task.articlePath = articlePath;
    record.task.coverPath = coverPath;
    record.task.currentBranch = 'main';
    record.task.pushTarget = 'origin/main';
    record.task.diff = [{ path: articlePath, change: 'added', patch: 'article' }, { path: coverPath, change: 'added', patch: 'image' }];
    record.pushRemote = 'origin';
    record.pushBranch = 'main';
    record.localBranch = 'main';
    record.preparedPaths = [articlePath, coverPath];
    record.preparedSnapshot = new Map([
      [articlePath, createHash('sha256').update(articleText).digest('hex')],
      [coverPath, createHash('sha256').update(coverBytes).digest('hex')],
    ]);
    record.preparedContents = new Map([[articlePath, Buffer.from(articleText)], [coverPath, coverBytes]]);
    record.task.fileManifest = [
      { path: articlePath, bytes: Buffer.byteLength(articleText), sha256: createHash('sha256').update(articleText).digest('hex'), kind: 'metadata' },
      { path: coverPath, bytes: coverBytes.byteLength, sha256: createHash('sha256').update(coverBytes).digest('hex'), kind: 'cover' },
    ];

    await writeFile(path.join(root, 'README.md'), 'unrelated local work\n', { flag: 'a' });
    await execFileAsync('git', ['add', '--', 'README.md'], { cwd: root });
    await assert.rejects(publishTask(record, () => undefined), /已有暂存改动.*README\.md/);
    const stagedBefore = await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: root });
    assert.equal(stagedBefore.stdout.trim(), 'README.md');
    await execFileAsync('git', ['reset', '--', 'README.md'], { cwd: root });

    const result = await publishTask(record, () => undefined);
    assert.equal(result.status, 'published');
    assert.ok(result.commitHash);
    const names = await execFileAsync('git', ['show', '--format=', '--name-only', '-z', 'HEAD'], { cwd: root });
    assert.deepEqual(names.stdout.split('\0').filter(Boolean).sort(), [articlePath, coverPath].sort());
    const remaining = await execFileAsync('git', ['status', '--porcelain', '-z'], { cwd: root });
    assert.deepEqual(remaining.stdout.split('\0').filter(Boolean), [' M README.md']);
    const pushed = await execFileAsync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', '-z', 'main'], { cwd: workspace });
    const pushedNames = pushed.stdout.split('\0').filter(Boolean);
    assert.ok(pushedNames.includes(articlePath));
    assert.ok(pushedNames.includes(coverPath));
    const remoteReadme = await execFileAsync('git', ['--git-dir', remote, 'show', 'main:README.md'], { cwd: workspace });
    assert.equal(remoteReadme.stdout.includes('unrelated local work'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

async function createHtmlTarget(root: string): Promise<void> {
  await createTarget(root);
  await writeFile(path.join(root, 'src/content.config.ts'), `${schema}\nconst htmlFields = { contentFormat: z.enum(['markdown', 'html']), htmlSource: z.string().trim().min(1).optional(), htmlBasePath: z.string().optional() };`);
  await mkdir(path.join(root, 'src/pages/articles/[id]'), { recursive: true });
  await mkdir(path.join(root, 'src/lib'), { recursive: true });
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await writeFile(path.join(root, 'src/pages/articles/[...id].astro'), '<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" srcdoc={htmlDocument}></iframe>');
  await writeFile(path.join(root, 'src/pages/articles/[id]/full.astro'), 'renderHtmlNote(rawHtml)');
  await writeFile(path.join(root, 'src/lib/html-note.ts'), 'export async function renderHtmlNote() {}');
  await writeFile(path.join(root, 'scripts/build-pagefind.mjs'), 'index.addCustomRecord({ url: "/" });');
  await execFileAsync('git', ['add', 'src', 'scripts'], { cwd: root });
  await execFileAsync('git', ['commit', '-qm', 'add HTML note hosting support'], { cwd: root });
}

test('refuses to refresh a preview when a task file no longer matches its SHA-256 snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-snapshot-test-'));
  try {
    await createTarget(root);
    const coverFile = path.join(root, 'generated.png');
    await sharp({ create: { width: 16, height: 9, channels: 3, background: '#79998a' } }).png().toFile(coverFile);
    const record = recordFor(root, coverFile);
    const articlePath = 'src/content/articles/fixture-post.md';
    const coverPath = 'src/assets/covers/fixture-post-v1.webp';
    const articleText = 'previously prepared metadata';
    const coverBytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#79998a' } }).webp().toBuffer();
    await writeFile(path.join(root, articlePath), articleText);
    await writeFile(path.join(root, coverPath), coverBytes);
    record.task.targetPath = root;
    record.task.articlePath = articlePath;
    record.task.coverPath = coverPath;
    record.task.targetPath = await realpath(root);
    record.task.status = 'prepared';
    record.preparedPaths = [articlePath, coverPath];
    record.preparedSnapshot = new Map([
      [articlePath, createHash('sha256').update(articleText).digest('hex')],
      [coverPath, createHash('sha256').update(coverBytes).digest('hex')],
    ]);
    record.preparedContents = new Map([[articlePath, Buffer.from(articleText)], [coverPath, coverBytes]]);
    record.task.fileManifest = [
      { path: articlePath, bytes: Buffer.byteLength(articleText), sha256: createHash('sha256').update(articleText).digest('hex'), kind: 'metadata' },
      { path: coverPath, bytes: coverBytes.byteLength, sha256: createHash('sha256').update(coverBytes).digest('hex'), kind: 'cover' },
    ];

    await writeFile(path.join(root, articlePath), 'manual change after preview');
    await assert.rejects(prepareTarget(record, root, () => undefined), /旧预览文件已被修改，拒绝安全更新/);
    assert.equal(await readFile(path.join(root, articlePath), 'utf8'), 'manual change after preview');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('publishes an HTML note manifest to a local bare remote without staging unrelated files', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-html-publish-test-'));
  const root = path.join(workspace, 'blog');
  const remote = path.join(workspace, 'publish.git');
  try {
    await mkdir(root, { recursive: true });
    await createHtmlTarget(root);
    await execFileAsync('git', ['init', '--bare', '-q', remote], { cwd: workspace });
    await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: root });
    await execFileAsync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: root });
    const baseline = await execFileAsync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', '-z', 'main'], { cwd: workspace });
    const baselineNames = baseline.stdout.split('\0').filter(Boolean);

    const metadataPath = 'src/content/articles/html-fixture.md';
    const htmlPath = 'src/content/articles/html-fixture.html';
    const resourcePath = 'public/note-assets/html-fixture/folder/assets/图.png';
    const coverPath = 'src/assets/covers/html-fixture-v1.webp';
    const coverBytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#52796f' } }).webp().toBuffer();
    const resourceBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#52796f' } }).png().toBuffer();
    const outputs = new Map([
      [metadataPath, { kind: 'metadata' as const, bytes: Buffer.from("---\ntitle: HTML Fixture\ndescription: HTML resource fixture.\npublishedAt: '2026-11-03'\ncontentFormat: html\nhtmlSource: html-fixture.html\nhtmlBasePath: folder\ncover: ../../assets/covers/html-fixture-v1.webp\ncoverAlt: ''\n---\n") }],
      [htmlPath, { kind: 'html' as const, bytes: Buffer.from('<!doctype html><title>Original HTML</title><img src="folder/assets/图.png">') }],
      [resourcePath, { kind: 'resource' as const, bytes: resourceBytes }],
      [coverPath, { kind: 'cover' as const, bytes: coverBytes }],
    ]);
    for (const [relative, output] of outputs) {
      const absolute = path.join(root, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, output.bytes, { flag: 'wx' });
    }

    const record = recordFor(root, path.join(workspace, 'unused.png'));
    record.task.slug = 'html-fixture';
    record.task.title = 'HTML Fixture';
    record.task.description = 'HTML resource fixture.';
    record.task.publishedAt = '2026-11-03';
    record.task.format = 'html';
    record.task.entryPath = 'folder/entry.html';
    record.task.resourceManifest = [{ path: 'folder/assets/图.png', kind: 'image', status: 'ready', references: ['folder/entry.html:1:1'] }];
    record.task.blockers = [];
    record.task.targetPath = root;
    record.task.articlePath = metadataPath;
    record.task.coverPath = coverPath;
    record.task.currentBranch = 'main';
    record.task.pushTarget = 'origin/main';
    record.task.diff = [...outputs.keys()].map((relative) => ({ path: relative, change: 'added', patch: relative }));
    record.task.fileManifest = [...outputs].map(([relative, output]) => ({
      path: relative,
      bytes: output.bytes.byteLength,
      sha256: createHash('sha256').update(output.bytes).digest('hex'),
      kind: output.kind,
    }));
    record.task.status = 'prepared';
    record.pushRemote = 'origin';
    record.pushBranch = 'main';
    record.localBranch = 'main';
    record.preparedPaths = [...outputs.keys()].sort();
    record.preparedSnapshot = new Map([...outputs].map(([relative, output]) => [relative, createHash('sha256').update(output.bytes).digest('hex')]));
    record.preparedContents = new Map([...outputs].map(([relative, output]) => [relative, output.bytes]));

    await writeFile(path.join(root, 'README.md'), 'unrelated local work\n', { flag: 'a' });
    await execFileAsync('git', ['add', '--', 'README.md'], { cwd: root });
    await assert.rejects(publishTask(record, () => undefined), /已有暂存改动.*README\.md/);
    await execFileAsync('git', ['reset', '--', 'README.md'], { cwd: root });

    const result = await publishTask(record, () => undefined);
    assert.equal(result.status, 'published');
    const committed = await execFileAsync('git', ['show', '--format=', '--name-only', '-z', 'HEAD'], { cwd: root });
    assert.deepEqual(committed.stdout.split('\0').filter(Boolean).sort(), [...outputs.keys()].sort());
    const pushed = await execFileAsync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', '-z', 'main'], { cwd: workspace });
    const pushedNames = pushed.stdout.split('\0').filter(Boolean);
    assert.deepEqual(pushedNames.filter((name) => !baselineNames.includes(name)).sort(), [...outputs.keys()].sort());
    const remaining = await execFileAsync('git', ['status', '--porcelain', '-z'], { cwd: root });
    assert.ok(remaining.stdout.split('\0').filter(Boolean).includes(' M README.md'));
    assert.equal(result.fileManifest?.length, 4);
    assert.deepEqual(new Set(result.fileManifest?.map((item) => item.kind)), new Set(['metadata', 'html', 'resource', 'cover']));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('refuses HTML preparation when the target Blog has no verified HTML host support', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-html-capability-test-'));
  try {
    await createTarget(root);
    const coverFile = path.join(root, 'generated.png');
    await sharp({ create: { width: 16, height: 9, channels: 3, background: '#79998a' } }).png().toFile(coverFile);
    const record = recordFor(root, coverFile);
    record.task.format = 'html';
    record.task.entryPath = 'draft.html';
    record.task.blockers = [];
    await assert.rejects(prepareTarget(record, root, () => undefined), /缺少经检查的 HTML 承载基础.*拒绝写入/);
    await assert.rejects(readFile(path.join(root, 'src/content/articles/fixture-post.md'), 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
