// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function atomicWrite(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  // Directory fsync is available on POSIX; Windows does not support opening directories this way.
  if (process.platform !== 'win32') {
    const dir = openSync(dirname(file), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}
export const writeJSON = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
export function readJSON(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error; }
}
export function lockDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'process.lock.local');
  if (existsSync(file)) {
    const old = readJSON(file);
    let alive = true;
    try { process.kill(old.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('Data directory is already in use. Stop the other newsletter process first.');
    unlinkSync(file);
  }
  const fd = openSync(file, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncSync(fd); closeSync(fd);
  return () => { if (existsSync(file) && readJSON(file).pid === process.pid) unlinkSync(file); };
}
