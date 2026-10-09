// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { Delivery,createTransport } from '../src/delivery.mjs';
import { Sender } from '../src/campaigns.mjs';
import { campaignHash,campaignMessage } from '../src/render.mjs';
import { readJSON,writeJSON,lockDirectory } from '../src/files.mjs';
import { validateConfig } from '../src/config.mjs';
const ready = f => {
  const c = f.campaigns.save({subject:'Bread is ready',markdown:'Hello {{first_name|there}}',tag:''}); c.testedHash=campaignHash(c,f.config); f.campaigns.write(c); return c;
};
test('send requires a successful test and edits invalidate test approval', async t => {
  const f = fixture(t), c = f.campaigns.save({subject:'Fresh bread',markdown:'Hello'}); f.confirmed();
  assert.throws(() => f.sender.start(c.id),/test/); await f.sender.test(c.id); assert.equal(f.sent[0].to,f.config.sender);
  f.campaigns.save({...c,markdown:'Changed'},c.id); assert.throws(() => f.sender.start(c.id),/test/);
});
test('audience selects confirmed unsuppressed contacts and tags only', t => {
  const f = fixture(t); f.confirmed('retail@example.com',['retail']); f.confirmed('wholesale@example.com',['wholesale']); f.confirmed('blocked@example.com',['retail']); f.contacts.suppress('blocked@example.com'); f.contacts.import('email,consent_source,tags\npending@example.com,Shop,retail',{consent:true,commit:true,mode:'confirm'});
  assert.deepEqual(f.sender.audience({tag:'retail'}).map(c=>c.email),['retail@example.com']);
});
test('fake clock enforces throttle and a completed journal cannot send twice', async t => {
  const f = fixture(t); for(let i=0;i<3;i++)f.confirmed(`reader${i}@example.com`); const c=ready(f);
  const counts=await f.sender.start(c.id); assert.equal(counts.sent,3); assert.deepEqual(f.waits,[3000,3000]);
  await f.sender.start(c.id); assert.equal(f.sent.length,3); assert.equal(f.campaigns.get(c.id).status,'complete');
});
test('simultaneous start requests share a job and do not duplicate recipients', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f); const first=f.sender.start(c.id), second=f.sender.start(c.id);assert.equal(first,second);await first;assert.equal(f.sent.length,1);
});
test('daily quota persists across restarts, pauses pending recipients and resets next UTC day', async t => {
  const f=fixture(t,{dailyCap:1});f.confirmed('one@example.com');f.confirmed('two@example.com');const c=ready(f);await f.sender.start(c.id);
  assert.equal(f.campaigns.get(c.id).status,'paused');assert.equal(f.sent.length,1);
  const delivery=new Delivery(f.config,f.transport,f.clock),sender=new Sender(f.config,f.contacts,f.campaigns,delivery);sender.recover();await sender.start(c.id);assert.equal(f.sent.length,1);
  f.clock.advance(24*60*60*1000);await sender.start(c.id);assert.equal(f.sent.length,2);assert.equal(f.campaigns.counts(c.id).sent,2);
});
test('crash recovery skips sent and inflight entries while resuming pending recipients', async t => {
  const f=fixture(t);for(const name of ['sent','unknown','pending'])f.confirmed(`${name}@example.com`);const c=ready(f);const j=f.sender.prepare(c.id);
  j.recipients['sent@example.com'].status='sent';j.recipients['unknown@example.com'].status='inflight';f.campaigns.writeJournal(c.id,j);
  const restarted=new Sender(f.config,f.contacts,f.campaigns,f.delivery);restarted.recover();await restarted.start(c.id);
  assert.deepEqual(f.sent.map(m=>m.to),['pending@example.com']);assert.equal(f.campaigns.counts(c.id).uncertain,1);assert.equal(f.campaigns.counts(c.id).sent,2);
});
test('write-ahead journal records intent before calling the transport', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f);f.transport.sendMail=async message=>{assert.equal(f.campaigns.journal(c.id).recipients[message.to].status,'inflight');return {accepted:[message.to]};};
  await f.sender.start(c.id);assert.equal(f.campaigns.counts(c.id).sent,1);
});
test('suppression during throttle wait is rechecked immediately before delivery', async t => {
  const f=fixture(t);f.confirmed('one@example.com');f.confirmed('two@example.com');const c=ready(f);f.delivery.sleep=async ms=>{f.clock.advance(ms);f.contacts.suppress('two@example.com');};
  await f.sender.start(c.id);assert.deepEqual(f.sent.map(m=>m.to),['one@example.com']);assert.equal(f.campaigns.counts(c.id).skipped,1);
});
test('SMTP 550 marks bounced and records per-address error without leaking provider text', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f);f.transport.sendMail=async()=>{throw Object.assign(new Error('private provider reply'),{responseCode:550,code:'EENVELOPE'});};
  await f.sender.start(c.id);assert.equal(f.contacts.get('reader@example.com').status,'bounced');const j=f.campaigns.journal(c.id);assert.match(j.recipients['reader@example.com'].error,/550/);assert.ok(!JSON.stringify(j).includes('private provider reply'));
});
test('SMTP authentication failure does not label the recipient bounced', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f);f.transport.sendMail=async()=>{throw Object.assign(new Error('credentials invalid'),{responseCode:535,code:'EAUTH'});};
  await f.sender.start(c.id);assert.equal(f.contacts.get('reader@example.com').status,'subscribed');assert.equal(f.campaigns.counts(c.id).failed,1);
});
test('connection loss is uncertain and never automatically retried', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f);let attempts=0;f.transport.sendMail=async()=>{attempts++;throw Object.assign(new Error('socket lost'),{code:'ECONNECTION'});};
  await f.sender.start(c.id);await f.sender.start(c.id);assert.equal(attempts,1);assert.equal(f.campaigns.counts(c.id).uncertain,1);
});
test('test and confirmation traffic share the persisted daily cap', async t => {
  const f=fixture(t,{dailyCap:1});await f.delivery.send({to:'one@example.com'});await assert.rejects(f.delivery.send({to:'two@example.com'}),{code:'CAP'});assert.equal(readJSON(join(f.dir,'delivery.json')).attempts,1);
});
test('capture creates a multipart EML with unsubscribe headers without SMTP credentials', async t => {
  const f=fixture(t,{demo:true,publicUrl:'http://127.0.0.1:4206'}),c=f.confirmed();const capture=createTransport(f.config,{});
  await capture.sendMail(campaignMessage(f.config,{subject:'Sample',markdown:'Hello'},c));const files=readdirSync(join(f.dir,'outbox'));assert.equal(files.length,1);
  const eml=readFileSync(join(f.dir,'outbox',files[0]),'utf8');assert.match(eml,/multipart\/alternative/);assert.match(eml,/List-Unsubscribe-Post: List-Unsubscribe=One-Click/);assert.match(eml,/Made with PickBits Newsletter/);
});
test('demo refuses SMTP or non-loopback and port must be pinned', t => {
  const f=fixture(t,{demo:true});assert.throws(()=>createTransport({...f.config,transport:'smtp'}),/Demo/);assert.throws(()=>createTransport({...f.config,host:'0.0.0.0'}),/Demo/);assert.throws(()=>validateConfig({...f.config,port:4207}),/4206/);
});
test('process lock rejects another writer and atomic JSON stays parseable', t => {
  const f=fixture(t),release=lockDirectory(f.dir);try {assert.throws(()=>lockDirectory(f.dir),/already in use/);writeJSON(join(f.dir,'state.json'),{step:1});writeJSON(join(f.dir,'state.json'),{step:2});assert.deepEqual(readJSON(join(f.dir,'state.json')),{step:2});}finally{release();}
});
test('a resumed campaign retains its tested branding and sender settings', async t => {
  const f=fixture(t);f.confirmed();const c=ready(f);f.sender.prepare(c.id);const original=f.config.businessName;f.config.businessName='Another Synthetic Bakery';
  await f.sender.start(c.id);assert.equal(f.sent[0].from.name,original);assert.ok(!f.sent[0].html.includes('Another Synthetic Bakery'));
});
test('config rejects URL shapes that would break signed public links and sender header injection', t => {
  const f=fixture(t);for(const publicUrl of ['https://example.com/','https://example.com/path','https://example.com?x=1'])assert.throws(()=>validateConfig({...f.config,publicUrl}));
  assert.throws(()=>validateConfig({...f.config,sender:'bakery@example.com\r\n'}));
});
