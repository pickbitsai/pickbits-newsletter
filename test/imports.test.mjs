// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { ConfirmationSender } from '../src/imports.mjs';
import { Delivery } from '../src/delivery.mjs';
import { campaignHash } from '../src/render.mjs';
import { verifyToken } from '../src/security.mjs';

const batch = (f, emails = ['maria.delgado@example.com', 'jpark.bakes@example.net'], mode = 'confirm') => f.contacts.import(`email,consent_source,consent_date,tags\n${emails.map(email => `${email},Moved from previous newsletter service,2025-11-02,retail`).join('\n')}`, { consent: true, commit: true, mode }).importId;
const link = message => new URL(message.text.match(/https?:\/\/[^\s]+/)[0]).pathname;

test('attested imports and manual contacts can receive campaigns with honest consent provenance', async t => {
  const f = fixture(t); batch(f, undefined, 'attested');
  const manual = f.contacts.add({email:'orders@example.org',consent_source:'Wholesale account form',consent_date:'2025-04-06'},true);
  assert.equal(manual.status,'subscribed'); assert.equal(manual.confirmedAt,null); assert.equal(manual.subscription.method,'manual-attested');
  for (const c of f.contacts.all()) {
    assert.equal(f.contacts.eligible(c),true); assert.equal(c.subscription.source,c.consent_source);
    assert.equal(c.subscription.date,c.consent_date); assert.ok(Number.isFinite(Date.parse(c.subscription.at)));
  }
  assert.equal(f.contacts.get('maria.delgado@example.com').subscription.method,'import-attested');
  assert.throws(() => f.contacts.add({email:'missing@example.net',consent_source:'Counter'},false),/agreed/);
  assert.throws(() => f.contacts.add({email:'missing@example.net'},true),/source/);
  assert.throws(() => f.contacts.add({email:'missing@example.net',consent_source:'Counter',consent_date:'yesterday-ish'},true),/date/);
  const c = f.campaigns.save({subject:'Saturday bread',markdown:'Fresh loaves from seven.'}); c.testedHash = campaignHash(c,f.config); f.campaigns.write(c);
  assert.equal((await f.sender.start(c.id)).sent,3);
  assert.match(f.contacts.export(),/import-attested/); assert.match(f.contacts.export(),/manual-attested/);
});

test('both import choices preserve all suppression statuses, including deleted contacts', t => {
  for (const mode of ['attested','confirm']) {
    const f = fixture(t);
    for (const status of ['unsubscribed','bounced','complained']) f.contacts.suppress(`${status}@example.org`,status);
    f.contacts.add({email:'deleted@example.org',consent_source:'Counter'},true); f.contacts.delete('deleted@example.org');
    const report = f.contacts.import('email,status,confirmed_at,consent_source\nunsubscribed@example.org,subscribed,2025-01-01,Counter\nbounced@example.org,subscribed,2025-01-01,Counter\ncomplained@example.org,subscribed,2025-01-01,Counter\ndeleted@example.org,subscribed,2025-01-01,Counter',{mode,consent:true,commit:true});
    assert.deepEqual(report.map(r=>r.result),Array(4).fill('suppressed')); assert.equal(f.contacts.all().length,0);
    for (const status of ['unsubscribed','bounced','complained']) {
      const c = f.contacts.add({email:`${status}@example.org`,consent_source:'Counter'},true);
      assert.equal(c.status,status); assert.equal(f.contacts.eligible(c),false); assert.equal(c.subscription,undefined);
    }
  }
});

test('CSV cannot assert subscription or provenance and confirmation mode is validated', t => {
  const f = fixture(t);
  f.contacts.import('email,status,confirmed_at,subscription,consent_source\nreader@example.com,subscribed,2025-01-01,manual-attested,Counter',{consent:true,commit:true,mode:'confirm'});
  const c = f.contacts.get('reader@example.com'); assert.equal(c.status,'unconfirmed'); assert.equal(c.confirmedAt,null); assert.equal(c.subscription,undefined);
  assert.throws(() => batch(f,undefined,'invalid'),/Choose/);
  batch(f,['reader@example.com'],'attested'); assert.equal(f.contacts.get(c.email).status,'unconfirmed');
});

test('confirmation requests target only their import, share throttling and require a signed POST', async t => {
  const f = fixture(t), id = batch(f); batch(f,['other@example.org']);
  f.clock.advance(Date.now() - f.clock.now()); // HTTP verifies tokens against wall time.
  assert.equal(f.sender.audience({}).length,0);
  const first = f.confirmations.start(id), second = f.confirmations.start(id); assert.equal(first,second);
  assert.equal((await first).sent,2); assert.deepEqual(f.waits,[3000]);
  assert.deepEqual(f.sent.map(m=>m.to),['maria.delgado@example.com','jpark.bakes@example.net']);
  const path = link(f.sent[0]);
  assert.equal((await f.handle(f.request(path))).status,200); assert.equal(f.contacts.get(f.sent[0].to).status,'unconfirmed');
  assert.equal((await f.handle(f.request(path,{method:'POST',origin:null}))).status,200);
  const c = f.contacts.get(f.sent[0].to); assert.equal(c.status,'subscribed'); assert.equal(c.subscription.method,'signup-confirmed'); assert.equal(c.subscription.source,'Moved from previous newsletter service'); assert.equal(c.consent_date,'2025-11-02T00:00:00.000Z');
  await f.confirmations.start(id); assert.equal(f.sent.length,2);
  assert.match(await (await f.handle(f.request(path,{method:'POST',origin:null}))).text(),/already been used/);
});

test('confirmation intent is durable before transport and completed imports never send twice after restart', async t => {
  const f = fixture(t), id = batch(f); let attempts = 0;
  f.transport.sendMail = async message => { attempts++; const row = f.imports.journal(id).recipients[message.to]; assert.equal(row.status,'inflight'); assert.ok(f.contacts.get(message.to).pending); return {accepted:[message.to]}; };
  await f.confirmations.start(id);
  const restarted = new ConfirmationSender(f.config,f.contacts,f.imports,f.delivery); restarted.recover(); await restarted.start(id);
  assert.equal(attempts,2);
});

test('confirmation requests share the campaign cap and resume pending recipients on the next day', async t => {
  const f = fixture(t,{dailyCap:1}), id = batch(f);
  await f.delivery.send({to:'bakery@example.com'}); await f.confirmations.start(id);
  assert.equal(f.imports.get(id).status,'paused'); assert.equal(f.imports.counts(id).pending,2);
  const delivery = new Delivery(f.config,f.transport,f.clock), restarted = new ConfirmationSender(f.config,f.contacts,f.imports,delivery);
  restarted.recover(); f.clock.advance(86400000); await restarted.start(id);
  assert.equal(f.imports.counts(id).sent,1); assert.equal(f.imports.counts(id).pending,1);
  f.clock.advance(86400000); await restarted.start(id); assert.equal(f.imports.counts(id).sent,2);
  const payload = verifyToken(f.config.secret,link(f.sent.at(-1)).split('/').at(-1),'confirm',f.clock.now());
  assert.ok(payload); assert.equal(verifyToken(f.config.secret,link(f.sent.at(-1)).split('/').at(-1),'confirm',f.clock.now()+86400000),null);
});

test('confirmation crash recovery marks inflight uncertain and resumes only untouched recipients', async t => {
  const f = fixture(t), id = batch(f,['sent@example.com','unknown@example.com','pending@example.com']);
  const journal = f.confirmations.prepare(id); journal.recipients['sent@example.com'].status='sent'; journal.recipients['unknown@example.com'].status='inflight'; f.imports.writeJournal(id,journal);
  const restarted = new ConfirmationSender(f.config,f.contacts,f.imports,f.delivery); restarted.recover(); await restarted.start(id);
  assert.deepEqual(f.sent.map(m=>m.to),['pending@example.com']); assert.equal(f.imports.counts(id).uncertain,1);
});

test('suppression during confirmation throttle wait skips delivery and cannot be undone by old links', async t => {
  const f = fixture(t), id = batch(f);
  f.clock.advance(Date.now() - f.clock.now());
  f.delivery.sleep = async ms => { f.clock.advance(ms); f.contacts.suppress('jpark.bakes@example.net','complained'); };
  await f.confirmations.start(id); assert.equal(f.sent.length,1); assert.equal(f.imports.counts(id).skipped,1);
  const path = link(f.sent[0]); f.contacts.suppress(f.sent[0].to,'bounced');
  await f.handle(f.request(path,{method:'POST',origin:null})); assert.equal(f.contacts.get(f.sent[0].to).status,'bounced');
});

test('confirmed, deleted and public-signup pending contacts are rechecked before import delivery', async t => {
  const f = fixture(t), id = batch(f,['confirmed@example.com','deleted@example.com','pending@example.com']);
  f.confirmations.prepare(id);
  const pending = f.contacts.beginSignup({email:'confirmed@example.com'},f.clock.now()); f.contacts.confirm(pending.email,pending.pending);
  f.contacts.delete('deleted@example.com'); const publicSignup = f.contacts.beginSignup({email:'pending@example.com'},f.clock.now());
  await f.confirmations.start(id); assert.equal(f.sent.length,0); assert.equal(f.imports.counts(id).skipped,3);
  assert.equal(f.contacts.get(publicSignup.email).pending.id,publicSignup.pending);
});

test('rejected and uncertain confirmation attempts are journaled without retries or provider text', async t => {
  for (const [responseCode,code,status] of [[550,'EENVELOPE','failed'],[535,'EAUTH','failed'],[undefined,'ECONNECTION','uncertain']]) {
    const f = fixture(t), id = batch(f,['reader@example.com']); let attempts=0;
    f.transport.sendMail=async()=>{attempts++; throw Object.assign(new Error('private provider details'),{responseCode,code});};
    await f.confirmations.start(id); await f.confirmations.start(id);
    assert.equal(attempts,1); assert.equal(f.imports.counts(id)[status],1); assert.ok(!JSON.stringify(f.imports.journal(id)).includes('private provider details'));
    assert.equal(f.contacts.get('reader@example.com').status,responseCode===550?'bounced':'unconfirmed');
  }
});

test('HTTP binds the import choice to preview and exposes authenticated one-click requests', async t => {
  const f = fixture(t), body = {csv:'email,consent_source\nreader@example.com,Counter tablet',consent:'yes',mode:'confirm'};
  const preview = await f.handle(f.request('/import/preview',{method:'POST',body,auth:true})), html = await preview.text();
  assert.match(html,/ready as unconfirmed/); const token = html.match(/name="preview" value="([^"]+)"/)[1];
  assert.equal((await f.handle(f.request('/import/commit',{method:'POST',body:{...body,mode:'attested',preview:token},auth:true}))).status,400);
  const response = await f.handle(f.request('/import/commit',{method:'POST',body:{...body,preview:token},auth:true}));
  const result = await response.text(); assert.match(result,/Send confirmation request/); assert.equal(f.sent.length,0);
  const id = f.contacts.get('reader@example.com').importId;
  assert.equal((await f.handle(f.request(`/imports/${id}/send`,{method:'POST',body:{},auth:true,origin:null}))).status,403);
  assert.equal((await f.handle(f.request(`/imports/${id}/send`,{method:'POST',body:{}}))).status,303); assert.equal(f.sent.length,0);
  assert.equal((await f.handle(f.request(`/imports/${id}/send`,{method:'POST',body:{},auth:true}))).status,303);
  await Promise.all(f.confirmations.jobs.values()); assert.equal(f.sent.length,1);
  assert.match(await (await f.handle(f.request(`/imports/${id}`,{auth:true}))).text(),/reader@example.com/);
  assert.match(await (await f.handle(f.request('/import',{auth:true}))).text(),new RegExp(id));
});

test('HTTP attested imports and manual additions are subscribed and UI copy matches', async t => {
  const f = fixture(t), body = {csv:'email,consent_source\nreader@example.com,Website signup form',consent:'yes',mode:'attested'};
  const preview = await (await f.handle(f.request('/import/preview',{method:'POST',body,auth:true}))).text(), token=preview.match(/name="preview" value="([^"]+)"/)[1];
  assert.match(preview,/ready as subscribed/);
  const result=await (await f.handle(f.request('/import/commit',{method:'POST',body:{...body,preview:token},auth:true}))).text();
  assert.match(result,/imported \(subscribed\)/); assert.ok(!result.includes('Send confirmation request')); assert.equal(f.contacts.eligible(f.contacts.get('reader@example.com')),true);
  assert.equal((await f.handle(f.request('/contacts/add',{method:'POST',body:{email:'manual@example.net',consent_source:'Counter tablet',consent:'yes'},auth:true}))).status,303);
  assert.equal(f.contacts.get('manual@example.net').subscription.method,'manual-attested');
  assert.match(await (await f.handle(f.request('/contacts',{auth:true}))).text(),/owner-attested consent/);
  assert.match(await (await f.handle(f.request('/import',{auth:true}))).text(),/They already agreed.*Ask them to confirm first/s);
});
