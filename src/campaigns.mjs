// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { readdirSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readJSON, writeJSON } from './files.mjs';
import { campaignMessage, campaignHash } from './render.mjs';
import { hasSubscription } from './contacts.mjs';

export class Campaigns {
  constructor(dir, folder = 'campaigns') { this.dir = join(dir, folder); mkdirSync(this.dir, { recursive: true, mode: 0o700 }); }
  path(id, journal = false) {
    if (!/^[a-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid campaign identifier.');
    return join(this.dir, `${id}${journal ? '.journal' : ''}.json`);
  }
  get(id) { return readJSON(this.path(id)); }
  all() { return readdirSync(this.dir).filter(f => f.endsWith('.json') && !f.endsWith('.journal.json')).map(f => this.get(f.slice(0, -5))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  save(input, id = randomUUID()) {
    let old; try { old = this.get(id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (old && old.status !== 'draft') throw new Error('Started campaigns are immutable. Create a new draft.');
    const subject = String(input.subject || '').trim(), markdown = String(input.markdown || '');
    if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !markdown.trim() || markdown.length > 100000) throw new Error('Use a subject (1–200 characters) and a message (up to 100000 characters).');
    const c = { id, subject, markdown, tag: String(input.tag || '').trim().slice(0, 40), status: 'draft', createdAt: old?.createdAt || new Date().toISOString(), testedHash: null };
    this.write(c); return c;
  }
  write(c) { writeJSON(this.path(c.id), c); }
  journal(id) { return readJSON(this.path(id, true), null); }
  writeJournal(id, journal) { writeJSON(this.path(id, true), journal); }
  counts(id) {
    const j = this.journal(id), result = { total: 0, pending: 0, inflight: 0, sent: 0, failed: 0, uncertain: 0, skipped: 0 };
    for (const item of Object.values(j?.recipients || {})) { result.total++; result[item.status]++; }
    return result;
  }
}

export class Sender {
  constructor(config, contacts, campaigns, delivery) { Object.assign(this, { config, contacts, campaigns, delivery }); this.jobs = new Map(); }
  audience(campaign) {
    const data = this.contacts.read();
    return data.contacts.filter(c => c.status === 'subscribed' && hasSubscription(c) && !data.suppression[c.email] && (!campaign.tag || c.tags.includes(campaign.tag)));
  }
  eligible(contact, item) { return this.contacts.eligible(contact) && contact.generation === item.generation; }
  message(journal, contact) { return campaignMessage({ ...this.config, ...journal.messageConfig }, journal.campaign, contact); }
  async test(id) {
    const c = this.campaigns.get(id);
    if (c.status !== 'draft') throw new Error('Only drafts can send a test.');
    const hash = campaignHash(c, this.config);
    await this.delivery.send(campaignMessage(this.config, c, { email: this.config.sender, first_name: 'Owner', generation: 'test' }));
    const latest = this.campaigns.get(id);
    if (campaignHash(latest, this.config) === hash) { latest.testedHash = hash; this.campaigns.write(latest); }
  }
  prepare(id) {
    const c = this.campaigns.get(id);
    let j = this.campaigns.journal(id);
    if (!j) {
      if (c.testedHash !== campaignHash(c, this.config)) throw new Error('Send a successful test of this draft before sending the campaign.');
      const recipients = Object.fromEntries(this.audience(c).map(contact => [contact.email, { status: 'pending', generation: contact.generation }]));
      const messageConfig = Object.fromEntries(['businessName','postalAddress','logoUrl','sender','publicUrl'].map(key => [key,this.config[key]]));
      j = { version: 1, campaign: c, messageConfig, recipients, createdAt: new Date().toISOString() };
      this.campaigns.writeJournal(id, j);
    }
    c.status = 'sending'; this.campaigns.write(c); return j;
  }
  start(id) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    this.prepare(id);
    const job = this.run(id).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job); return job;
  }
  recover() {
    for (const c of this.campaigns.all()) {
      const j = this.campaigns.journal(c.id); if (!j) continue;
      for (const item of Object.values(j.recipients)) if (item.status === 'inflight') { item.status = 'uncertain'; item.error = 'Interrupted attempt; not retried to avoid duplicate delivery.'; }
      this.campaigns.writeJournal(c.id, j);
      if (Object.values(j.recipients).some(r => r.status === 'pending')) { c.status = 'paused'; this.campaigns.write(c); }
      else { c.status = 'complete'; this.campaigns.write(c); }
    }
  }
  async run(id) {
    const j = this.campaigns.journal(id), c = this.campaigns.get(id);
    try {
      for (const [email, item] of Object.entries(j.recipients)) {
        if (item.status !== 'pending') continue;
        const contact = this.contacts.get(email);
        if (!this.eligible(contact, item, c)) { item.status = 'skipped'; this.campaigns.writeJournal(id, j); continue; }
        try {
          await this.delivery.send(() => this.message(j, this.contacts.get(email)), () => {
            const current = this.contacts.get(email);
            if (!this.eligible(current, item, c)) throw Object.assign(new Error('No longer eligible.'), { code: 'SKIP' });
            item.status = 'inflight'; item.at = new Date(this.delivery.now()).toISOString(); this.campaigns.writeJournal(id, j);
          });
          item.status = 'sent';
        } catch (error) {
          if (['CAP', 'STOP', 'ABORT_ERR'].includes(error.code)) { c.status = 'paused'; c.note = error.code === 'CAP' ? 'Daily cap reached; resumes on the next UTC day.' : 'Stopped; pending messages will resume.'; break; }
          if (error.code === 'SKIP') item.status = 'skipped';
          else {
            const responseCode = Number(error.responseCode);
            item.status = responseCode >= 400 && responseCode < 600 ? 'failed' : 'uncertain';
            // Do not persist raw provider replies: they can contain credentials or private server details.
            item.error = Number.isInteger(responseCode) ? `SMTP ${responseCode}; ${error.code === 'EAUTH' ? 'authentication failed' : 'message rejected'}.` : 'Connection or local failure; delivery uncertain. Check provider records.';
            if (responseCode >= 500 && responseCode < 600 && error.code !== 'EAUTH') this.contacts.suppress(email, 'bounced');
          }
        }
        this.campaigns.writeJournal(id, j);
      }
      if (!Object.values(j.recipients).some(r => r.status === 'pending')) { c.status = 'complete'; c.note = ''; }
    } finally { this.campaigns.write(c); }
    return this.campaigns.counts(id);
  }
}
