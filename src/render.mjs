// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { createHash } from 'node:crypto';
import { signToken } from './security.mjs';
export const STAMP = 'Made with PickBits Newsletter';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function safeURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !/[\s<>"']/.test(value); } catch { return false; }
}
export function merge(text, contact = {}) {
  return text.replace(/\{\{(first_name|last_name|email)(?:\|([^{}]*))?\}\}/g, (_, key, fallback = '') => String(contact[key] || fallback));
}
// Merge values are emitted as literal text nodes, never reparsed as Markdown or URLs.
function inline(source, contact, html) {
  const pattern = /\{\{(first_name|last_name|email)(?:\|([^{}]*))?\}\}|(!?)\[([^\]\n]*)\]\(([^\s)]*)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*/g;
  let result = '', cursor = 0;
  const literal = s => html ? escapeHTML(s) : s;
  for (const match of source.matchAll(pattern)) {
    result += literal(source.slice(cursor, match.index));
    const [whole, key, fallback, image, label, url, bold, italic] = match;
    if (key) result += literal(String(contact[key] || fallback || ''));
    else if (url !== undefined) {
      const caption = merge(label, contact);
      if (!safeURL(url) || url.includes('{{')) result += literal(caption);
      else if (!html) result += `${caption} (${url})`;
      else result += image ? `<img src="${escapeHTML(url)}" alt="${escapeHTML(caption)}" style="max-width:100%;height:auto">` : `<a href="${escapeHTML(url)}">${escapeHTML(caption)}</a>`;
    } else { const content = literal(merge(bold || italic, contact)); result += html ? `<${bold ? 'strong' : 'em'}>${content}</${bold ? 'strong' : 'em'}>` : content; }
    cursor = match.index + whole.length;
  }
  return result + literal(source.slice(cursor));
}
export function markdown(source, contact = {}, html = true) {
  const blocks = []; let paragraph = [], list = [], listType = '';
  const flushP = () => { if (paragraph.length) { const text = inline(paragraph.join(' '), contact, html); blocks.push(html ? `<p>${text}</p>` : text); paragraph = []; } };
  const flushL = () => { if (list.length) { blocks.push(html ? `<${listType}>${list.map(t => `<li>${inline(t, contact, true)}</li>`).join('')}</${listType}>` : list.map(t => `- ${inline(t, contact, false)}`).join('\n')); list = []; } };
  for (const line of source.replaceAll('\r', '').split('\n')) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line), item = /^(?:([-*])|\d+\.)\s+(.+)$/.exec(line);
    if (heading) { flushP(); flushL(); blocks.push(html ? `<h${heading[1].length}>${inline(heading[2], contact, true)}</h${heading[1].length}>` : inline(heading[2], contact, false)); }
    else if (item) { flushP(); const type = item[1] ? 'ul' : 'ol'; if (listType !== type) flushL(); listType = type; list.push(item[2]); }
    else if (!line.trim()) { flushP(); flushL(); }
    else { flushL(); paragraph.push(line); }
  }
  flushP(); flushL(); return blocks.join(html ? '\n' : '\n\n');
}
export const campaignHash = (campaign, config) => createHash('sha256').update(JSON.stringify([campaign.subject, campaign.markdown, campaign.tag, config.businessName, config.postalAddress, config.logoUrl, config.sender, config.publicUrl])).digest('hex');
export function unsubscribeURL(config, contact) {
  return `${config.publicUrl}/u/${signToken(config.secret, 'unsubscribe', { email: contact.email, generation: contact.generation }, null)}`;
}
export function template(config, body, text, footerURL, footerLabel = 'Unsubscribe') {
  const footer = `${escapeHTML(config.businessName)} · ${escapeHTML(config.postalAddress)}<br><a href="${escapeHTML(footerURL)}">${escapeHTML(footerLabel)}</a><br>${STAMP}`;
  const logo = config.logoUrl ? `<img alt="${escapeHTML(config.businessName)}" src="${escapeHTML(config.logoUrl)}" width="120" style="max-width:100%;height:auto">` : '';
  return { html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(config.businessName)}</title></head><body style="margin:0;background:#f5f3ec;color:#203830;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;padding:24px;background:#fff">${logo}<p style="font-weight:bold">${escapeHTML(config.businessName)}</p>${body}<hr><p style="font-size:12px;line-height:1.6">${footer}</p></div></body></html>`, text: `${text}\n\n${config.businessName}\n${config.postalAddress}\n${footerLabel}: ${footerURL}\n${STAMP}` };
}
export function campaignMessage(config, campaign, contact) {
  const url = unsubscribeURL(config, contact);
  return { from: { name: config.businessName, address: config.sender }, to: contact.email,
    subject: merge(campaign.subject, contact).replace(/[\r\n]/g, ' '),
    ...template(config, markdown(campaign.markdown, contact), markdown(campaign.markdown, contact, false), url),
    headers: { 'List-Unsubscribe': `<${url}>, <mailto:${config.sender}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    disableFileAccess: true, disableUrlAccess: true };
}
export function confirmationMessage(config, contact, token) {
  const url = `${config.publicUrl}/confirm/${token}`;
  return { from: { name: config.businessName, address: config.sender }, to: contact.email, subject: `Confirm your signup to ${config.businessName}`,
    ...template(config, `<h1>Confirm your signup</h1><p><a href="${escapeHTML(url)}">Confirm my subscription</a></p><p>This link expires in 24 hours. If you did not sign up, ignore this email.</p>`, `Confirm your subscription: ${url}\nThis link expires in 24 hours. If you did not sign up, ignore this email.`, url, 'Confirm subscription'), disableFileAccess: true, disableUrlAccess: true };
}
