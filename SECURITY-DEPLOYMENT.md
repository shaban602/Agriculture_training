# Production Setup

## Before deployment

1. Rotate any database credential that has been shared or committed. Create a dedicated MySQL application user with access only to this database; do not deploy with the MySQL root account.
2. Apply `backend/migrations/20261023_autogenerate_ids_and_order_records.sql` and `backend/migrations/20261023_add_users.sql` to the production database.
3. Copy `backend/.env.example` to `backend/.env`. Fill in the production database values, set `NODE_ENV=production`, and set a strong `SESSION_SECRET`. Generate one locally with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Create the first admin in an interactive terminal after the migrations are applied:

   ```powershell
   cd backend
   npm run user:create
   ```

   Password input is hidden. Create trainer and partner accounts with the same command and select their roles as needed.

## HTTPS and frontend API

Point a DNS A/AAAA record for your domain at the hosting server and allow inbound TCP ports 80 and 443. Install Caddy on that server, copy `deployment/Caddyfile.example` to its Caddy configuration, replace the domain and frontend `dist` directory with the server's paths, then start/reload Caddy. Caddy obtains and renews the TLS certificate automatically when DNS and ports are correct.

Build the frontend with `VITE_API_URL=/api` (the default). Caddy serves the frontend and proxies `/api/*` to the backend, so the browser uses the same HTTPS origin. Set `APP_ORIGIN` and `CORS_ORIGINS` to the exact public origin, for example `https://training.example.com`. Keep `COOKIE_SAME_SITE=lax` for this same-origin setup. Run the backend behind Caddy, not directly on a public port.

This repository cannot obtain a public certificate on its own: a real domain and reachable hosting server are required. Do not set `NODE_ENV=production` for plain HTTP local development because production cookies are marked Secure.

## Database backups

Run the backup command on the backend host:

```powershell
cd backend
npm run backup
```

Backups are written to `backend/backups` by default and dumps older than 30 days are pruned. Set `BACKUP_DIR` and `BACKUP_RETENTION_DAYS` in the backend environment to change these settings. The generated SQL contains farmer and account data: restrict filesystem access, encrypt the disk/storage, and copy backups to a separate encrypted location. Regularly test restoring a backup into a non-production database.

## Access roles

- `admin`: full access; only admins may edit or delete records.
- `trainer`: read training data and create farmer, event, attendance, and product-adoption records.
- `partner`: read training events and product-adoption records.

User passwords are stored as salted scrypt hashes. Sessions are signed, HttpOnly cookies, expire after eight hours, and require the configured origin for state-changing browser requests.