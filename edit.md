# Pull Request: Account Passwords, Self-Service Web Portal, Security Remediation & Admin Controls

## Short Summary
Adds secure asynchronous scrypt password authentication, a self-service player web portal (`/register`), time-limited single-use Password Reset Links (`/reset-password`), dynamic admin settings toggles with modern UI switches, an account takeover prevention system, in-memory IP rate limiting with loopback exemption, an in-window modal password management dialog replacing native browser prompts, interactive hover-to-delete IP chips, and a "Trusted Hosting IPs" whitelist in the Settings tab for dedicated server account bypass rules (`CoreServer{n}`).

---

## PR Review Feedback & Security Remediation

Following PR review feedback, this update resolves the critical security findings and architectural requirements:

1. **Account Takeover Vulnerability Resolved (`src/services/portal/routes.js`):**
   - Previously, `POST /api/change-password` bypassed the current password check on accounts without a password (`!account.password`), allowing unauthenticated attackers to claim any legacy account.
   - **Fix:** Unauthenticated takeover attempts on passwordless accounts are now strictly refused with `401 Unauthorized` (`errors.com.epicgames.account.authentication_failed`).
   - Claiming a password on a passwordless account now requires **proof of ownership**: either a valid authenticated launcher session (Bearer token in header or body matching account ID) or an admin-generated **Password Reset Link**.
   - Accounts with an existing password continue to strictly verify `currentPassword`.

2. **Non-Blocking Asynchronous Crypto (`src/accounts/password.js`):**
   - Replaced blocking `crypto.scryptSync` with native Promise-wrapped `crypto.scrypt` (16-byte random salt, 64-byte key).
   - Authentication, registration, and password changes no longer block the Node.js event loop, preventing backend hangs during concurrent bursts.

3. **In-Memory Rate Limiting with Loopback Exemption (`src/services/portal/ratelimit.js`):**
   - Zero-dependency sliding window rate limiter protects sensitive endpoints:
     - `/api/register`: 10 attempts / 15 minutes.
     - `/api/change-password` & `/api/reset-password`: 10 attempts / 15 minutes.
     - `/api/check-username`: 30 queries / minute (prevents username enumeration).
     - OAuth failed password tracking: 5 failed attempts / 5 minutes blocks IP with `429 Throttled`.
   - **Loopback Exemption:** All loopback addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) are completely exempt from rate limiting, ensuring local admin workflows, gameservers, and automated unit tests are never throttled.

4. **Standardized Password Policy & Uniform Trimming:**
   - Enforced standard **8 to 128 character passwords** (`MIN_PASSWORD_LENGTH = 8`) consistently across validation rules, web portal forms, password reset views, and OAuth auto-registration.
   - Enforced uniform trimming (`.trim()`) across all inputs prior to validation, hashing, verification, and OAuth authentication.

5. **Partial Retirement of Passwordless Accounts & Admin Management:**
   - When password protection is enabled (`requirePassword: true`), legacy accounts without passwords cannot log in via the launcher (`400 This account does not have a password configured and is admin-managed. Please request a Password Reset Link from your host.`).
   - In-game auto-creation without credentials is fully retired; players register via the web portal at `/register` (linked directly from a button in the Core Launcher).
   - An advanced toggle remains in the Admin Panel for hosts who wish to test offline solo play.

6. **Password Reset Link Generation (`src/accounts/reset-tokens.js`, `src/admin/routes.js`):**
   - Admins can generate a secure single-use Password Reset Link directly from the player account card in the Admin Panel (`POST /admin/api/accounts/:id/password-reset-link`).
   - Generates a crypto-random hex token with a 24-hour expiration that resolves to the host's public IP (`http://<public-ip>:<port>/reset-password?token=<token>`).
   - The web portal features a dedicated Reset Password view (`/reset-password`) that validates tokens in real-time (`/api/reset-password/validate`) and securely applies the new password.

7. **Trusted Hosting IPs in Settings Tab (`src/settings/store.js`, `src/admin/routes.js`, `src/services/account/oauth.js`):**
   - Server accounts (`CoreServer{n}`) bypass password checks for headless matchmaking, but are restricted to verified sources: loopback, `DedicatedServer` client credentials, or the Admin Panel's **Allowed Hosting IPs** list in the **Settings** tab.
   - Endpoints are supported on both `/admin/api/settings/hosting-ips` and `/admin/api/sessions/hosting-ips` for seamless backward compatibility.
   - Unauthorized external IP addresses attempting to log in as server accounts are rejected with `403 Forbidden`.

8. **Admin Panel UI Enhancements & In-Window Dialogs (`src/admin/panel.html`, `src/admin/local.js`):**
   - **In-Window Password Modal (`openPasswordModal`):** Replaced the native browser `prompt()` dialog with a custom modal popup inside the window. Features password visibility toggle (show/hide), live client-side validation (8+ characters required), session invalidation notices, loading states, and full keyboard navigation (`Enter` to submit, `Escape` to close).
   - **Modern Removable Chips (`.chip.removable`):** Hosting IP chips in the Settings tab now display clean sky pills without underlines or static red text. Hovering smoothly shifts the pill to a red warning state and reveals the "x" remove button.
   - **Local Panel Request Guard (`requirePanelRequest`):** Allowed body-less `DELETE` HTTP requests without triggering `415 Unsupported Media Type`, ensuring standard REST operations on settings work seamlessly.

---

## Files Changed

| File | Status | Description |
|------|--------|-------------|
| `src/accounts/password.js` | Modified | Async `crypto.scrypt` hashing & timing-safe verification, 8+ char rule, input trimming, and loopback address detection |
| `src/accounts/reset-tokens.js` | **New** | In-memory store for single-use, 24-hour TTL password reset tokens with automatic expiry cleanup |
| `src/accounts/store.js` | Modified | Async password hashing and update methods with atomic account persistence |
| `src/admin/local.js` | Modified | Permitted body-less `DELETE` requests in `requirePanelRequest` without requiring JSON content-type |
| `src/admin/panel.html` | Modified | Added in-window modal password popup, interactive hover-to-delete hosting IP chips, moved Trusted Hosting IPs to Settings tab, and added "Create Reset Link" |
| `src/admin/routes.js` | Modified | Reset link generation endpoint, async password reset, and hosting IP management routes |
| `src/app.js` | Modified | Injected reset token store into application context and routes |
| `src/services/account/oauth.js` | Modified | Async password authentication, failure tracking, dedicated server hosting IP verification, and legacy account checks |
| `src/services/portal/portal.html` | Modified | Responsive player portal supporting `/register`, `/portal`, and `/reset-password?token=...` with live validation |
| `src/services/portal/ratelimit.js` | **New** | In-memory sliding window rate limiter and OAuth failure tracker with loopback bypass |
| `src/services/portal/routes.js` | Modified | Express API routes for registration, takeover-protected password changes, token reset endpoints, and rate limits |
| `src/settings/store.js` | Modified | Settings persistence supporting `requirePassword`, `allowRegistration`, `allowAutoRegistration`, and `allowedHostingIps` |
| `tests/password-auth.test.js` | **New** | 7 comprehensive test suites validating hashing, validation, takeover prevention, reset links, settings, and hosting IPs |

---

## Verification & Testing

The entire backend automated test suite passes with 100% success rate:

```bash
# Run security and password auth test suite
node --test tests/password-auth.test.js

# Run full project test suite
node --test
```

### Full Test Suite Results:
```text
PASS password hashing and timing-safe verification
PASS username and password validation rules
PASS player web portal and registration API
PASS account takeover prevention: passwordless accounts require proof of ownership
PASS password reset links: admin generation, validation, and single-use consumption
PASS admin settings API, password requirement, and loopback rate limit exemption
PASS dedicated server accounts, passwordless login, and hosting IP whitelist
... [284 core test suites] ...
tests 291
suites 0
pass 291
fail 0
cancelled 0
skipped 0
todo 0
```
