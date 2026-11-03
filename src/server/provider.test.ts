import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { providerInternals } from './provider.js';

test('accepts a decodable image and rejects a corrupt image with a plausible extension', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'iver-tools-image-test-'));
  try {
    const valid = path.join(directory, 'valid.png');
    await sharp({ create: { width: 8, height: 6, channels: 3, background: '#52796f' } }).png().toFile(valid);
    const artifact = await providerInternals.readImageArtifact(valid, 'valid.png');
    assert.equal(artifact.mimeType, 'image/png');
    assert.equal(artifact.width, 8);
    assert.equal(artifact.height, 6);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);

    const corrupt = path.join(directory, 'corrupt.png');
    await writeFile(corrupt, Buffer.from('not an image'));
    await assert.rejects(providerInternals.readImageArtifact(corrupt, 'corrupt.png'), /无法通过完整解码校验/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
