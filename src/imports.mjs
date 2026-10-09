// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { Campaigns, Sender } from './campaigns.mjs';
import { signToken } from './security.mjs';
import { confirmationMessage } from './render.mjs';

// Import membership and metadata are committed atomically with the contacts.
// The campaign journal machinery also provides crash recovery and no retries.
export class Imports extends Campaigns {
  constructor(dir, contacts) { super(dir, 'imports'); this.contacts = contacts; }
  get(id) {
    this.path(id);
    const batch = this.contacts.read().imports?.[id];
    if (!batch) throw new Error('Import not found.');
    return batch;
  }
  all() { return Object.values(this.contacts.read().imports || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  write(batch) { const data = this.contacts.read(); data.imports[batch.id] = batch; this.contacts.write(data); }
}

export class ConfirmationSender extends Sender {
  eligible(contact, item, batch) {
    return contact?.status === 'unconfirmed' && contact.importId === batch.id && contact.generation === item.generation && !contact.pending && !this.contacts.read().suppression[contact.email];
  }
  prepare(id) {
    const batch = this.campaigns.get(id);
    if (batch.mode !== 'confirm') throw new Error('This import did not request confirmation.');
    let journal = this.campaigns.journal(id);
    if (!journal) {
      const recipients = Object.fromEntries(this.contacts.all().filter(c => c.importId === id && c.status === 'unconfirmed').map(c => [c.email, { status: 'pending', generation: c.generation }]));
      const messageConfig = Object.fromEntries(['businessName', 'postalAddress', 'logoUrl', 'sender', 'publicUrl'].map(key => [key, this.config[key]]));
      journal = { version: 1, campaign: batch, messageConfig, recipients, createdAt: new Date().toISOString() };
      this.campaigns.writeJournal(id, journal);
    }
    batch.status = 'sending'; this.campaigns.write(batch); return journal;
  }
  message(journal, contact) {
    const now = this.delivery.now();
    const pending = this.contacts.beginImportConfirmation(contact.email, journal.campaign.id, contact.generation, now);
    const token = signToken(this.config.secret, 'confirm', pending, 24 * 60 * 60 * 1000, now);
    return confirmationMessage({ ...this.config, ...journal.messageConfig }, pending, token);
  }
}
