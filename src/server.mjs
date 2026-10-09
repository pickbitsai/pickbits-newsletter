// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { validateConfig } from './config.mjs';
import { createHandler } from './http.mjs';
import { Imports, ConfirmationSender } from './imports.mjs';
export async function serve(context) {
  const { config, sender, delivery } = context;
  validateConfig(config, { requirePassword: true });
  const imports = context.imports || new Imports(config.dataDir, context.contacts);
  const confirmations = context.confirmations || new ConfirmationSender(config, context.contacts, imports, delivery);
  const handle = createHandler({ ...context, imports, confirmations });
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000 }, async (req, res) => {
    try {
      const allowed = [new URL(config.adminOrigin).host, new URL(config.publicUrl).host, '127.0.0.1:4206'];
      if (!allowed.includes(req.headers.host)) { res.writeHead(421); res.end('Unexpected host.'); return; }
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 5 * 1024 * 1024) { res.writeHead(413); res.end('Request too large.'); return; }
        chunks.push(chunk);
      }
      const request = new Request(new URL(req.url, config.adminOrigin), { method: req.method, headers: req.headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      // Trust only a single, validated client IP supplied by a loopback reverse proxy.
      const forwarded = req.headers['x-real-ip'];
      const ip = config.trustProxy === true && req.socket.remoteAddress === '127.0.0.1' && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
      const response = await handle(request, { ip });
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!res.headersSent) res.writeHead(500); res.end('Request failed.'); }
  });
  server.keepAliveTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4206, '127.0.0.1', resolve); });
  sender.recover(); confirmations.recover();
  const resume = () => {
    if (delivery.stopped) return;
    for (const batch of imports.all()) if (['sending','paused'].includes(batch.status)) confirmations.start(batch.id).catch(() => console.error('Confirmation requests paused after a local error; inspect the import journal.'));
    for (const campaign of context.campaigns.all()) if (['sending','paused'].includes(campaign.status)) sender.start(campaign.id).catch(() => console.error('A campaign paused after a local error; inspect its journal.'));
  };
  resume(); const timer = setInterval(resume, 30000); timer.unref();
  return { server, async close() { clearInterval(timer); delivery.stop(); server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); await delivery.queue; await Promise.allSettled([...sender.jobs.values(), ...confirmations.jobs.values()]); } };
}
