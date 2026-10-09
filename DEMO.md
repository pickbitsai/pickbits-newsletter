# A 60-second walkthrough

With Node 22 or newer, run these commands from the project folder:

```sh
npm ci --cache .test-tmp/npm-cache
npm run demo
```

Open `http://127.0.0.1:4206/login`. Use the password printed in the terminal: `demo-bakery-2026`. No account or SMTP credentials are needed. Every outgoing message stays in `demo-data/outbox/` as an `.eml` file. The demo banner explicitly says SMTP is disabled.

| Time | Show |
| --- | --- |
| 0–10 seconds | Sign in. Show the yellow DEMO banner and the 40 synthetic contacts for Juniper Crumb Bakery in Tucson, Arizona. |
| 10–20 seconds | Search `wholesale`. Point out the status badges and explain that suppressed and unconfirmed contacts do not receive campaigns. |
| 20–35 seconds | Open Campaigns, select the retail draft, then Edit draft. Change a sentence and watch the preview. Point to `{{first_name|there}}` and the footer with a synthetic physical address and unsubscribe link. Save the draft. |
| 35–45 seconds | Select Send test to me. Open the newest `.eml` in `demo-data/outbox/` with an email app or text editor. Show the plain-text and HTML parts and the one-click headers. No mail was sent externally. |
| 45–55 seconds | Select Send to subscribed audience. Show the live counts increasing. The 24 retail recipients take about 72 seconds at the default rate, so the queue continues beyond the walkthrough. |
| 55–60 seconds | Open Settings and show the copyable signup form. Explain that the owner keeps the files and that real delivery uses their own provider. |

The sent September campaign is fabricated history. All people, the business and street locations are synthetic; Tucson is real geographic context. No real contact or customer data belongs in a recording.

To show opt-in, open the public `/signup` page, submit a reserved example-domain address and open its captured confirmation message. GET displays a button; POST confirms. To show unsubscribe, use a URL from one of the campaign captures: the GET page is harmless, and the button or one-click POST suppresses the contact immediately. A new signup and confirmation are required to resubscribe.

Stop with Ctrl+C. Nothing needs to remain running. Rerunning the demo keeps edits; move `demo-data/` aside while stopped to seed a fresh demonstration. A port conflict fails rather than choosing another port.
