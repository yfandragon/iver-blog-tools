import assert from 'node:assert/strict';
import test from 'node:test';
import { rm } from 'node:fs/promises';
import { createTask, getTask, updateTask } from './task-store.js';

test('metadata edits retain import blockers and invalidate all prepared preview state', async () => {
  let workDir = '';
  try {
    const task = await createTask('fixture.zip', [{
      path: 'notes/entry.html',
      bytes: Buffer.from('<!doctype html><html><head><title>Fixture</title></head><body><img src="./missing.png"></body></html>'),
    }]);
    const record = getTask(task.id);
    workDir = record.workDir;
    const originalBlockers = [...(record.task.blockers ?? [])];
    assert.ok(originalBlockers.some((problem) => problem.includes('missing.png')));

    record.task.targetPath = '/private/tmp/fixture-blog';
    record.task.previewUrl = 'http://127.0.0.1:4000/';
    record.task.articlePreviewUrl = 'http://127.0.0.1:4000/articles/fixture/';
    record.task.fullPagePreviewUrl = 'http://127.0.0.1:4000/articles/fixture/full/';
    record.task.diff = [{ path: 'src/content/articles/fixture.md', change: 'added', patch: 'old' }];
    record.task.fileManifest = [{ path: 'src/content/articles/fixture.md', bytes: 1, sha256: 'a'.repeat(64), kind: 'metadata' }];
    record.task.cover = { originalName: 'cover.png', mimeType: 'image/png', width: 1200, height: 675, bytes: 12, sha256: 'b'.repeat(64) };
    record.task.status = 'prepared';

    const updated = await updateTask(task.id, { title: 'Edited title' });
    assert.deepEqual(updated.blockers, originalBlockers);
    assert.equal(record.metadataDirty, true);
    assert.equal(updated.previewUrl, undefined);
    assert.equal(updated.articlePreviewUrl, undefined);
    assert.equal(updated.fullPagePreviewUrl, undefined);
    assert.equal(updated.diff, undefined);
    assert.equal(updated.fileManifest, undefined);
    assert.equal(updated.status, 'ready');
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
});
