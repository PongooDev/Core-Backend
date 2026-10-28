# Password Requirement Detection for Launcher

The backend now reports whether a password is required before the client launches, either globally or for a specific account.

---

## Endpoints

### 1. `GET /core/api/status?username=<displayName>`
*(or `GET /core/api/auth-requirements?username=<displayName>`)*

Returns the authentication requirements for the specified player:

```json
{
  "name": "Core-Backend",
  "version": "1.0.0",
  "requirePassword": false,
  "passwordRequired": true,
  "accountExists": true,
  "hasPassword": true
}
```

- **`requirePassword`**: Server-wide setting (`true` / `false`).
- **`passwordRequired`**: `true` if the account has a password set OR the server enforces passwords.
- **`accountExists`**: Whether the username exists.
- **`hasPassword`**: Whether this account has a configured password.

---

## Launcher Behavior

| Server Setting | Account Status | `passwordRequired` | Launcher Action |
| :--- | :--- | :---: | :--- |
| **`requirePassword: true`** | Any account | `true` | Show password field and require input. |
| **`requirePassword: false`** | Account has password | `true` | Show password field and require input. |
| **`requirePassword: false`** | Passwordless account | `false` | Password optional (auto-fallback to `Core`). |

---

## Backward Compatibility
- Plain `GET /core/api/status` without query parameters continues to return only `{ "name": "Core-Backend", "version": "..." }`, preserving legacy client and friend status checks.
- All 293 backend tests are passing (`node --test`).
