// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Mark Pickering and PICKBITS LLC. Part of PickBits Newsletter.
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './files.mjs';
import { hashPassword, randomSecret } from './security.mjs';
import { Contacts } from './contacts.mjs';
import { Campaigns } from './campaigns.mjs';
export const DEMO_PASSWORD = 'demo-bakery-2026';
export function seedDemo(root = resolve('demo-data')) {
  const file = join(root, 'newsletter.config.json');
  if (existsSync(file)) return file;
  const config = { ...readJSON(new URL('../newsletter.config.example.json', import.meta.url)), demo: true, dataDir: '.', publicUrl: 'http://127.0.0.1:4206', secret: randomSecret(), passwordHash: hashPassword(DEMO_PASSWORD), transport: 'capture' };
  const contacts = new Contacts(root);
  const people = [
    ['Maria','Delgado','maria.delgado@example.com'], ['James','Park','jpark.bakes@example.net'],
    ['Elena','Romero','elena.romero@example.org'], ['Grace','Bennett','grace.bennett@example.com'],
    ['Sofia','Castillo','orders@example.org'], ['Daniel','Brooks','dan.brooks@example.net'],
    ['Lucia','Vega','lucia.vega@example.com'], ['Oliver','Reed','oliver.reed@example.org'],
    ['Rafael','Morales','r.morales.cafe@example.net'], ['Camila','Herrera','camila.h@example.com'],
    ['Henry','Sullivan','henry.sullivan@example.net'], ['Isabel','Navarro','isabel.navarro@example.org'],
    ['Amelia','Watson','kitchen@example.com'], ['Mateo','Rios','mateo.rios@example.net'],
    ['Chloe','Mitchell','chloe.m@example.org'], ['Andres','Salazar','andres.salazar@example.com'],
    ['Julia','Flores','julia.catering@example.org'], ['Thomas','Hayes','tom.hayes@example.net'],
    ['Valeria','Ortega','valeria.ortega@example.com'], ['Ethan','Price','ethan.price@example.org'],
    ['Nora','Campbell','provisions@example.net'], ['Diego','Santos','diego.santos@example.com'],
    ['Hannah','Foster','hannah.foster@example.net'], ['Marisol','Cruz','marisol.cruz@example.org'],
    ['Luis','Mendoza','luis.market@example.com'], ['Abigail','Turner','abby.turner@example.net'],
    ['Carmen','Aguilar','carmen.aguilar@example.org'], ['Samuel','Collins','sam.collins@example.com'],
    ['Victoria','Ramirez','breakfast@example.org'], ['Benjamin','Walker','ben.walker@example.net'],
    ['Ana','Fuentes','ana.fuentes@example.com'], ['Charlotte','Morgan','charlotte.morgan@example.org'],
    ['Pablo','Medina','pablo.cafe@example.net'], ['Emily','Parker','emily.parker@example.com'],
    ['Teresa','Soto','teresa.soto@example.org'], ['Jack','Wilson','jack.wilson@example.net'],
    ['Adrian','Luna','adrian.luna@example.com'], ['Claire','Hughes','claire.hughes@example.org'],
    ['Gabriel','Torres','gabriel.torres@example.net'], ['Natalie','Evans','natalie.evans@example.com']
  ];
  const today = Date.now();
  const records = people.map(([first_name, last_name, email], i) => {
    const status = i < 32 ? 'subscribed' : i < 35 ? 'unconfirmed' : i < 38 ? 'unsubscribed' : i === 38 ? 'bounced' : 'complained';
    const source = i % 4 === 0 ? 'Wholesale account form' : ['Signed up at the counter tablet', 'Website signup form', 'Moved from previous newsletter service'][i % 3];
    const date = new Date(today - (42 + (i * 47) % 680) * 86400000).toISOString();
    const method = source === 'Moved from previous newsletter service' ? 'import-attested' : source === 'Wholesale account form' ? 'manual-attested' : 'signup-confirmed';
    const subscribedAt = new Date(Date.parse(date) + 5 * 60000).toISOString();
    return { email, first_name, last_name, tags: [i % 4 === 0 ? 'wholesale' : 'retail'], status, consent_source: source, consent_date: date, consentRecordedAt: date, confirmedAt: status === 'subscribed' && method === 'signup-confirmed' ? subscribedAt : null, ...(status === 'subscribed' ? { subscription: { method, source, date, at: subscribedAt } } : {}), generation: randomUUID() };
  });
  contacts.write({ contacts: records, suppression: Object.fromEntries(records.filter(c => ['unsubscribed','bounced','complained'].includes(c.status)).map(c => [c.email,{ status: c.status, at: '2026-09-01T12:00:00.000Z' }])) });
  const campaigns = new Campaigns(root);
  campaigns.save({ subject: 'A cozy Saturday at Juniper Crumb', tag: 'retail', markdown: '# A little warmth for your weekend\n\nHello {{first_name|there}},\n\nThe first cool mornings have us reaching for cinnamon. This Saturday, we will have honey oat sourdough, orange-glazed morning buns and roasted pear hand pies on the counter from 7 a.m. The pear pies sold out before lunch last week, so reply by Friday afternoon if you would like us to tuck a couple aside. Bring your coffee cup and stay a while.\n\n[See this week\'s menu](https://example.com/menu)\n\nWarmly,\nThe Juniper Crumb crew' }, 'demo-retail');
  campaigns.save({ subject: 'Your autumn wholesale bake list', tag: 'wholesale', markdown: '# Fresh bakes for your counter\n\nHello {{first_name|there}},\n\nOur autumn bake list is ready: seeded sandwich loaves, mini cinnamon rolls and pear hand pies sized for a coffee break. Please send next week\'s quantities by Thursday at noon so we can plan the dough. Pickup is available Tuesday and Friday from 6:30 a.m.; let us know if your opening hours have changed. If you are trying the hand pies for the first time, we will add two samples to your next order. Thank you for making room for our bread on your counter.\n\n[View the wholesale menu](https://example.com/wholesale)' }, 'demo-wholesale');
  const sent = campaigns.save({ subject: 'September at the bakery', tag: '', markdown: '# Hello, Tucson\n\nHello {{first_name|there}},\n\nThank you for keeping our little bakery busy through the warm September mornings. Your requests brought the green chile cheddar loaf back to the Friday bread rack, and it is staying for October. We are also testing a mesquite honey cookie with crisp edges and a soft middle; ask for a taste next time you stop in. It means a lot to see familiar faces at the counter each week.\n\nSee you soon,\nThe Juniper Crumb crew' }, 'demo-sent');
  sent.status = 'complete'; sent.createdAt = '2026-09-15T12:00:00.000Z'; campaigns.write(sent);
  campaigns.writeJournal(sent.id, { version: 1, synthetic: true, campaign: sent, createdAt: sent.createdAt, recipients: Object.fromEntries(records.filter(c => c.status === 'subscribed').map(c => [c.email, { status: 'sent', generation: c.generation, at: sent.createdAt }])) });
  // Publish the config last: its existence means the synthetic seed is complete.
  writeJSON(file, config); return file;
}
