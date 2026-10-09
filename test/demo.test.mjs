// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { seedDemo } from '../src/demo.mjs';
import { Contacts } from '../src/contacts.mjs';
import { Campaigns, Sender } from '../src/campaigns.mjs';
import { readJSON } from '../src/files.mjs';
import { scanText } from './leakscan.mjs';
import { campaignMessage } from '../src/render.mjs';

test('demo has varied realistic contacts, consent history, unchanged audiences and plausible newsletters', t => {
  const f = fixture(t), dir = join(f.dir,'demo'), file = seedDemo(dir), config = readJSON(file);
  const contacts = new Contacts(dir), campaigns = new Campaigns(dir), all = contacts.all(), sender = new Sender(config,contacts,campaigns,null);
  assert.equal(all.length,40);
  assert.deepEqual(Object.fromEntries(['subscribed','unconfirmed','unsubscribed','bounced','complained'].map(s=>[s,all.filter(c=>c.status===s).length])),{subscribed:32,unconfirmed:3,unsubscribed:3,bounced:1,complained:1});
  assert.equal(sender.audience({tag:'retail'}).length,24); assert.equal(sender.audience({tag:'wholesale'}).length,8);
  assert.equal(new Set(all.map(c=>c.first_name)).size,40); assert.equal(new Set(all.map(c=>c.last_name)).size,40);
  assert.equal(new Set(all.map(c=>c.email)).size,40); assert.equal(new Set(all.map(c=>c.email.split('@')[1])).size,3);
  assert.ok(all.some(c=>c.email==='maria.delgado@example.com')); assert.ok(all.some(c=>c.email==='orders@example.org'));
  assert.equal(new Set(all.map(c=>c.consent_date)).size,40);
  const dates = all.map(c=>Date.parse(c.consent_date)); assert.ok(Math.max(...dates)-Math.min(...dates)>600*86400000);
  assert.ok(dates.every(date=>date<=Date.now() && date>Date.now()-731*86400000));
  assert.equal(new Set(all.map(c=>c.consent_source)).size,4);
  assert.equal(config.postalAddress,'1842 N Stone Ave, Tucson, AZ 85705');
  assert.equal(campaigns.all().filter(c=>c.status==='draft').length,2); assert.equal(campaigns.counts('demo-sent').sent,32);
  for (const c of campaigns.all()) {
    assert.ok(c.markdown.length>300); assert.match(c.markdown,/bread|loaves|sourdough/);
    const message = campaignMessage(config,c,all[0]);
    assert.doesNotMatch(message.text,/synthetic|Imaginary|lorem|Ovenfriend|reader\d/i);
  }
  for (const data of [all,config,campaigns.all(),campaigns.journal('demo-sent')]) assert.deepEqual(scanText(JSON.stringify(data)),[]);
  const before = JSON.stringify(all); seedDemo(dir); assert.equal(JSON.stringify(contacts.all()),before);
});
