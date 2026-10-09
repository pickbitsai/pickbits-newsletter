// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken,verifyToken,hashPassword,checkPassword,sessionCookie,RateLimiter } from '../src/security.mjs';
import { unsubscribeURL } from '../src/render.mjs';
import { fixture } from './helpers.mjs';
test('tokens enforce HMAC, purpose, exact expiry and nonce uniqueness', () => {
  const token = signToken('synthetic-secret','confirm',{email:'reader@example.com'},1000,0);
  assert.equal(verifyToken('synthetic-secret',token,'confirm',999).email,'reader@example.com');
  assert.equal(verifyToken('synthetic-secret',token,'confirm',1000),null);
  assert.equal(verifyToken('wrong',token,'confirm',0),null);
  assert.equal(verifyToken('synthetic-secret',token,'unsubscribe',0),null);
  assert.equal(verifyToken('synthetic-secret',token.slice(0,-1) + (token.endsWith('a') ? 'b' : 'a'),'confirm',0),null);
  assert.notEqual(token,signToken('synthetic-secret','confirm',{email:'reader@example.com'},1000,0));
});
test('scrypt accepts correct passwords and rejects bad passwords and invalid encodings', async () => {
  const hash = hashPassword('synthetic-password'); assert.equal(await checkPassword('synthetic-password',hash),true); assert.equal(await checkPassword('wrong',hash),false); assert.equal(await checkPassword('abc','invalid'),false);
});
test('admin redirects unauthenticated reads and requires Origin even for login', async t => {
  const f = fixture(t); assert.equal((await f.handle(f.request('/contacts'))).headers.get('location'),'/login');
  for (const origin of [null,'https://example.org']) assert.equal((await f.handle(f.request('/login',{method:'POST',body:{password:'synthetic-password'},origin}))).status,403);
  assert.equal((await f.handle(f.request('/login',{method:'POST',body:{password:'wrong'}}))).status,401);
  const ok = await f.handle(f.request('/login',{method:'POST',body:{password:'synthetic-password'}}));
  assert.equal(ok.status,303); assert.match(ok.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
});
test('admin rejects tampered cookies and missing Origin on authenticated writes', async t => {
  const f = fixture(t), cookie = sessionCookie(f.config).split(';')[0];
  const response = await f.handle(f.request('/contacts',{headers:{cookie:cookie + 'x'}})); assert.equal(response.status,303);
  assert.equal((await f.handle(f.request('/contacts/add',{method:'POST',body:{},auth:true,origin:null}))).status,403);
  assert.equal((await f.handle(f.request('/contacts',{auth:true}))).status,200);
});
test('password changes invalidate sessions and HTTPS admin cookies are Secure', async t => {
  const f = fixture(t), cookie = sessionCookie(f.config).split(';')[0]; f.config.passwordHash = hashPassword('another-synthetic-password');
  assert.equal((await f.handle(f.request('/contacts',{headers:{cookie}}))).status,303);
  assert.match(sessionCookie({...f.config,adminOrigin:'https://example.org'}),/; Secure$/);
});
test('public signup requires consent, ignores honeypot and rate-limits IPs', async t => {
  const f = fixture(t);
  assert.equal((await f.handle(f.request('/signup',{method:'POST',body:{email:'reader@example.com'},origin:null}),{ip:'one'})).status,400);
  await f.handle(f.request('/signup',{method:'POST',body:{website:'bot',email:'reader@example.com',consent:'yes'},origin:null}),{ip:'two'}); assert.equal(f.sent.length,0);
  for (let i=0;i<5;i++) assert.equal((await f.handle(f.request('/signup',{method:'POST',body:{website:'bot'},origin:null}),{ip:'three'})).status,200);
  assert.equal((await f.handle(f.request('/signup',{method:'POST',body:{website:'bot'},origin:null}),{ip:'three'})).status,429);
});
test('signup confirmation GET does not subscribe; signed POST confirms and replay is harmless', async t => {
  const f = fixture(t); await f.handle(f.request('/signup',{method:'POST',body:{email:'reader@example.com',first_name:'Rowan',consent:'yes'},origin:null}));
  assert.equal(f.contacts.get('reader@example.com').status,'unconfirmed'); assert.equal(f.sent.length,1);
  const path = new URL(f.sent[0].text.match(/https:\/\/[^\s]+/)[0]).pathname;
  assert.equal((await f.handle(f.request(path))).status,200); assert.equal(f.contacts.get('reader@example.com').status,'unconfirmed');
  assert.equal((await f.handle(f.request(path,{method:'POST',origin:null}))).status,200); assert.equal(f.contacts.get('reader@example.com').status,'subscribed');
  assert.match(await (await f.handle(f.request(path,{method:'POST',origin:null}))).text(),/already been used/);
});
test('unsubscribe GET is safe and no-Origin one-click POST suppresses immediately', async t => {
  const f = fixture(t), contact = f.confirmed(), path = new URL(unsubscribeURL(f.config,contact)).pathname;
  const get = await f.handle(f.request(path)); assert.match(await get.text(),/method="post"/); assert.equal(f.contacts.eligible(f.contacts.get(contact.email)),true);
  const post = await f.handle(f.request(path,{method:'POST',body:{'List-Unsubscribe':'One-Click'},origin:null})); assert.equal(post.status,200); assert.equal(f.contacts.eligible(f.contacts.get(contact.email)),false);
  assert.ok(f.contacts.read().suppression[contact.email]);
});
test('fresh double opt-in alone removes suppression; old unsubscribe and confirmation tokens cannot undo it', async t => {
  const f = fixture(t), original = f.confirmed(), oldPath = new URL(unsubscribeURL(f.config,original)).pathname;
  f.contacts.suppress(original.email); const pending = f.contacts.beginSignup({email:original.email},f.clock.now()+3600000);
  assert.ok(f.contacts.read().suppression[original.email]); assert.equal(f.contacts.confirm(original.email,pending.pending),true);
  await f.handle(f.request(oldPath,{method:'POST',origin:null})); assert.equal(f.contacts.get(original.email).status,'subscribed');
  f.contacts.suppress(original.email); assert.equal(f.contacts.confirm(original.email,pending.pending),false);
});
test('rate limiter expires entries and separates keys', () => {
  let now = 0; const limiter = new RateLimiter(() => now); assert.equal(limiter.allow('a',1,100),true); assert.equal(limiter.allow('a',1,100),false); assert.equal(limiter.allow('b',1,100),true); now=100; assert.equal(limiter.allow('a',1,100),true);
});
