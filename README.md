How do I send my customer newsletter without paying Mailchimp every month? PickBits Newsletter keeps your list in files you own, lets you write the newsletter here, and sends it through the email account you already pay for. Delivery still runs through your email provider, which keeps its own sending limits.

## What it does

PickBits Newsletter 0.1.0 is an Apache-2.0 tool for one small business and one owner. It runs on Node 22 or newer, uses plain `node:http`, has no build step, and has exactly one runtime dependency: Nodemailer for SMTP and email serialization.

- Add, edit, delete, search, tag, import and export contacts. CSV imports have a preview and a result for every row. Consent source, consent date and the time consent was recorded stay with each contact.
- Collect signups with a public page or a plain HTML form on your existing website. Public signups complete double opt-in. Owners can import or manually add existing subscribers with a consent attestation and source, or import as unconfirmed and send a confirmation request. Suppression always wins.
- Write a small, safe Markdown subset with live HTML preview and automatic plain text. Use `{{first_name|there}}`, `{{last_name|friend}}` or `{{email}}`. Headings, paragraphs, bold, italic, lists, HTTPS links and HTTPS images are supported. Raw HTML stays text. Images stay at the URLs you supply.
- Send a test to the configured sender, then send to all subscribed contacts or one tag. The audience and message are frozen when sending starts. See sent, failed, pending, skipped and uncertain counts, plus a journal for each address.
- Keep a visible unsubscribe link, your required physical postal address and the small line “Made with PickBits Newsletter” in campaign emails. CSV exports carry an `output_stamp (Made with PickBits Newsletter)` column, so even an empty export has attribution.

## What it does not do

This is not a deliverability service. It does not warm up domains, host images, run A/B tests, automations, or analytics/open tracking. There is deliberately no tracking pixel and no click tracking. There is no telemetry, hosted account, runtime CDN or font download. Large lists and frequent bulk sends belong with a bulk email provider; this file-based app is designed for lists up to about 10,000 contacts, not for sending that many messages through a small mailbox at once.

It does not read your inbox, process delivery-status emails or complaint webhooks, or manage OAuth authorization and token refresh. The owner handles unsubscribe replies arriving in the sender mailbox and marks later bounces or complaints in Contacts. SMTP acceptance is counted as “sent”; it does not prove inbox delivery. There is one admin password, no multi-user permissions, scheduling, attachments, automatic retries of failed messages, or multi-process deployment.

The owner is responsible for consent and following anti-spam law, including CAN-SPAM. The required postal address and unsubscribe features support that work; they do not establish legal compliance. This is not legal advice. Use truthful sender information and subjects and review the [FTC’s CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business).

## A five-minute start

Install Node 22 or newer. Download this repository and open a terminal in its folder. Run:

```sh
npm ci --cache .test-tmp/npm-cache
npm run demo
```

Open **http://127.0.0.1:4206/login**. The terminal prints the demo password, `demo-bakery-2026`. A yellow DEMO banner stays visible. You will see Juniper Crumb Bakery, a fictional bakery in Tucson, Arizona, with 40 synthetic contacts, retail and wholesale tags, two drafts and one synthetic sent campaign. The list has 32 subscribed contacts, three unconfirmed, three unsubscribed, one bounced and one complained.

Open Campaigns, choose “A cozy Saturday at Juniper Crumb”, and select **Send test to me**. The message is an `.eml` file in `demo-data/outbox/`, viewable in an email app or a text editor. After checking it, send to the 24 subscribed retail contacts. Progress updates as the capture queue runs at the default rate of 20 messages per minute. No message reaches a real mailbox. **Demo always uses CAPTURE, never SMTP**, and refuses any bind other than loopback on port 4206.

Stop with Ctrl+C. Running the demo again keeps your demo edits. To start over, stop it and move `demo-data/` aside, then run the command again. All people, businesses and street addresses are invented; Tucson is real geographic context. `DEMO.md` has a 60-second walkthrough.

## Moving your list from another service

Export the people who agreed to receive your newsletter from your old service, such as Mailchimp, as a CSV. Open **Import contacts** here and choose that file. Include a consent source for each person, or enter a default source such as "Moved from previous newsletter service". Include their original consent dates if you have them.

Choose **They already agreed (e.g. moving from another newsletter service)** to make imported contacts subscribed and ready for campaigns. Tick the consent box only if they agreed to receive email from you. Preview the rows, review the results, then tick the box again to import. Manually adding a contact also requires the box and a source and makes them subscribed.

For an extra confirmation step, choose **Ask them to confirm first**. After importing, click **Send confirmation request**. Those contacts stay unconfirmed until they follow the emailed link and press Confirm subscription. You can return to that import from the Import page to see its per-address results. Requests share campaign rate limits and the daily cap. Pending requests resume automatically; sent, failed and uncertain attempts are never repeated for that person in that import. Links last 24 hours from the send attempt. If one expires, the person can use your public signup page for a fresh link.

Unsubscribed, bounced and complained addresses are never resubscribed by either import choice. Duplicate rows keep the existing contact state, and CSV status columns cannot override it. Each subscribed contact records how they joined (`signup-confirmed`, `import-attested` or `manual-attested`), its source and dates. These records are visible on the contact and included in exports.

## Configuration

For your own list, stop the demo and run:

```sh
npm exec --offline -- newsletter init
npm run set-password
```

The source equivalent is `node bin/newsletter.mjs init`; all commands also work through that entry point. `init` copies the example, generates a random signing secret and creates `newsletter-data/`. It refuses to overwrite an existing config. `set-password` uses a hidden prompt and stores only a salted scrypt hash. For a controlled non-interactive setup, supply `NEWSLETTER_ADMIN_PASSWORD` in the environment; do not put a password on the command line.

Edit the private, gitignored `newsletter.config.json`. Replace the synthetic business name, physical postal address and sender with your own before real sending. Configuration fields:

| Field | Meaning |
| --- | --- |
| `businessName`, `postalAddress` | Required single-line business identity and physical postal address; included in every message footer. |
| `sender` | Your actual mailbox, also the destination for test messages and unsubscribe replies. |
| `logoUrl` | Optional publicly accessible HTTPS image URL. |
| `publicUrl` | Your HTTPS origin, without a path or trailing slash. Confirmation and unsubscribe links use it. Only demo allows local HTTP. |
| `adminOrigin` | Exactly the browser origin used by the owner. Defaults to `http://127.0.0.1:4206`; remote admin must use HTTPS. |
| `host`, `port` | Pinned to `127.0.0.1` and `4206`. No alternate listening port or public bind. |
| `trustProxy` | Default `false`. Set `true` only when a local proxy overwrites `X-Real-IP` with the real client IP. |
| `dataDir` | Default `./newsletter-data`, resolved relative to the config file. Use a private local disk. |
| `secret`, `passwordHash` | Generated signing secret and scrypt password hash. Keep private and back up with the data. |
| `transport` | `capture` by default; set `smtp` explicitly for real delivery. |
| `messagesPerMinute`, `dailyCap` | Default 20 messages per minute and 400 attempts per UTC day. Both are local safeguards, not a statement of provider limits. |
| `smtp.preset` | `google-workspace`, `gmail`, `microsoft-365` or `generic`. |
| `smtp.host`, `smtp.port`, `smtp.secure` | Used by `generic`; named presets supply these values. `secure: true` means TLS from connection start; `false` requires STARTTLS. Certificate verification cannot be disabled. |
| `smtp.user`, `smtp.authType` | Your SMTP mailbox and `password` or `oauth2`. |
| `smtp.passwordEnv`, `smtp.accessTokenEnv` | Names of environment variables containing the app password or OAuth access token. Defaults are `NEWSLETTER_SMTP_PASSWORD` and `NEWSLETTER_SMTP_ACCESS_TOKEN`. Secrets are never returned by Settings. |

Settings lets you change branding and local rate limits. Change mailbox settings, secrets, URLs or paths in the private config and restart. The app does not load `.env` files; set variables in your shell or service manager. Do not commit private config, exports, backups or data. Files use restrictive permissions where the OS supports them; set private Windows folder ACLs yourself.

### Mailbox presets and provider limits

The presets choose connection settings, not permission to send. Your provider may apply daily, rolling, recipient, tenant and anti-abuse limits, including mail sent outside this app. Those rules change. Check your provider’s current limits and terms and set the app lower. A local cap never overrides a provider restriction.

| Preset | Connection | Authentication and limit notes |
| --- | --- | --- |
| Google Workspace | Gmail SMTP, TLS, port 465 | Use an app password only if your organization permits it and the account is eligible, or provide an OAuth access token. Ordinary account passwords may not work. See [Workspace sending limits](https://support.google.com/a/answer/166852) and [sending from an app](https://support.google.com/a/answer/176600). |
| Gmail | Gmail SMTP, TLS, port 465 | App passwords require 2-Step Verification and are unavailable for some accounts; OAuth is another option. Personal Gmail has its own restrictions. See [app passwords](https://support.google.com/mail/answer/185833) and [Gmail sending limits](https://support.google.com/mail/answer/22839). |
| Microsoft 365 | Exchange Online SMTP, STARTTLS, port 587 | SMTP AUTH must be permitted for the mailbox and tenant. Prefer OAuth; password/app-password availability depends on tenant policy and Microsoft’s changing basic-auth retirement rules. See [SMTP AUTH](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission), [OAuth setup](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth) and [Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits). |
| Generic SMTP | Your host, port and TLS setting | Obtain authenticated submission settings and current limits from your provider. Plaintext SMTP is refused. |

OAuth mode accepts a bearer access token obtained outside this app, with the provider’s SMTP permissions. It does not open a sign-in flow or refresh tokens. Provision and refresh the token externally, replace the environment value and restart before it expires. A long send may outlast a token; check failed rows before any new campaign. Nodemailer’s [SMTP OAuth documentation](https://nodemailer.com/smtp/oauth2) explains the transport requirements.

### Set up SPF, DKIM and DMARC on your domain

In your domain’s DNS settings, follow your mailbox provider’s instructions. SPF says which services may send for you. DKIM lets your provider add a signature that receiving mailboxes can check. DMARC tells receivers how to handle messages that fail those identity checks. Use the records your provider gives you; do not paste a generic DNS record from a sample. Check that the visible sender domain is aligned with the provider’s setup, then send a test and inspect its authentication results. This app does not modify DNS or promise inbox placement.

## Run it for real

1. Configure your identity and HTTPS public origin. Keep capture enabled while you check the template and signup flow.
2. Run `node bin/newsletter.mjs doctor`. It checks configuration without contacting SMTP. `doctor --smtp` is an explicit connection and authentication check and sends no message.
3. Set `transport` to `smtp`, provide the chosen credential in the environment, and run `npm start` under your service manager. Open the local admin, sign in, and publish the signup page or copy the embeddable form from Settings.
4. Import contacts with consent evidence, review the row report and choose whether they are already subscribed or should confirm first. Imports never clear suppression or trust a CSV status/confirmed column. Already confirmed contacts keep their state when a duplicate row is skipped.
5. Save a draft, send a test to yourself and check the subject, footer and unsubscribe URL in your mailbox. The successful test enables sending. Editing the draft or changing its branding invalidates that approval.
6. Send to all subscribed contacts or a tag. Keep the process running while sending; pending messages resume after a restart or the next UTC day. Stop gracefully with Ctrl+C before backups, CLI writes or maintenance.

### HTTPS hosting and reverse proxies

Use any HTTPS host or reverse proxy that can reach this process at `127.0.0.1:4206` on the same machine. Set `publicUrl` to its public origin, terminate TLS at the proxy, preserve the original path and method, and forward a Host header matching the configured public origin or the local listener. Do not expose the data directory as static files.

**Publish only** `/signup`, `/confirm/*` and `/u/*`. Allow GET and POST there; do not redirect unsubscribe POSTs to login or require a cookie. Deny every other path on the public hostname, including `/login`, `/contacts`, `/import`, `/imports/*`, `/compose`, `/campaigns`, `/settings` and `/assets/*`. The login form is necessarily reachable without a session on the private admin surface; other admin routes require the signed session. Admin and public routes share a server, so the proxy allowlist is what separates the public surface from the owner’s login page.

Keep admin local or use a private tunnel terminating at local port 4206. If you deliberately expose admin through a separate protected HTTPS origin, set `adminOrigin` to that exact origin. Never rewrite or strip its Origin header. Every admin POST, including login and logout, requires this same-origin header; missing Origin fails closed. Public signed-token actions and the embeddable signup form intentionally do not require Origin because mailbox one-click clients and external websites need them.

For client IP rate limiting behind a proxy, have the proxy **overwrite** `X-Real-IP`, then set `trustProxy: true`. Only a valid IP supplied by a loopback peer is accepted; all other forwarding headers are ignored. Otherwise every proxied visitor shares the proxy’s conservative rate bucket. Add edge rate limits too: public signup is limited to five attempts per IP per hour, a given address cannot trigger another confirmation for 15 minutes, and login is limited to ten attempts per IP per 15 minutes. In-memory IP buckets reset on restart. Cap request bodies at 5 MB at the proxy as well.

Disable access logging for confirmation/unsubscribe token paths or redact the token. Keep the public HTTPS host running so recipients can unsubscribe even when you are not composing a newsletter. Do not publish the demo.

### CLI and CSV

```sh
node bin/newsletter.mjs --help
node bin/newsletter.mjs import customers.csv --consent --source "Shop signup form"
node bin/newsletter.mjs import customers.csv --consent --source "Shop signup form" --apply
node bin/newsletter.mjs export contacts-export.csv
node bin/newsletter.mjs send demo-retail --dry-run --config demo-data/newsletter.config.json
node bin/newsletter.mjs send CAMPAIGN-ID --dry-run
node bin/newsletter.mjs send CAMPAIGN-ID --yes
```

Add `--confirm-first` to both import commands to keep contacts unconfirmed, then open Import in the UI and select the batch to send confirmation requests. Without that option, consent-attested imports become subscribed. The first import command previews; `--apply` commits valid rows and reports every skipped or invalid row. The UI also requires a reviewed preview and a fresh consent checkbox. Stop the server before running data commands: one process owns the data directory at a time. Export refuses to overwrite an existing file. CSV columns are `email,first_name,last_name,tags,consent_source,consent_date`; spaced headers such as `first name` work too. Separate tags with semicolons or use a quoted comma-separated field. Use ISO dates or timestamps. A missing consent date uses the import time; a source is required per row or through the default source option. Quoted commas, doubled quotes, multiline cells, UTF-8 BOMs and CRLF are supported. Spreadsheet formula-leading cells get a protective apostrophe on export.

Dry runs always force the capture transport and create `.eml` files under `dataDir/dry-runs/`; they do not contact SMTP, approve a test, consume the delivery quota or change send journals. Real CLI sending requires the same successful test as the UI. `--config <file>` selects a different config. The demo’s sent history is fabricated for inspection, not evidence of actual delivery.

### Files, throttling and crash recovery

`contacts.json` contains both contact records and the suppression list in one atomic document. Keeping them together prevents a crash between a contact-status update and its suppression update. `campaigns/<id>.json` holds a campaign; `campaigns/<id>.journal.json` holds its frozen content, recipient snapshot and attempt results. `imports/<id>.journal.json` holds confirmation-request attempts; import membership and metadata live in `contacts.json`. `delivery.json` holds the UTC-day attempt count and next permitted attempt time. `outbox/` holds capture messages. Writes use a same-directory temporary file, flush it and rename it; directory metadata is also flushed where the OS supports it. Back up the entire private data directory and config together while the app is stopped. Use a local filesystem, not a shared network drive.

Each SMTP attempt has a durable journal intent **before** it reaches the transport. Successful recipients and failed recipients are not retried automatically. After a crash, an unfinished attempt is marked **uncertain** and skipped; untouched pending recipients resume. A lost connection is also uncertain. SMTP cannot guarantee exactly-once delivery across the gap between provider acceptance and a local disk update. This app chooses no automatic duplicate attempt, at the cost of possibly leaving an uncertain recipient unsent. Check provider records before making a new campaign for those people. Never delete or reset a journal to retry it.

The default three-second interval and daily cap cover campaigns, import confirmation requests, signup confirmations and tests together. Failed and uncertain attempts consume capacity. The cap resets at UTC midnight; provider rolling limits can differ. A server checks paused campaigns and import confirmation requests every 30 seconds. Quota pauses preserve pending recipients. Contact eligibility is checked again after each throttle wait, immediately before the transport call; an unsubscribe cannot recall a message already handed to SMTP. Permanent SMTP 5xx rejections become bounced and suppressed; authentication failures do not mark the recipient bounced. Other failed rows and uncertainty remain visible for the owner.

The per-data-directory process lock prevents concurrent servers or CLI writers. It removes a stale lock only when the recorded process no longer exists. If an OS reuses that process ID or a lock is damaged, first prove that the newsletter process has ended before removing `process.lock.local`. Do not edit the data while a process owns it.

## Security model

There is one password, stored with salted scrypt. Sessions expire after eight hours and use HMAC-signed, HttpOnly, SameSite=Strict cookies; HTTPS admin origins also get Secure. Password changes invalidate old sessions after restart. All admin mutations require an exact Origin match. Public confirmation and unsubscribe tokens are HMAC-signed, include random nonces and are scoped to their action. Confirmation expires after 24 hours; unsubscribe links do not expire while the subscription generation remains current. A fresh completed double opt-in changes that generation, so an old unsubscribe token cannot cancel a new subscription. Tokens are signed, not encrypted; keep them private.

GET on an unsubscribe link only shows a one-button confirmation page. POST suppresses immediately, including the no-cookie `List-Unsubscribe=One-Click` POST used by mailbox providers. Each campaign sets `List-Unsubscribe` with the HTTPS URL and a mailto URI to the sender, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058) also requires an appropriate DKIM signature covering the unsubscribe headers for one-click handling by receivers. Configure/check your provider’s signature; this app does not sign DKIM itself or guarantee that a receiving mailbox displays an unsubscribe button. Monitor and honor unsubscribe replies in your mailbox manually.

Only a new public signup followed by confirmation removes suppression. Deleting a contact keeps suppression. The authenticated owner can mark unsubscribed, bounced or complained; editing, manual additions and imports cannot resubscribe a suppressed address. Complaint status is manual in this release. No raw HTML, contact text or CSV cell is executed. HTML escapes contact data and the Markdown renderer keeps merge values as literal text. Links and images require HTTPS. SMTP uses validated TLS and cannot read arbitrary local attachment paths or fetch remote attachment content.

Private local files are not encrypted. SMTP providers receive the email and its recipient, and optional remote image hosts see image requests. Use images you trust. Do not publish real data or the config. See `SECURITY.md` for the trust boundaries and private reporting policy.

## Development and release checks

```sh
npm ci --cache .test-tmp/npm-cache
npm test
npm run leakscan
npm run consumer
npm run preflight
```

Preflight runs the complete release gate: offline unit tests, content leakscan, and a clean-consumer test. No typecheck, lint or build step exists for this plain JavaScript project. Tests invoke handlers directly and use fake clocks/transports: they bind no ports and make no network calls. The consumer test copies only files Git tracks or would track before the first commit into `.test-tmp/`, runs `npm ci --offline` against the populated local cache, exercises the `newsletter` bin, initializes config, seeds the demo and checks a capture-only dry run. Prime that cache with the initial install command above. No SMTP connectivity test is part of preflight.

Apache-2.0. Copyright 2026 Mark Pickering and PICKBITS LLC. Full terms are in `LICENSE`; attribution is in `NOTICE`.

Questions and bugs: open a GitHub issue.
