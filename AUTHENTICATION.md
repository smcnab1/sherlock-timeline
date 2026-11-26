# Administrator access

Sherlock is a single-operator workspace. A successful sign-in grants access to all cases and the shared people directory. Use a separate installation and database when operators need separate access.

For a local demo, run `node scripts/init-local.mjs` after installing dependencies. It prompts for a local sign-in password with input hidden and writes a private `.env`. The file contains a cost-12 bcrypt hash and a random 32-byte session signing secret.

For a hosted installation, configure `ADMIN_PASSWORD_HASH` and `SESSION_SECRET` as server-only values through the hosting provider. Paste the literal bcrypt hash into the provider's secret field. The backslashes in a generated local dotenv file are specific to dotenv expansion.

The signed session expires after seven days. The cookie is HttpOnly, uses SameSite=Lax and requires HTTPS in production. Logout clears the current browser cookie. Rotate the signing secret to invalidate every outstanding session. Pair the application login limiter with an ingress rate limit on a multi-instance deployment.
