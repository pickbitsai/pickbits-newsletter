// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdown,merge,campaignMessage } from '../src/render.mjs';
import { fixture } from './helpers.mjs';
test('safe Markdown renders headings, emphasis, paragraphs, ordered and unordered lists, links and HTTPS images', () => {
  const html = markdown('# Title\n\nA **bold** and *soft* word.\n\n- One\n- Two\n\n1. Third\n\n[Menu](https://example.com/menu) ![Bread](https://example.com/bread.png)');
  for (const fragment of ['<h1>Title</h1>','<strong>bold</strong>','<em>soft</em>','<ul><li>One</li><li>Two</li></ul>','<ol><li>Third</li></ol>','href="https://example.com/menu"','src="https://example.com/bread.png"']) assert.ok(html.includes(fragment));
});
test('Markdown escapes raw HTML, event handlers, script links and contact markup', () => {
  const html = markdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert) ![x](data:text/html,bad) [x](https://example.com/"onmouseover="x)\n\n{{first_name|there}}',{first_name:'<svg onload=alert(1)>[bad](https://example.org)'});
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!/<script|<svg|<img|javascript:|onmouseover=/.test(html)); assert.ok(html.includes('[bad](https://example.org)'));
});
test('merge fallback and values inside emphasis remain text', () => {
  assert.equal(merge('Hi {{first_name|there}} {{last_name}}!',{}),'Hi there !');
  assert.equal(markdown('**{{first_name|there}}**',{first_name:'<b>A</b>'}),'<p><strong>&lt;b&gt;A&lt;/b&gt;</strong></p>');
  assert.equal(markdown('Hi {{first_name|there}}',{}),'<p>Hi there</p>');
});
test('merge fields cannot become link URLs, markdown syntax or image syntax', () => {
  const html = markdown('[Name](https://example.com/{{first_name}})\n\n{{first_name}}',{first_name:'![X](https://example.org/x)'});
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('href='));
});
test('plain text strips formatting and preserves link targets', () => {
  assert.equal(markdown('# Hello\n\n**Bread** for *you*. [Menu](https://example.com)',{},false),'Hello\n\nBread for you. Menu (https://example.com)');
});
test('email has escaped data, both bodies, postal address, unsubscribe and stamp plus one-click headers', t => {
  const f = fixture(t), c = f.confirmed(); c.first_name='<img src=x>'; const message = campaignMessage(f.config,{subject:'Hello {{first_name|there}}',markdown:'# Hi {{first_name|there}}'},c);
  for (const body of [message.html,message.text]) { assert.ok(body.includes(f.config.postalAddress)); assert.ok(body.includes('Made with PickBits Newsletter')); assert.ok(body.includes('/u/')); }
  assert.ok(message.html.includes('&lt;img src=x&gt;')); assert.ok(!message.html.includes('<img src=x>'));
  assert.match(message.headers['List-Unsubscribe'],/^<https:\/\/example\.com\/u\/[^>]+>, <mailto:bakery@example\.com\?subject=unsubscribe>$/);
  assert.equal(message.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
});
