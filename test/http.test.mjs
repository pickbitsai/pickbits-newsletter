// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
test('all admin pages are rendered with an output stamp and no remote scripts or fonts', async t => {
  const f=fixture(t);for(const path of ['/contacts','/import','/compose','/campaigns','/settings']){
    const response=await f.handle(f.request(path,{auth:true}));assert.equal(response.status,200,path);const html=await response.text();assert.match(html,/Made with PickBits Newsletter/);assert.ok(!/<script[^>]+src="https:|fonts\./.test(html));assert.equal(response.headers.get('cache-control'),'no-store');
  }
});
test('HTTP import requires reviewed bytes and a renewed consent checkbox', async t => {
  const f=fixture(t),body={csv:'email,consent_source\nreader@example.com,Shop form',source:'',consent:'yes'};
  const preview=await f.handle(f.request('/import/preview',{method:'POST',body,auth:true}));assert.equal(preview.status,200);const html=await preview.text(),token=html.match(/name="preview" value="([^"]+)"/)[1];
  assert.equal(f.contacts.all().length,0);
  const bad=await f.handle(f.request('/import/commit',{method:'POST',body:{...body,csv:body.csv+'\nother@example.com,Shop',preview:token},auth:true}));assert.equal(bad.status,400);
  const noConsent=await f.handle(f.request('/import/commit',{method:'POST',body:{...body,consent:'',preview:token},auth:true}));assert.equal(noConsent.status,400);
  const applied=await f.handle(f.request('/import/commit',{method:'POST',body:{...body,preview:token},auth:true}));assert.equal(applied.status,200);assert.equal(f.contacts.all().length,1);
});
test('invalid and expired public tokens never change the list', async t => {
  const f=fixture(t);f.confirmed();for(const path of ['/u/invalid','/confirm/invalid'])assert.equal((await f.handle(f.request(path,{method:'POST',origin:null}))).status,400);assert.equal(f.contacts.get('reader@example.com').status,'subscribed');
});
test('public and login pages include the stamp; signup needs no admin cookie', async t => {
  const f=fixture(t);for(const path of ['/signup','/login']){const response=await f.handle(f.request(path));assert.equal(response.status,200);assert.match(await response.text(),/Made with PickBits Newsletter/);}
});
test('admin forms preserve same-origin Origin while public token pages suppress referrers', async t => {
  const f=fixture(t);
  assert.equal((await f.handle(f.request('/login'))).headers.get('referrer-policy'),'same-origin');
  assert.equal((await f.handle(f.request('/contacts',{auth:true}))).headers.get('referrer-policy'),'same-origin');
  assert.equal((await f.handle(f.request('/signup'))).headers.get('referrer-policy'),'no-referrer');
  assert.equal((await f.handle(f.request('/u/invalid'))).headers.get('referrer-policy'),'no-referrer');
});
