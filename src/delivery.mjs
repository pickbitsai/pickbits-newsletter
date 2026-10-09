// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { atomicWrite, readJSON, writeJSON } from './files.mjs';
import { presets } from './config.mjs';

export function createTransport(config, env = process.env) {
  if (config.demo && (config.transport !== 'capture' || config.host !== '127.0.0.1')) throw new Error('Demo cannot use SMTP or a public bind.');
  if (config.transport === 'capture') {
    const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows', disableFileAccess: true, disableUrlAccess: true });
    return {
      async sendMail(message) {
        const info = await stream.sendMail(message);
        atomicWrite(join(config.dataDir, 'outbox', `${randomUUID()}.eml`), info.message);
        return { messageId: info.messageId, accepted: [message.to] };
      }, async verify() { return true; }, close() {}
    };
  }
  if (config.transport !== 'smtp') throw new Error('Unknown transport.');
  const smtp = { ...config.smtp, ...presets[config.smtp.preset] };
  const credential = env[smtp.authType === 'oauth2' ? smtp.accessTokenEnv : smtp.passwordEnv];
  if (!credential) throw new Error('The configured SMTP credential environment variable is missing.');
  const auth = smtp.authType === 'oauth2' ? { type: 'OAuth2', user: smtp.user, accessToken: credential } : { user: smtp.user, pass: credential };
  return nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure, auth, pool: false,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
}

export class Delivery {
  constructor(config, transport, clock = {}) {
    this.config = config; this.transport = transport; this.now = clock.now || Date.now;
    this.abort = new AbortController(); this.sleep = clock.sleep || (ms => sleep(ms, undefined, { signal: this.abort.signal }));
    this.queue = Promise.resolve(); this.stopped = false;
    this.file = join(config.dataDir, 'delivery.json');
  }
  send(message, beforeSend = () => {}) {
    const job = this.queue.then(async () => {
      if (this.stopped) throw Object.assign(new Error('Stopping.'), { code: 'STOP' });
      let ledger = readJSON(this.file, { day: '', attempts: 0, nextAt: 0 });
      if (ledger.nextAt > this.now()) await this.sleep(ledger.nextAt - this.now());
      if (this.stopped) throw Object.assign(new Error('Stopping.'), { code: 'STOP' });
      const day = new Date(this.now()).toISOString().slice(0, 10);
      if (ledger.day !== day) ledger = { ...ledger, day, attempts: 0 };
      if (ledger.attempts >= this.config.dailyCap) throw Object.assign(new Error('Daily cap reached; pending messages resume on the next UTC day.'), { code: 'CAP' });
      beforeSend();
      ledger.attempts++; ledger.nextAt = this.now() + 60000 / this.config.messagesPerMinute;
      writeJSON(this.file, ledger);
      const info = await this.transport.sendMail(typeof message === 'function' ? message() : message);
      if (info.rejected?.length) throw Object.assign(new Error('Recipient rejected.'), { responseCode: 550, code: 'EENVELOPE' });
      return info;
    });
    this.queue = job.catch(() => {}); return job;
  }
  stop() { this.stopped = true; this.abort.abort(); this.transport.close?.(); }
}
