// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from './leakscan.mjs';
const cases = {
  'drive forward slash': 'C' + ':/private/file',
  'drive backslash': 'D' + ':\\private\\file',
  'workspace name': 'pickbits' + '-services',
  'API credential': 's' + 'k-' + 'a'.repeat(24),
  'cloud credential': 'A' + 'KIA' + 'X'.repeat(16),
  'PEM key': '-----BEGIN ' + 'PRIVATE KEY-----',
  'RSA key': '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  'nonfictional email': 'person@' + 'invalid.test',
  'unsafe full phone': ['520','234','5678'].join('-'),
  'unsafe local phone': ['555','0200'].join('-'),
  'unsafe compact phone': ['520','234','5678'].join(''),
  'unsafe international phone': '+1' + ['520','234','5678'].join(''),
  'publisher domain': 'pickbits' + '.ai'
};
for (const prefix of ['p','o','u','s','r']) cases[`repository credential ${prefix}`] = 'gh' + prefix + '_' + 'a'.repeat(24);
for (const prefix of ['b','p','a','r','s']) cases[`chat credential ${prefix}`] = 'xox' + prefix + '-' + 'a'.repeat(24);
for (const [label,value] of Object.entries(cases)) test(`leakscan rejects ${label}`, () => assert.ok(scanText(value).length));
test('leakscan permits synthetic contacts and cities', () => assert.deepEqual(scanText('Tucson, Arizona. Rowan at reader@example.com; reader@example.org; reader@example.net. (520) 555-0100; +15205550199; 555-0150.'),[]));
test('leakscan matches forbidden strings case-insensitively', () => assert.ok(scanText(('pickbits' + '.ai').toUpperCase()).length));
