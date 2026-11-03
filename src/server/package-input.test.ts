import assert from 'node:assert/strict';
import test from 'node:test';
import { readZipPackage, validatePackageFiles, type PackageFile } from './package-input.js';

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ name: string; data?: string; mode?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data ?? 'x');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((((entry.mode ?? 0o100644) & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

test('validates normalized package paths, collisions, and expanded-size limits', () => {
  const files: PackageFile[] = [{ path: 'notes/./vlearn.html', bytes: Buffer.from('<html/>') }];
  assert.deepEqual(validatePackageFiles(files).map((item) => item.path), ['notes/vlearn.html']);
  assert.throws(() => validatePackageFiles([{ path: '../outside.html', bytes: Buffer.from('x') }]), /路径穿越/);
  assert.throws(() => validatePackageFiles([
    { path: './entry.html', bytes: Buffer.from('one') },
    { path: 'entry.html', bytes: Buffer.from('two') },
  ]), /重复规范化路径/);
});

test('stream-parses a valid ZIP and rejects traversal, normalized collisions, and symlinks', async () => {
  const valid = await readZipPackage(makeZip([{ name: 'notes/vlearn.html', data: '<h1>note</h1>' }, { name: 'notes/assets/图.png', data: 'image' }]));
  assert.deepEqual(valid.map((item) => item.path), ['notes/vlearn.html', 'notes/assets/图.png']);
  await assert.rejects(readZipPackage(makeZip([{ name: '../outside.html' }])), /路径穿越/);
  await assert.rejects(readZipPackage(makeZip([{ name: './entry.html' }, { name: 'entry.html' }])), /重复规范化路径/);
  await assert.rejects(readZipPackage(makeZip([{ name: 'linked.html', mode: 0o120777, data: 'target.html' }])), /符号链接/);
});
