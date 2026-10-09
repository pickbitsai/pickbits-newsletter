// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { createHmac, randomBytes, timingSafeEqual, scryptSync, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const randomSecret = () => randomBytes(32).toString('hex');
export function signToken(secret, purpose, payload, ttlMs, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...payload, purpose, exp: ttlMs === null ? null : now + ttlMs, nonce: randomBytes(16).toString('hex') })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyToken(secret, token, purpose, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 3000) return null;
    const [body, mac, extra] = token.split('.');
    if (extra || !body || !mac) return null;
    const expected = createHmac('sha256', secret).update(body).digest('base64url');
    if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.purpose !== purpose || (data.exp !== null && (!Number.isFinite(data.exp) || data.exp <= now))) return null;
    return data;
  } catch { return null; }
}
export function hashPassword(password) {
  if (password.length < 12 || password.length > 256) throw new Error('Use a password between 12 and 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export async function checkPassword(password, hash) {
  if (!validHash(hash) || typeof password !== 'string' || password.length > 256) return false;
  const [, salt, expected] = hash.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export const validHash = hash => /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '');
export const sessionKey = config => createHmac('sha256', config.secret).update(config.passwordHash).digest('hex');
export function sessionCookie(config, now) {
  const token = signToken(sessionKey(config), 'session', {}, 8 * 60 * 60 * 1000, now);
  return `newsletter_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${config.adminOrigin.startsWith('https:') ? '; Secure' : ''}`;
}
export function authenticated(request, config) {
  const token = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('newsletter_session='))?.slice(19);
  return !!verifyToken(sessionKey(config), token, 'session');
}
export function sameOrigin(request, config) { return request.headers.get('origin') === config.adminOrigin; }
export class RateLimiter {
  constructor(now = Date.now) { this.now = now; this.entries = new Map(); }
  allow(key, limit, windowMs) {
    const now = this.now();
    for (const [id, item] of this.entries) if (item.until <= now) this.entries.delete(id);
    if (!this.entries.has(key)) {
      if (this.entries.size >= 10000) return false;
      this.entries.set(key, { count: 0, until: now + windowMs });
    }
    return ++this.entries.get(key).count <= limit;
  }
}
