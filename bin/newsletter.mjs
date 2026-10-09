#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { initConfig, loadConfig } from '../src/config.mjs';
import { readJSON, writeJSON, atomicWrite, lockDirectory } from '../src/files.mjs';
import { hashPassword } from '../src/security.mjs';
import { Contacts } from '../src/contacts.mjs';
import { Campaigns, Sender } from '../src/campaigns.mjs';
import { Delivery, createTransport } from '../src/delivery.mjs';
import { campaignMessage } from '../src/render.mjs';
import { seedDemo, DEMO_PASSWORD } from '../src/demo.mjs';
import { serve } from '../src/server.mjs';

const help = `PickBits Newsletter 0.1.0
Keep your list in your own files. Send through your own mailbox.

Usage: newsletter <command> [options]
  init                       Create a private config and data directory
  set-password               Set the admin password (hidden prompt)
  import <csv>               Preview CSV rows
    --consent --source TEXT  Attest consent and supply a default source
    --apply                  Save valid rows as subscribed contacts
    --confirm-first          Keep unconfirmed; send requests from Import in the UI
  export <csv>               Export contacts and consent records
  send <campaign-id> --dry-run  Write capture previews; never contact SMTP
  send <campaign-id> --yes   Send/resume a previously tested campaign
  doctor [--smtp]           Check config; connect only with --smtp
  serve                      Start the local admin on 127.0.0.1:4206
  demo [--seed-only]         Seed synthetic data; capture transport only
  --config <file>            Choose config (default newsletter.config.json)
  --help                     Show this help

Tests are sent from the campaign page before real sending is enabled.
Set NEWSLETTER_ADMIN_PASSWORD for non-interactive password setup.
Questions and bugs: open a GitHub issue.
Made with PickBits Newsletter`;

async function passwordPrompt() {
  if (process.env.NEWSLETTER_ADMIN_PASSWORD) return process.env.NEWSLETTER_ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Set NEWSLETTER_ADMIN_PASSWORD or use an interactive terminal.');
  return new Promise((resolvePassword, reject) => {
    let value = ''; process.stdout.write('New admin password (12+ characters, hidden): ');
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const cleanup = () => { process.stdin.off('data', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const listener = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { cleanup(); reject(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolvePassword(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0,-1);
        else if (char >= ' ' && value.length < 257) value += char;
      }
    };
    process.stdin.on('data', listener);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help') || args[0] === 'help') { console.log(help); return; }
  let configFile = 'newsletter.config.json';
  const ci = args.indexOf('--config');
  if (ci >= 0) { if (!args[ci + 1]) throw new Error('--config needs a file.'); configFile = args[ci + 1]; args.splice(ci,2); }
  const command = args.shift();
  const known = ['init','set-password','import','export','send','doctor','serve','demo'];
  if (!known.includes(command)) throw new Error('Unknown command. Run newsletter --help.');
  const allowed = { init: [], 'set-password': [], import: ['--source','--consent','--apply','--confirm-first'], export: [], send: ['--dry-run','--yes'], doctor: ['--smtp'], serve: [], demo: ['--seed-only'] }[command];
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.includes(arg)) throw new Error(`Unknown option: ${arg}`);
  if (command === 'init') { initConfig(configFile); console.log('Created newsletter.config.json and private data directory. Set your real business details, then run npm run set-password. Capture transport is enabled.'); return; }
  if (command === 'demo') { configFile = seedDemo(); if (args.includes('--seed-only')) { console.log('Seeded 40 synthetic contacts and three campaigns. Capture only.'); return; } }
  if (command === 'set-password') {
    const stored = readJSON(configFile); stored.passwordHash = hashPassword(await passwordPrompt()); writeJSON(configFile, stored);
    console.log('Admin password saved as a scrypt hash. Restart a running server to load it and invalidate old sessions.'); return;
  }
  const config = loadConfig(configFile, { requirePassword: ['serve','demo'].includes(command) });
  const release = lockDirectory(config.dataDir);
  let keepLock = false, delivery;
  try {
    const contacts = new Contacts(config.dataDir), campaigns = new Campaigns(config.dataDir);
    if (command === 'import') {
      if (!args[0] || args[0].startsWith('--')) throw new Error('Provide a CSV filename.');
      const sourceIndex = args.indexOf('--source');
      const report = contacts.import(readFileSync(args[0],'utf8'), { consent: args.includes('--consent'), source: sourceIndex >= 0 ? args[sourceIndex + 1] : '', commit: args.includes('--apply'), mode: args.includes('--confirm-first') ? 'confirm' : 'attested' });
      console.log(JSON.stringify({ mode: args.includes('--apply') ? 'applied' : 'preview', importId: report.importId, report, stamp: 'Made with PickBits Newsletter' },null,2)); return;
    }
    if (command === 'export') { if (!args[0]) throw new Error('Provide a CSV filename.'); if (existsSync(args[0])) throw new Error('Export already exists; choose a new filename.'); atomicWrite(args[0],contacts.export()); console.log('Exported contacts. Made with PickBits Newsletter'); return; }
    if (command === 'doctor') {
      console.log(`Configuration OK. Transport: ${config.transport}. Bind: 127.0.0.1:4206. Limits: ${config.messagesPerMinute}/minute, ${config.dailyCap}/UTC day.`);
      console.log(config.passwordHash ? 'Admin password hash present.' : 'Admin password missing: run npm run set-password before serving.');
      if (args.includes('--smtp')) { const transport = createTransport(config); try { await transport.verify(); console.log(config.transport === 'capture' ? 'Capture verified; no network used.' : 'SMTP connection and authentication verified.'); } finally { transport.close?.(); } }
      else console.log('SMTP not contacted. Use --smtp to explicitly check connectivity.');
      return;
    }
    if (command === 'send' && args.includes('--dry-run')) {
      const campaign = campaigns.get(args[0]), fakeSender = new Sender(config,contacts,campaigns,null), audience = fakeSender.audience(campaign);
      const dryDir = join(config.dataDir,'dry-runs',`${campaign.id}-${Date.now()}`);
      const capture = createTransport({ ...config, transport: 'capture', dataDir: dryDir });
      for (const contact of audience) await capture.sendMail(campaignMessage(config,campaign,contact));
      console.log(`Dry run: ${audience.length} messages captured under dataDir/dry-runs/. No SMTP, quota or journal changes. Made with PickBits Newsletter`); return;
    }
    delivery = new Delivery(config,createTransport(config));
    const sender = new Sender(config,contacts,campaigns,delivery);
    if (command === 'send') {
      if (!args.includes('--yes')) throw new Error('Use --dry-run or explicitly pass --yes to send.');
      sender.recover(); console.log(JSON.stringify(await sender.start(args[0]),null,2)); return;
    }
    const app = await serve({ config, contacts, campaigns, sender, delivery }); keepLock = true;
    console.log('PickBits Newsletter ready at http://127.0.0.1:4206/login');
    if (config.demo) console.log(`DEMO password: ${DEMO_PASSWORD}\nSynthetic data only. CAPTURE transport: outgoing .eml files are in demo-data/outbox/. SMTP is disabled.`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await app.close(); release(); };
    process.once('SIGINT',stop); process.once('SIGTERM',stop); process.once('exit',release);
  } finally { if (!keepLock) { delivery?.stop(); release(); } }
}
main().catch(error => {
  // Provider exceptions may contain private server details; never print them.
  console.error(error.code && /^(E[A-Z]+|ABORT_ERR)$/.test(error.code) ? 'Command failed. Check local files, config, SMTP credentials and connectivity.' : error.message);
  process.exitCode = 1;
});
