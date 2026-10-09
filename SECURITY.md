# Security policy

## Reporting

Report vulnerabilities privately through GitHub private vulnerability reporting on the repository where you obtained this project. If it is unavailable, open a minimal issue requesting a private reporting channel without sensitive details. Include the affected version, Node version, operating system, a synthetic reproduction, expected behavior and observed behavior. Never include real contacts, message content, credentials, tokens or private configuration. Version 0.1.x on the default branch is supported.

## Trust boundaries

The owner controls the config and data directory. Protect both with operating-system permissions and private backups. Files are not encrypted. Local administrators and anyone holding the signing secret can access or impersonate this application. Do not run multiple processes against the same directory or use shared/network storage. The exclusive process lock is a coordination safeguard, not a defense against someone with local filesystem access.

All HTTP requests, contact fields, CSV cells and Markdown are untrusted. Raw HTML is escaped; merge values become text rather than markup or links. URL rendering allows HTTPS only. The app has no shell execution path for submitted content. CSV exports prefix formula-leading values. Never treat imported status fields as subscription authority.

The only anonymous application functions are signup, signed confirmation, signed unsubscribe and the necessary private-surface login form. All other routes require an eight-hour signed session. Passwords use salted scrypt. Cookies are HttpOnly and SameSite=Strict, with Secure for an HTTPS admin origin. Every admin POST, including login, requires the configured Origin. A password change invalidates sessions after restart.

Public form POSTs intentionally bypass admin Origin checks. Signup needs a consent checkbox and is limited by IP and address cooldown; it includes a honeypot. Confirmation needs a signed, expiring, pending-signup token. Unsubscribe needs its signed capability token and no login, cookie or Origin. GET is inert; POST acts. Confirmation and unsubscribe are idempotent within their subscription generation. A new double opt-in is required to remove suppression.

## Deployment

The server only binds loopback on port 4206. The HTTPS reverse proxy must publish only `/signup`, `/confirm/*` and `/u/*`; deny everything else on the public hostname. Keep the login and admin private. Never publish the data directory or use a static-file rule that can reach config, journals or outboxes. The demo must stay local and uses capture only.

Origin checks use `adminOrigin`, not forwarded headers. IP limiting uses the socket peer by default. Set `trustProxy` only when a trusted loopback proxy overwrites `X-Real-IP` with a validated client IP; otherwise leave it false and apply rate limits at the proxy. The app ignores other forwarding headers. IP counters live in memory and reset on restart; there is no distributed denial-of-service protection.

Keep access tokens out of proxy logs. HMAC tokens are signed, not encrypted, and disclose their payload if decoded. Confirmation tokens expire; unsubscribe tokens remain valid for the current subscription. Keep the signing secret stable so old unsubscribe links keep working. Rotate it after suspected compromise, understanding that previously issued links and sessions will stop working.

## Delivery and privacy

SMTP requires TLS with certificate verification and uses credentials from named environment variables. The app does not load `.env` files or manage OAuth refresh. The chosen provider sees the recipient and content and controls retention and sending policy. Remote images may reveal an image request to their host. The product includes no tracking pixels, click redirector, analytics or telemetry. Raw SMTP error replies are not saved or returned to the browser.

Capture serializes email locally and never opens an SMTP connection. Dry runs also force capture. Automated tests use capture or fake transports and do not bind ports or access the network. The optional `doctor --smtp` command is the only diagnostic that connects to the configured provider.

Crash recovery favors avoiding duplicate attempts: a durable in-flight entry becomes uncertain after restart and is never retried automatically. This can leave an unsent recipient. SMTP acceptance does not prove delivery, and no journal can make SMTP exactly once. Stop the app before backing up or editing files. Do not reset a journal to retry an uncertain message.
