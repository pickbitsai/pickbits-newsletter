// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readJSON, writeJSON } from './files.mjs';
import { parseCSV, writeCSV } from './csv.mjs';
export const statuses = ['subscribed', 'unconfirmed', 'unsubscribed', 'bounced', 'complained'];
export function hasSubscription(contact) {
  return !!contact?.confirmedAt || (['import-attested', 'manual-attested'].includes(contact?.subscription?.method) && !!contact.subscription.source && !!contact.subscription.at);
}
export function normalizeEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  const [local, domain] = email.split('@');
  return email.length <= 254 && local.length <= 64 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/.test(email) && !email.includes('..') && !email.startsWith('.') && !email.includes('.@') && domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? email : null;
}
const short = (value, limit = 120) => String(value || '').trim().slice(0, limit);
export function fields(input) {
  const tags = Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(/[;,]/);
  return { first_name: short(input.first_name), last_name: short(input.last_name), tags: [...new Set(tags.map(t => short(t, 40)).filter(Boolean))].slice(0, 30) };
}
export class Contacts {
  constructor(dir) { this.file = join(dir, 'contacts.json'); }
  read() { return readJSON(this.file, { contacts: [], suppression: {} }); }
  write(data) { writeJSON(this.file, data); }
  all() { return this.read().contacts; }
  get(email) { return this.all().find(c => c.email === email); }
  eligible(contact) { return contact?.status === 'subscribed' && hasSubscription(contact) && !this.read().suppression[contact.email]; }
  add(input, consent) {
    if (!consent) throw new Error('Confirm that these people agreed to receive email from you.');
    const email = normalizeEmail(input.email);
    if (!email) throw new Error('Invalid email address.');
    if (!short(input.consent_source)) throw new Error('Consent source is required.');
    if (input.consent_date && !Number.isFinite(Date.parse(input.consent_date))) throw new Error('Invalid consent date.');
    const data = this.read();
    if (data.contacts.some(c => c.email === email)) throw new Error('Contact already exists.');
    if (data.contacts.length >= 10000) throw new Error('Contact limit reached (10000).');
    const now = new Date().toISOString();
    const contact = { email, ...fields(input), status: data.suppression[email]?.status || 'subscribed', consent_source: short(input.consent_source, 500), consent_date: input.consent_date ? new Date(input.consent_date).toISOString() : now, consentRecordedAt: now, confirmedAt: null, generation: randomUUID() };
    if (contact.status === 'subscribed') contact.subscription = { method: 'manual-attested', source: contact.consent_source, date: contact.consent_date, at: now };
    data.contacts.push(contact); this.write(data); return contact;
  }
  edit(email, input) {
    const data = this.read(), c = data.contacts.find(c => c.email === email);
    if (!c) throw new Error('Contact not found.');
    Object.assign(c, fields(input));
    if (input.status && input.status !== c.status) {
      if (!['unsubscribed', 'bounced', 'complained'].includes(input.status)) throw new Error('Only signup confirmation can subscribe a contact.');
      c.status = input.status; c.generation = randomUUID(); c.pending = null;
      data.suppression[email] = { status: c.status, at: new Date().toISOString() };
    }
    this.write(data);
  }
  suppress(email, status = 'unsubscribed') {
    if (!['unsubscribed', 'bounced', 'complained'].includes(status)) throw new Error('Invalid suppression status.');
    const data = this.read();
    data.suppression[email] = { status, at: new Date().toISOString() };
    const c = data.contacts.find(c => c.email === email);
    if (c) { c.status = status; c.pending = null; c.generation = randomUUID(); }
    this.write(data);
  }
  delete(email) {
    this.suppress(email);
    const data = this.read(); data.contacts = data.contacts.filter(c => c.email !== email); this.write(data);
  }
  beginSignup(input, now = Date.now()) {
    const email = normalizeEmail(input.email); if (!email) throw new Error('Invalid email.');
    const data = this.read(); let c = data.contacts.find(c => c.email === email);
    if (c?.status === 'subscribed' && !data.suppression[email]) return null;
    if (c?.lastSignupAt && now - c.lastSignupAt < 15 * 60 * 1000) return null;
    if (!c) {
      if (data.contacts.length >= 10000) throw new Error('The signup list is full.');
      c = { email, ...fields(input), status: 'unconfirmed', confirmedAt: null, generation: randomUUID() }; data.contacts.push(c);
    }
    const pending = randomUUID();
    // Do not erase suppression until the recipient completes a fresh confirmation.
    c.pending = { id: pending, ...fields({ first_name: input.first_name || c.first_name, last_name: input.last_name || c.last_name, tags: c.tags }), at: new Date(now).toISOString() }; c.lastSignupAt = now;
    this.write(data); return { email, pending };
  }
  confirm(email, pending, now = Date.now()) {
    const data = this.read(), c = data.contacts.find(c => c.email === email);
    if (!c || c.pending?.id !== pending) return false;
    if (c.pending.importId && (c.status !== 'unconfirmed' || data.suppression[email])) return false;
    const source = c.pending.importId ? c.consent_source : 'Public signup: double opt-in';
    const date = c.pending.importId ? c.consent_date : c.pending.at;
    Object.assign(c, fields(c.pending), { status: 'subscribed', confirmedAt: new Date(now).toISOString(), consent_source: source, consent_date: date, consentRecordedAt: new Date(now).toISOString(), subscription: { method: 'signup-confirmed', source, date, at: new Date(now).toISOString() }, generation: randomUUID(), pending: null });
    delete data.suppression[email]; this.write(data); return true;
  }
  beginImportConfirmation(email, importId, generation, now) {
    const data = this.read(), c = data.contacts.find(c => c.email === email);
    if (!c || c.importId !== importId || c.generation !== generation || c.status !== 'unconfirmed' || c.pending || data.suppression[email]) throw Object.assign(new Error('No longer awaiting this confirmation.'), { code: 'SKIP' });
    c.pending = { id: randomUUID(), ...fields(c), importId, at: new Date(now).toISOString() };
    c.lastSignupAt = now;
    this.write(data); return { email, pending: c.pending.id };
  }
  import(csv, { consent = false, source = '', commit = false, mode = 'attested' } = {}) {
    if (!consent) throw new Error('Confirm that these people agreed to receive email from you.');
    if (!['attested', 'confirm'].includes(mode)) throw new Error('Choose already agreed or ask them to confirm first.');
    const rows = parseCSV(csv), headers = rows.shift()?.map(s => s.trim().toLowerCase().replaceAll(' ', '_'));
    if (!headers?.includes('email') || new Set(headers).size !== headers.length) throw new Error('CSV needs unique headers including email.');
    const data = this.read(), existing = new Set(data.contacts.map(c => c.email)), suppressed = new Set(data.contacts.filter(c => ['unsubscribed', 'bounced', 'complained'].includes(c.status)).map(c => c.email)), seen = new Set(), report = [], additions = [];
    const importId = randomUUID(), importedAt = new Date().toISOString();
    if (rows.length > 10000) throw new Error('Import at most 10000 rows at a time.');
    for (const [index, cells] of rows.entries()) {
      const input = Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));
      const email = normalizeEmail(input.email), consentSource = short(input.consent_source || source, 500);
      let result = 'ready';
      if (cells.length !== headers.length) result = 'wrong column count';
      else if (!email) result = 'invalid email';
      else if (data.suppression[email] || suppressed.has(email)) result = 'suppressed';
      else if (seen.has(email) || existing.has(email)) result = 'duplicate';
      else if (!consentSource) result = 'missing consent source';
      else if (input.consent_date && !Number.isFinite(Date.parse(input.consent_date))) result = 'invalid consent date';
      else if (data.contacts.length + additions.length >= 10000) result = 'list full';
      if (email) seen.add(email);
      if (result === 'ready') {
        const now = new Date().toISOString();
        const date = input.consent_date ? new Date(input.consent_date).toISOString() : now;
        additions.push({ email, ...fields(input), status: mode === 'attested' ? 'subscribed' : 'unconfirmed', confirmedAt: null, consent_source: consentSource, consent_date: date, consentRecordedAt: now, generation: randomUUID(), importId, ...(mode === 'attested' ? { subscription: { method: 'import-attested', source: consentSource, date, at: now } } : {}) });
      }
      report.push({ row: index + 2, email: email || input.email, result: commit && result === 'ready' ? `imported (${mode === 'attested' ? 'subscribed' : 'unconfirmed'})` : result });
    }
    if (commit) {
      data.contacts.push(...additions);
      data.imports ||= {};
      data.imports[importId] = { id: importId, mode, createdAt: importedAt, count: additions.length, status: 'draft' };
      this.write(data);
      report.importId = importId;
    }
    return report;
  }
  export() {
    const headers = ['email', 'first_name', 'last_name', 'tags', 'status', 'consent_source', 'consent_date', 'confirmed_at', 'subscription_method', 'subscribed_at', 'output_stamp (Made with PickBits Newsletter)'];
    return writeCSV([headers, ...this.all().map(c => [c.email, c.first_name, c.last_name, c.tags.join(';'), c.status, c.consent_source, c.consent_date, c.confirmedAt, c.subscription?.method || (c.confirmedAt ? 'signup-confirmed' : ''), c.subscription?.at || c.confirmedAt, 'Made with PickBits Newsletter'])]);
  }
}
