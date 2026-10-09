// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readJSON, writeJSON } from '../src/files.mjs';
import { randomSecret, hashPassword, sessionCookie } from '../src/security.mjs';
import { Contacts } from '../src/contacts.mjs';
import { Campaigns, Sender } from '../src/campaigns.mjs';
import { Delivery } from '../src/delivery.mjs';
import { createHandler } from '../src/http.mjs';
import { Imports, ConfirmationSender } from '../src/imports.mjs';
export function fixture(t, overrides = {}) {
  const base = resolve('.test-tmp'); mkdirSync(base,{ recursive:true }); const dir = mkdtempSync(join(base,'unit-'));
  t.after(() => rmSync(dir,{ recursive:true,force:true }));
  const config = { ...readJSON(new URL('../newsletter.config.example.json',import.meta.url)), dataDir: dir, secret: randomSecret(), passwordHash: hashPassword('synthetic-password'), ...overrides, configFile: join(dir,'newsletter.config.json') };
  writeJSON(config.configFile,config);
  const contacts = new Contacts(dir), campaigns = new Campaigns(dir), sent = [], waits = [];
  let now = Date.parse('2026-10-08T12:00:00.000Z');
  const clock = { now: () => now, sleep: async ms => { waits.push(ms); now += ms; }, advance: ms => { now += ms; } };
  const transport = { sendMail: async message => { sent.push(message); return { accepted: [message.to] }; } };
  const delivery = new Delivery(config,transport,clock), sender = new Sender(config,contacts,campaigns,delivery);
  const imports = new Imports(dir, contacts), confirmations = new ConfirmationSender(config, contacts, imports, delivery);
  const handle = createHandler({ config,contacts,campaigns,sender,delivery,imports,confirmations });
  const request = (path, { method = 'GET', body, auth = false, origin = config.adminOrigin, headers = {} } = {}) => new Request(config.adminOrigin + path, { method, headers: { ...(body !== undefined ? { 'content-type':'application/x-www-form-urlencoded' } : {}), ...(auth ? { cookie:sessionCookie(config).split(';')[0] } : {}), ...(origin ? { origin } : {}), ...headers }, body: body === undefined ? undefined : new URLSearchParams(body) });
  const confirmed = (email = 'reader@example.com', tags = []) => {
    const pending = contacts.beginSignup({ email, first_name:'Rowan', tags },clock.now()); contacts.confirm(email,pending.pending,clock.now()); return contacts.get(email);
  };
  return { config,dir,contacts,campaigns,delivery,sender,transport,sent,waits,clock,handle,request,confirmed,imports,confirmations };
}
