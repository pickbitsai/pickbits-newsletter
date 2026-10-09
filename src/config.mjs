// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { readJSON, writeJSON } from './files.mjs';
import { randomSecret, validHash } from './security.mjs';
import { normalizeEmail } from './contacts.mjs';
export const presets = {
  'google-workspace': { host: 'smtp.gmail.com', port: 465, secure: true },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  'microsoft-365': { host: 'smtp.office365.com', port: 587, secure: false },
  generic: {}
};
export function validateConfig(c, { requirePassword = false } = {}) {
  if (c.host !== '127.0.0.1' || c.port !== 4206) throw new Error('Bind only to 127.0.0.1 on port 4206; use an HTTPS reverse proxy for public routes.');
  if (!['smtp', 'capture'].includes(c.transport) || (c.demo && c.transport !== 'capture')) throw new Error('Demo requires the capture transport.');
  for (const key of ['businessName', 'postalAddress']) if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 500 || /[\r\n]/.test(c[key])) throw new Error(`${key} is required and must be a single line.`);
  if (!normalizeEmail(c.sender) || /[\r\n]/.test(c.sender)) throw new Error('A valid sender mailbox is required.');
  if (!/^[a-f0-9]{64,}$/.test(c.secret || '')) throw new Error('Run init to generate a strong signing secret.');
  const publicUrl = new URL(c.publicUrl), admin = new URL(c.adminOrigin);
  if (publicUrl.origin !== c.publicUrl) throw new Error('publicUrl must be a plain origin without a trailing slash.');
  if (publicUrl.protocol !== 'https:' && !(c.demo && c.publicUrl === 'http://127.0.0.1:4206')) throw new Error('publicUrl must use HTTPS outside demo.');
  if (admin.origin !== c.adminOrigin || (admin.protocol !== 'https:' && c.adminOrigin !== 'http://127.0.0.1:4206')) throw new Error('adminOrigin must be HTTPS or the local admin origin.');
  if (c.logoUrl && (!c.logoUrl.startsWith('https://') || /[\s<>"']/.test(c.logoUrl))) throw new Error('Logo must be an HTTPS URL.');
  for (const key of ['messagesPerMinute', 'dailyCap']) if (!Number.isInteger(c[key]) || c[key] < 1 || c[key] > 10000) throw new Error(`${key} must be an integer from 1 to 10000.`);
  if (typeof c.dataDir !== 'string' || !c.dataDir) throw new Error('dataDir is required.');
  if (requirePassword && !validHash(c.passwordHash)) throw new Error('Set an admin password with npm run set-password.');
  if (c.transport === 'smtp') {
    const smtp = { ...c.smtp, ...presets[c.smtp?.preset] };
    if (!(c.smtp?.preset in presets) || !smtp.host || !Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535 || typeof smtp.secure !== 'boolean') throw new Error('Choose a valid SMTP preset, host, port and secure setting.');
    if (!normalizeEmail(smtp.user) || !['password', 'oauth2'].includes(smtp.authType)) throw new Error('SMTP user and authType are required.');
  }
  return c;
}
export function loadConfig(file = 'newsletter.config.json', options) {
  const c = validateConfig(readJSON(file), options);
  return { ...c, configFile: resolve(file), dataDir: resolve(dirname(resolve(file)), c.dataDir) };
}
export function initConfig(file = 'newsletter.config.json') {
  if (existsSync(file)) throw new Error('Config already exists; refusing to overwrite it.');
  const example = readJSON(new URL('../newsletter.config.example.json', import.meta.url));
  example.secret = randomSecret(); writeJSON(file, example);
  mkdirSync(resolve(dirname(resolve(file)), example.dataDir), { recursive: true, mode: 0o700 });
  return example;
}
