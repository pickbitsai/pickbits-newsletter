// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { authenticated, sameOrigin, checkPassword, sessionCookie, signToken, verifyToken, RateLimiter } from './security.mjs';
import { escapeHTML as e, campaignMessage, campaignHash, confirmationMessage } from './render.mjs';
import { normalizeEmail, statuses } from './contacts.mjs';
import { page, input, intro, badge, signupForm, consentCheckbox } from './ui.mjs';
import { readJSON, writeJSON } from './files.mjs';
import { validateConfig } from './config.mjs';
import { Imports, ConfirmationSender } from './imports.mjs';

const redirect = (path, headers = {}) => new Response(null, { status: 303, headers: { location: path, ...headers } });
const reportTable = rows => `<div class="table-wrap"><table><thead><tr><th>CSV row</th><th>Email</th><th>Result</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r.row}</td><td>${e(r.email)}</td><td>${e(r.result)}</td></tr>`).join('')}</tbody></table></div>`;
export function createHandler({ config, contacts, campaigns, sender, delivery, imports = new Imports(config.dataDir, contacts), confirmations = new ConfirmationSender(config, contacts, imports, delivery) }) {
  const limiter = new RateLimiter();
  const handle = async (request, { ip = 'local' } = {}) => {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const nonce = randomBytes(16).toString('base64');
    let admin = false;
    const html = (title, body, status = 200, script = false) => new Response(page(title, body, { config, nonce, admin, script }), { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https:; connect-src 'self'; frame-src 'self' about:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
    const form = async () => {
      if (!(request.headers.get('content-type') || '').startsWith('application/x-www-form-urlencoded')) throw new Error('Use a URL-encoded form.');
      const body = await request.text(); if (Buffer.byteLength(body) > 5 * 1024 * 1024) throw new Error('Request too large.');
      return Object.fromEntries(new URLSearchParams(body));
    };
    try {
      if (!['GET','POST'].includes(method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
      if (path === '/signup') {
        if (method === 'GET') return html('Newsletter signup', `<div class="card" style="max-width:560px;margin:auto"><h1>A little good news.</h1><p>Join ${e(config.businessName)} for our newsletter.</p>${signupForm(config)}</div>`);
        if (!limiter.allow(`signup:${ip}`, 5, 60 * 60 * 1000)) return html('Please wait', '<h1>Please try again later.</h1>', 429);
        const f = await form();
        if (!f.website) {
          if (f.consent !== 'yes' || !normalizeEmail(f.email)) return html('Check your signup', '<h1>Enter a valid email and agree to receive the newsletter.</h1>', 400);
          const pending = contacts.beginSignup({ email: f.email, first_name: f.first_name });
          if (pending) {
            const token = signToken(config.secret, 'confirm', pending, 24 * 60 * 60 * 1000);
            try { await delivery.send(confirmationMessage(config, pending, token)); }
            catch { return html('Try again later', '<h1>We could not send a confirmation right now.</h1><p>Please try again in 15 minutes.</p>', 503); }
          }
        }
        return html('Check your email', '<div class="card"><h1>Check your email.</h1><p>If confirmation is needed, you will receive a link to finish signing up.</p></div>');
      }
      const publicMatch = /^\/(confirm|u)\/([^/]+)$/.exec(path);
      if (publicMatch) {
        const confirm = publicMatch[1] === 'confirm', payload = verifyToken(config.secret, publicMatch[2], confirm ? 'confirm' : 'unsubscribe');
        if (!payload || !normalizeEmail(payload.email)) return html('Invalid link', '<h1>This link is invalid or expired.</h1><p><a href="/signup">Sign up for a fresh confirmation.</a></p>', 400);
        if (method === 'GET') return html(confirm ? 'Confirm signup' : 'Unsubscribe', `<div class="card"><h1>${confirm ? 'Confirm your subscription' : 'Leave this newsletter?'}</h1><p>${e(payload.email)}</p><form method="post" action="${e(path)}"><button>${confirm ? 'Confirm subscription' : 'Unsubscribe'}</button></form></div>`);
        if (confirm) {
          const ok = contacts.confirm(payload.email, payload.pending);
          return html('Subscription confirmation', `<h1>${ok ? 'You are subscribed.' : 'This confirmation has already been used or replaced.'}</h1>`);
        }
        const c = contacts.get(payload.email);
        if (c && c.generation === payload.generation) contacts.suppress(payload.email);
        return html('Unsubscribed', '<h1>You are unsubscribed.</h1><p>This request is complete. Only a fresh signup and confirmation can subscribe you again.</p>');
      }
      // Capability-bearing public forms above intentionally accept cross-origin/no-Origin POSTs.
      // Admin mutations, including login, always require the configured Origin.
      if (method === 'POST' && !sameOrigin(request, config)) return html('Forbidden', '<h1>A matching Origin header is required.</h1>', 403);
      if (path === '/login') {
        if (method === 'GET') return html('Sign in', `<div class="card" style="max-width:440px;margin:auto"><p class="eyebrow">PickBits Newsletter</p><h1>Welcome back.</h1><p>Your newsletter starts here.</p><form method="post" action="/login">${input('password','Admin password','','password','required autocomplete="current-password"')}<button>Sign in</button></form></div>`);
        if (!limiter.allow(`login:${ip}`, 10, 15 * 60 * 1000)) return html('Please wait', '<h1>Too many attempts. Try again in 15 minutes.</h1>', 429);
        const f = await form();
        if (!await checkPassword(f.password, config.passwordHash)) return html('Sign in failed', '<h1>Incorrect password.</h1><a href="/login">Try again</a>', 401);
        return redirect('/contacts', { 'set-cookie': sessionCookie(config) });
      }
      if (!authenticated(request, config)) return redirect('/login');
      admin = true;
      if (path === '/logout' && method === 'POST') return redirect('/login', { 'set-cookie': 'newsletter_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      if (path === '/assets/app.js' && method === 'GET') return new Response(readFileSync(new URL('../public/app.js', import.meta.url)), { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
      if (path === '/' && method === 'GET') return redirect('/contacts');
      if (path === '/contacts/export' && method === 'GET') return new Response(contacts.export(), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="contacts.csv"' } });
      if (path === '/contacts' && method === 'GET') {
        const all = contacts.all(), query = (url.searchParams.get('q') || '').toLowerCase(), filtered = all.filter(c => `${c.email} ${c.first_name} ${c.last_name} ${c.tags.join(' ')}`.toLowerCase().includes(query));
        const pageNumber = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1), offset = (pageNumber - 1) * 100;
        const counts = Object.fromEntries(statuses.map(s => [s, all.filter(c => c.status === s).length]));
        return html('Contacts', `${intro('Your people, all in one place.','Campaigns go to subscribed contacts with confirmed signup or owner-attested consent. Keep consent records with every contact.')}<div class="stats">${[['All contacts',all.length],['Subscribed',counts.subscribed],['Awaiting confirmation',counts.unconfirmed],['Suppressed',counts.unsubscribed + counts.bounced + counts.complained]].map(([label,count]) => `<div class="stat"><strong>${count}</strong><span>${label}</span></div>`).join('')}</div><div class="toolbar"><form method="get"><input name="q" aria-label="Search contacts" placeholder="Search name, email or tag" value="${e(query)}"><button class="secondary">Search</button></form><div><a class="button secondary" href="/contacts/export">Export CSV</a> <a class="button" href="/import">Import contacts</a></div></div><div class="card table-wrap"><table><thead><tr><th>Contact</th><th>Tags</th><th>Status</th><th></th></tr></thead><tbody>${filtered.slice(offset, offset + 100).map(c => `<tr><td><strong>${e([c.first_name,c.last_name].filter(Boolean).join(' ') || 'Unnamed contact')}</strong><br>${e(c.email)}</td><td>${e(c.tags.join(', '))}</td><td>${badge(c.status)}</td><td><a href="/contacts/edit?email=${encodeURIComponent(c.email)}">Edit</a></td></tr>`).join('') || '<tr><td colspan="4">No contacts yet. Add one below or import a CSV.</td></tr>'}</tbody></table><p><small>${filtered.length} matching contacts · Page ${pageNumber}</small></p>${pageNumber > 1 ? `<a href="?q=${encodeURIComponent(query)}&page=${pageNumber - 1}">Previous</a> ` : ''}${offset + 100 < filtered.length ? `<a href="?q=${encodeURIComponent(query)}&page=${pageNumber + 1}">Next</a>` : ''}</div><details class="card"><summary>Add a contact</summary><form method="post" action="/contacts/add">${input('email','Email','','email','required')}${input('first_name','First name')}${input('last_name','Last name')}${input('tags','Tags (comma-separated)')}${input('consent_source','Consent source','','text','required')}${consentCheckbox}<p><small>With your consent attestation and a source, this contact becomes subscribed. Suppressed addresses stay suppressed.</small></p><button>Add contact</button></form></details>`);
      }
      if (path === '/contacts/add' && method === 'POST') { const f = await form(); contacts.add(f, f.consent === 'yes'); return redirect('/contacts'); }
      if (path === '/contacts/edit') {
        if (method === 'POST') { const f = await form(); contacts.edit(f.email, f); return redirect('/contacts'); }
        const c = contacts.get(url.searchParams.get('email')); if (!c) return html('Not found','<h1>Contact not found.</h1>',404);
        return html('Contacts', `${intro('Edit contact',c.email)}<div class="card"><form method="post"><input type="hidden" name="email" value="${e(c.email)}">${input('first_name','First name',c.first_name)}${input('last_name','Last name',c.last_name)}${input('tags','Tags (comma-separated)',c.tags.join(', '))}<label for="status">Status</label><select name="status" id="status">${[...new Set([c.status,'unsubscribed','bounced','complained'])].map(s => `<option${c.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select><p><small>Only the recipient can resubscribe through double opt-in.</small></p><p>Consent source: ${e(c.consent_source || 'Pending')}<br>Consent date: ${e(c.consent_date || 'Pending')}<br>Subscribed via: ${e(c.subscription?.method || (c.confirmedAt ? 'signup-confirmed' : 'Not subscribed'))}<br>Subscribed at: ${e(c.subscription?.at || c.confirmedAt || 'Not yet')}<br>Confirmed: ${e(c.confirmedAt || 'No double opt-in recorded')}</p><button>Save contact</button></form><form method="post" action="/contacts/delete"><input type="hidden" name="email" value="${e(c.email)}"><button class="danger">Delete contact and keep suppression</button></form></div>`);
      }
      if (path === '/contacts/delete' && method === 'POST') { contacts.delete((await form()).email); return redirect('/contacts'); }
      if (path === '/import' && method === 'GET') return html('Import', `${intro('Bring your list.','Preview every row before importing. Existing suppression always wins.')}<div class="card"><p class="note">Choose how these people join your list. Only import people who agreed to hear from you. Unsubscribed, bounced and complained addresses stay suppressed.</p><form method="post" action="/import/preview"><label for="csv-file">Choose a CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv"><small id="file-note">Up to 5 MB. Or paste your CSV below.</small><label for="csv">CSV contents</label><textarea id="csv" name="csv" required placeholder="email,first_name,last_name,tags,consent_source,consent_date"></textarea>${input('source','Default consent source (if a row has none)')}<label for="mode">Subscription choice</label><select id="mode" name="mode"><option value="attested">They already agreed (e.g. moving from another newsletter service)</option><option value="confirm">Ask them to confirm first</option></select>${consentCheckbox}<button>Preview import</button></form></div><div class="card"><h2>Previous imports</h2>${imports.all().map(batch => `<p><a href="/imports/${batch.id}">${e(batch.createdAt)} &middot; ${batch.count} contacts &middot; ${batch.mode === 'confirm' ? 'Confirm first' : 'Consent attested'}</a></p>`).join('') || '<p>No imports yet.</p>'}</div>`,200,true);
      if (path === '/import/preview' && method === 'POST') {
        const f = await form(), report = contacts.import(f.csv || '', { consent: f.consent === 'yes', source: f.source, mode: f.mode || 'attested' });
        const digest = createHash('sha256').update(JSON.stringify([f.csv,f.source || '',f.mode || 'attested'])).digest('hex');
        const token = signToken(config.secret,'import',{ digest }, 15 * 60 * 1000);
        return html('Import', `${intro('Review your import.',`${report.filter(r => r.result === 'ready').length} rows ready as ${f.mode === 'confirm' ? 'unconfirmed' : 'subscribed'}. Nothing has been saved yet.`)}<div class="card">${reportTable(report)}<form method="post" action="/import/commit"><input type="hidden" name="csv" value="${e(f.csv)}"><input type="hidden" name="source" value="${e(f.source)}"><input type="hidden" name="mode" value="${e(f.mode || 'attested')}"><input type="hidden" name="preview" value="${e(token)}">${consentCheckbox}<button>Import reviewed rows</button></form></div>`);
      }
      if (path === '/import/commit' && method === 'POST') {
        const f = await form(), token = verifyToken(config.secret,f.preview,'import'), digest = createHash('sha256').update(JSON.stringify([f.csv,f.source || '',f.mode || 'attested'])).digest('hex');
        if (token?.digest !== digest) throw new Error('Preview expired or changed. Preview the CSV again.');
        const report = contacts.import(f.csv, { consent: f.consent === 'yes', source: f.source, mode: f.mode || 'attested', commit: true });
        return html('Import', `${intro('Import complete.',f.mode === 'confirm' ? 'Imported contacts await confirmation. Send their confirmation request below.' : 'Imported contacts are subscribed with your consent attestation.')}<div class="card">${reportTable(report)}${f.mode === 'confirm' ? `<form method="post" action="/imports/${report.importId}/send"><button>Send confirmation request</button></form>` : ''}<a href="/imports/${report.importId}">View import details</a> <a class="button" href="/contacts">View contacts</a></div>`);
      }
      const im = /^\/imports\/([a-z0-9-]+)(?:\/(send))?$/.exec(path);
      if (im) {
        const [, id, action] = im, batch = imports.get(id);
        if (method === 'POST' && action === 'send') { confirmations.start(id).catch(() => {}); return redirect(`/imports/${id}`); }
        if (method !== 'GET' || action) return html('Not found', '<h1>Page not found.</h1>', 404);
        const counts = imports.counts(id), journal = imports.journal(id);
        return html('Import', `${intro('Your import.', `${batch.count} contacts imported on ${batch.createdAt.slice(0,10)}.`)}<div class="card"><p>${batch.mode === 'attested' ? 'Subscribed with owner-attested consent.' : 'Contacts remain unconfirmed until they use their confirmation link.'}</p>${batch.mode === 'confirm' ? `<p>Confirmation requests: ${e(batch.status)}</p>` : ''}${batch.note ? `<p class="note">${e(batch.note)}</p>` : ''}${batch.mode === 'confirm' && ['draft','paused'].includes(batch.status) ? `<form method="post" action="/imports/${id}/send"><button>Send confirmation request</button></form>` : ''}<div class="stats">${['total','sent','failed','pending','uncertain','skipped'].map(key => `<div class="stat"><strong>${counts[key]}</strong><span>${key}</span></div>`).join('')}</div><p>Each address is attempted once for this import. Pending requests resume after a restart or daily limit. Expired links can be renewed by the recipient through the signup page.</p><a href="/imports/${id}">Refresh progress</a></div><div class="card table-wrap"><table><thead><tr><th>Email</th><th>Request status</th><th>Details</th></tr></thead><tbody>${Object.entries(journal?.recipients || {}).map(([email,r]) => `<tr><td>${e(email)}</td><td>${badge(r.status)}</td><td>${e(r.error || '')}</td></tr>`).join('') || '<tr><td colspan="3">No confirmation requests yet.</td></tr>'}</tbody></table></div>`);
      }
      if (path === '/compose') {
        if (method === 'POST') { const f = await form(); const c = campaigns.save(f, f.id || undefined); return redirect(`/campaigns/${c.id}`); }
        const c = url.searchParams.has('id') ? campaigns.get(url.searchParams.get('id')) : { subject: '', markdown: '# Fresh from the oven\n\nHello {{first_name|there}},\n\nHere is what is new this week.', tag: '' };
        if (c.status && c.status !== 'draft') throw new Error('This campaign has already started.');
        return html('Compose', `${intro('A newsletter worth opening.','Write a simple message, preview it, then send a test to your mailbox.')}<div class="grid"><div class="card"><form id="composer" method="post">${c.id ? `<input type="hidden" name="id" value="${e(c.id)}">` : ''}${input('subject','Subject',c.subject,'text','required maxlength="200"')}${input('tag','Audience tag (blank means all subscribed contacts)',c.tag)}<label for="markdown">Message in Markdown</label><textarea id="markdown" name="markdown" style="min-height:360px" required>${e(c.markdown)}</textarea><p><small>Headings, paragraphs, **bold**, *italic*, lists, [links](https://example.com), and ![images](https://example.com/image.png). Personalize with {{first_name|there}}.</small></p><button>Save draft</button></form></div><div><h2>Live preview</h2><iframe id="preview" title="Email preview" sandbox=""></iframe><small id="preview-status" aria-live="polite">Preparing preview…</small></div></div>`,200,true);
      }
      if (path === '/preview' && method === 'POST') {
        const f = await form(); if ((f.markdown || '').length > 100000) throw new Error('Message too long.');
        return new Response(campaignMessage(config, { subject: f.subject || '', markdown: f.markdown || '' }, { email: 'reader@example.com', first_name: 'Rowan', generation: 'preview' }).html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; sandbox" } });
      }
      if (path === '/campaigns' && method === 'GET') return html('Campaigns', `${intro('Every newsletter, accounted for.','Track delivery attempts and keep a record of what you sent.')}<div class="toolbar"><a class="button" href="/compose">Write a newsletter</a></div><div class="card table-wrap"><table><thead><tr><th>Newsletter</th><th>Audience</th><th>Status</th><th>Sent / Failed</th></tr></thead><tbody>${campaigns.all().map(c => { const n = campaigns.counts(c.id); return `<tr><td><a href="/campaigns/${c.id}"><strong>${e(c.subject)}</strong></a><br><small>${e(c.createdAt.slice(0,10))}</small></td><td>${e(c.tag || 'All subscribed')}</td><td>${badge(c.status)}</td><td>${n.sent} / ${n.failed}</td></tr>`; }).join('') || '<tr><td colspan="4">Your first newsletter starts with a draft.</td></tr>'}</tbody></table></div>`);
      const cm = /^\/campaigns\/([a-z0-9-]+)(?:\/(test|send|progress))?$/.exec(path);
      if (cm) {
        const [,id,action] = cm, c = campaigns.get(id);
        if (method === 'POST' && action === 'test') { await sender.test(id); return redirect(`/campaigns/${id}`); }
        if (method === 'POST' && action === 'send') { sender.start(id).catch(() => {}); return redirect(`/campaigns/${id}`); }
        if (method !== 'GET') return html('Not found','<h1>Page not found.</h1>',404);
        const counts = campaigns.counts(id);
        if (action === 'progress') return Response.json({ status: c.status, counts });
        const tested = c.testedHash === campaignHash(c,config), journal = campaigns.journal(id);
        return html('Campaigns', `${intro(c.subject,`Audience: ${c.tag || 'all subscribed contacts'}`)}<div class="card"${c.status === 'sending' ? ` data-campaign="${id}"` : ''}><p>Status: <strong id="campaign-status">${e(c.status)}</strong></p>${c.note ? `<p class="note">${e(c.note)}</p>` : ''}<progress max="${counts.total || 1}" value="${counts.total - counts.pending - counts.inflight}"></progress><div class="stats">${['total','sent','failed','pending','uncertain','skipped'].map(key => `<div class="stat"><strong data-count="${key}">${counts[key]}</strong><span>${key}</span></div>`).join('')}</div>${c.status === 'draft' ? `<p>${sender.audience(c).length} subscribed recipients currently match.</p><a href="/compose?id=${id}">Edit draft</a><form method="post" action="/campaigns/${id}/test"><button class="secondary">Send test to me</button></form><p><small>${tested ? 'Test sent. Check your mailbox or demo outbox before sending.' : 'A successful test is required before sending.'}</small></p><form method="post" action="/campaigns/${id}/send"><button${tested ? '' : ' disabled'}>Send to subscribed audience</button></form>` : c.status === 'paused' ? `<form method="post" action="/campaigns/${id}/send"><button>Resume pending messages</button></form>` : ''}<p><small>Uncertain attempts are never retried automatically. Check your provider before creating another campaign for those readers.</small></p><a href="/campaigns/${id}">Refresh errors and details</a></div><div class="card table-wrap"><h2>Per-address journal</h2><table><thead><tr><th>Email</th><th>Status</th><th>Details</th></tr></thead><tbody>${Object.entries(journal?.recipients || {}).map(([email,r]) => `<tr><td>${e(email)}</td><td>${badge(r.status)}</td><td>${e(r.error || '')}</td></tr>`).join('') || '<tr><td colspan="3">No campaign delivery attempts yet.</td></tr>'}</tbody></table></div>`,200,c.status === 'sending');
      }
      if (path === '/settings') {
        if (method === 'POST') {
          if (sender.jobs.size || confirmations.jobs.size) throw new Error('Wait for active sends to finish before changing settings.');
          const f = await form(), stored = readJSON(config.configFile);
          for (const key of ['businessName','postalAddress','logoUrl']) stored[key] = f[key] || '';
          stored.messagesPerMinute = Number(f.messagesPerMinute); stored.dailyCap = Number(f.dailyCap);
          validateConfig(stored, { requirePassword: true }); writeJSON(config.configFile, stored);
          Object.assign(config, { businessName: stored.businessName, postalAddress: stored.postalAddress, logoUrl: stored.logoUrl, messagesPerMinute: stored.messagesPerMinute, dailyCap: stored.dailyCap });
          return redirect('/settings');
        }
        const snippet = `<form method="post" action="${config.publicUrl}/signup">\n  <label>Email <input type="email" name="email" required></label>\n  <label>First name <input name="first_name"></label>\n  <div hidden><input name="website" tabindex="-1" autocomplete="off"></div>\n  <label><input type="checkbox" name="consent" value="yes" required>I agree to receive the newsletter.</label>\n  <button>Subscribe</button>\n  <small>Made with PickBits Newsletter</small>\n</form>`;
        return html('Settings', `${intro('Make it yours.','Your provider handles delivery and sets its own sending limits.')}<div class="grid"><div class="card"><form method="post">${input('businessName','Business name',config.businessName,'text','required')}${input('postalAddress','Physical postal address',config.postalAddress,'text','required')}${input('logoUrl','Optional logo URL (HTTPS)',config.logoUrl,'url')}${input('messagesPerMinute','Messages per minute',config.messagesPerMinute,'number','min="1" max="10000" required')}${input('dailyCap','Daily attempt cap (UTC)',config.dailyCap,'number','min="1" max="10000" required')}<button>Save settings</button></form></div><div class="card"><h2>Mailbox & public signup</h2><p>Transport: <strong>${e(config.transport)}</strong><br>Sender: ${e(config.sender)}<br>SMTP preset: ${e(config.smtp.preset)}</p><p><small>Mailbox, credentials, signing secret, and public URL are configured locally in newsletter.config.json. Restart after editing that file. SMTP secrets stay in environment variables.</small></p><a href="${e(config.publicUrl)}/signup">Open public signup page</a><h2>Embed on your website</h2><p><small>Copy this HTML form into your website. No JavaScript needed.</small></p><pre>${e(snippet)}</pre></div></div>`);
      }
      return html('Not found','<h1>Page not found.</h1>',404);
    } catch (error) {
      const known = /^(Use |Invalid |Confirm |Contact |Only |CSV |Malformed |Unclosed |Data |Choose |Preview |Message |This |Started |Send a |Wait for |A valid |businessName|postalAddress|Logo |messagesPerMinute|dailyCap)/.test(error.message);
      return html('Request could not be completed', `<h1>We could not complete that request.</h1><p>${e(known ? error.message : 'Check the form and configuration, then try again. No provider credentials are shown here.')}</p><p><a href="${admin ? '/campaigns' : '/signup'}">Continue</a></p>`, 400);
    }
  };
  return async (request, context) => {
    const response = await handle(request, context);
    const publicPage = /^\/(?:signup(?:$|\/)|confirm\/|u\/)/.test(new URL(request.url).pathname);
    response.headers.set('cache-control','no-store'); response.headers.set('x-content-type-options','nosniff');
    // no-referrer can turn a browser's form Origin into "null". Preserve same-origin
    // admin form submissions while keeping public capability URLs out of referrers.
    response.headers.set('referrer-policy',publicPage ? 'no-referrer' : 'same-origin'); response.headers.set('x-frame-options','DENY');
    return response;
  };
}
