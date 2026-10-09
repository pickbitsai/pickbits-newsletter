// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../src/csv.mjs';
import { normalizeEmail } from '../src/contacts.mjs';
import { fixture } from './helpers.mjs';
test('CSV handles BOM, commas, double quotes, embedded newlines and CRLF', () => {
  assert.deepEqual(parseCSV('\uFEFFemail,first name\r\nreader@example.com,"Avery, ""A""\nFriend"\r\n'),[['email','first name'],['reader@example.com','Avery, "A"\nFriend']]);
});
test('CSV rejects malformed quotes', () => { for (const value of ['"open','a"b,c','"a"junk,b']) assert.throws(() => parseCSV(value)); });
test('email normalization is case-insensitive without provider-specific alias merging', () => {
  assert.equal(normalizeEmail(' Reader+tag@Example.com '),'reader+tag@example.com');
  for (const value of ['no-address','a@example','a\r\n@example.com','.a@example.com','a..b@example.com']) assert.equal(normalizeEmail(value),null);
});
test('import preview is read-only, reports each row, dedupes, validates and respects suppression', t => {
  const f = fixture(t); f.contacts.suppress('blocked@example.com');
  const csv = '\uFEFFemail,first name,last name,tags,consent source,consent date\r\nReader@example.com,"Avery, A",Vale,retail,Shop form,2026-09-01\r\nreader@EXAMPLE.com,Avery,Vale,retail,Shop form,2026-09-01\r\nnot-an-email,A,B,,Shop form,\r\nblocked@example.com,A,B,,Shop form,\r\ndate@example.com,A,B,,Shop form,bad-date\r\nshort@example.com,A\r\n';
  const preview = f.contacts.import(csv,{ mode:'confirm',consent:true });
  assert.deepEqual(preview.map(r => r.result),['ready','duplicate','invalid email','suppressed','invalid consent date','wrong column count']);
  assert.equal(f.contacts.all().length,0);
  const report = f.contacts.import(csv,{ mode:'confirm',consent:true,commit:true }); assert.equal(report.length,6);
  const c = f.contacts.get('reader@example.com'); assert.equal(c.status,'unconfirmed'); assert.equal(c.first_name,'Avery, A'); assert.equal(c.consent_source,'Shop form'); assert.ok(c.consentRecordedAt);
  assert.equal(f.contacts.import(csv,{ mode:'confirm',consent:true })[0].result,'duplicate');
});
test('import requires attestation and a consent source', t => {
  const f = fixture(t); assert.throws(() => f.contacts.import('email\na@example.com'),/agreed/);
  assert.equal(f.contacts.import('email\na@example.com',{ consent:true })[0].result,'missing consent source');
  assert.throws(() => f.contacts.import('email,email\na@example.com,a@example.com',{consent:true}),/unique/);
});
test('editing or deleting cannot bypass suppression and deletion retains it', t => {
  const f = fixture(t); const c = f.confirmed(); f.contacts.suppress(c.email,'complained');
  assert.throws(() => f.contacts.edit(c.email,{ status:'subscribed' }),/Only signup/);
  f.contacts.delete(c.email); assert.ok(f.contacts.read().suppression[c.email]);
  const again = f.contacts.add({email:c.email,consent_source:'Synthetic form'},true); assert.equal(again.status,'unsubscribed');
});
test('CSV export carries consent and stamp, escapes formulas, and round-trips quoted names', t => {
  const f = fixture(t); f.contacts.add({email:'reader@example.com',first_name:'=SUM(1,2)',consent_source:'Shop'},true);
  const rows = parseCSV(f.contacts.export()); assert.ok(rows[1].includes("'=SUM(1,2)")); assert.ok(rows[1].includes('Made with PickBits Newsletter')); assert.ok(rows[0].includes('consent_date'));
});
test('confirmation retains imported tags and names, while public signup cannot assign owner tags', async t => {
  const f = fixture(t); f.contacts.import('email,first_name,last_name,tags,consent_source\nreader@example.com,Rowan,Vale,retail,Shop',{consent:true,commit:true,mode:'confirm'});
  await f.handle(f.request('/signup',{method:'POST',body:{email:'reader@example.com',consent:'yes',tags:'wholesale'},origin:null}));
  const pending=f.contacts.get('reader@example.com').pending;f.contacts.confirm('reader@example.com',pending.id);
  const c=f.contacts.get('reader@example.com');assert.deepEqual(c.tags,['retail']);assert.equal(c.last_name,'Vale');assert.equal(c.first_name,'Rowan');
});
test('empty CSV exports still carry the output stamp', t => {const f=fixture(t);assert.match(f.contacts.export(),/Made with PickBits Newsletter/);});
