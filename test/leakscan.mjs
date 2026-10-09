// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function scanText(text, path = 'text') {
  const findings = [];
  // Client and private names are never listed here; release-guard checks them from a denylist kept outside the repo.
  const forbidden = ['pickbits' + '.ai'];
  text.split(/\r?\n/).forEach((line, index) => {
    const flag = reason => findings.push(`${path}:${index + 1} ${reason}`);
    if (/\b[A-Z]:[\/\\]/i.test(line)) flag('absolute drive path');
    if (line.toLowerCase().includes('pickbits' + '-services')) flag('private workspace name');
    if (/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[a-z]-[A-Za-z0-9-]{10,}|AKIA(?!IOSFODNN7EXAMPLE)[0-9A-Z]{16})/.test(line) || /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(line)) flag('credential literal');
    for (const word of forbidden) if (line.toLowerCase().includes(word)) flag('forbidden private name or domain');
    const emails = line.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
    for (const email of emails) if (!/^(?:example\.com|example\.org|example\.net)$/i.test(email.split('@')[1])) flag('non-synthetic email');
    const phones = line.match(/\+1\d{10}\b|(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b|\b[2-9]\d{9}\b|\b\d{3}-\d{4}\b/g) || [];
    for (const phone of phones) {
      const digits = phone.replace(/\D/g,''), national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
      if (!/^(?:[2-9]\d{2})?55501\d{2}$/.test(national)) flag('non-synthetic phone');
    }
  });
  return findings;
}
export async function leakscan(root = ROOT) {
  const findings = []; let scanned = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git','node_modules','.test-tmp','dist','build','coverage','demo-data','outbox'].includes(entry.name)) continue;
      const full = join(directory,entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const bytes = await readFile(full);
        if (bytes.includes(0)) continue;
        scanned++; findings.push(...scanText(bytes.toString('utf8'),relative(root,full).replaceAll('\\','/')));
      }
    }
  }
  await walk(root); return { scanned, findings };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { scanned, findings } = await leakscan();
  console.log(`leakscan: ${scanned} text files; ${findings.length} findings.`);
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1; }
  else console.log('PASS: public content rules.');
}
