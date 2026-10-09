// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,copyFile,readFile,readdir,rm } from 'node:fs/promises';
import { join,dirname,resolve,relative,isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base=join(root,'.test-tmp');
await mkdir(base,{recursive:true});const consumer=await mkdtemp(join(base,'consumer-'));
const npmCli=process.env.npm_execpath;assert.ok(npmCli,'Run through npm run consumer or npm run preflight.');
// Offline installs read the developer's normal npm cache, which `npm ci` has already filled.
const env={...process.env,npm_config_update_notifier:'false',TEMP:consumer,TMP:consumer,TMPDIR:consumer};
for(const key of Object.keys(env))if(key.startsWith('NEWSLETTER_'))delete env[key];
async function run(binary,args,cwd=consumer){
  return await new Promise((resolveRun,reject)=>{const child=spawn(binary,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('exit',code=>{try{assert.equal(code,0,output);resolveRun(output);}catch(error){reject(error);}});});
}
let checks=0;
try{
  // Before the first commit, unignored untracked files are the prospective source release.
  const listing=await run('git',['ls-files','--cached','--others','--exclude-standard','-z'],root);
  const files=[...new Set(listing.split('\0').filter(Boolean))];assert.ok(files.includes('package-lock.json'));
  for(const file of files){assert.ok(!file.startsWith('../')&&!isAbsolute(file));const target=join(consumer,file);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,file),target);}
  assert.ok(!files.some(file=>/^(?:node_modules|demo-data|newsletter-data|\.test-tmp)\//.test(file)));checks++;
  await run(process.execPath,[npmCli,'ci','--offline','--ignore-scripts','--no-audit','--no-fund']);checks++;
  const cli=args=>run(process.execPath,[npmCli,'exec','--offline','--','newsletter',...args]);
  assert.match(await cli(['--help']),/PickBits Newsletter 0\.1\.0/);checks++;
  await cli(['init']);const config=JSON.parse(await readFile(join(consumer,'newsletter.config.json'),'utf8'));assert.equal(config.transport,'capture');assert.equal(config.secret.length,64);checks++;
  await cli(['demo','--seed-only']);checks++;
  const demoConfig=join('demo-data','newsletter.config.json');assert.match(await cli(['doctor','--config',demoConfig]),/SMTP not contacted/);checks++;
  assert.match(await cli(['send','demo-retail','--dry-run','--config',demoConfig]),/24 messages captured/);
  const runs=await readdir(join(consumer,'demo-data','dry-runs'));const emls=await readdir(join(consumer,'demo-data','dry-runs',runs[0],'outbox'));assert.equal(emls.length,24);
  for (const file of emls) {
    const eml = await readFile(join(consumer,'demo-data','dry-runs',runs[0],'outbox',file),'utf8');
    // MIME quoted-printable soft wraps can split any word in the visible stamp.
    assert.match(eml.replace(/=\r?\n/g,''),/Made with PickBits Newsletter/);
  }
  checks++;
  const contacts=JSON.parse(await readFile(join(consumer,'demo-data','contacts.json'),'utf8'));assert.equal(contacts.contacts.length,40);
  const journalExists=(await readdir(join(consumer,'demo-data','campaigns'))).includes('demo-retail.journal.json');assert.equal(journalExists,false);checks++;
  console.log(`consumer install PASS: ${checks}/8 checks; clean source copy, offline npm ci, installed bin, init, demo seed, doctor, 24 capture previews, unchanged send journal.`);
}finally{
  const checked=resolve(consumer),rel=relative(base,checked);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel));await rm(checked,{recursive:true,force:true});
}
