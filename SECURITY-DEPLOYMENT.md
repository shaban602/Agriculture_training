# Production Setup

## Deploying to Vercel

Import this repository into Vercel with the repository root as the project root. The root `vercel.json` builds the Vite frontend, and `api/[...path].js` routes `/api/*` requests through the Express backend.

Vercel hosts the app code, not this project's MySQL database. Before deployment, provision a production MySQL database reachable from Vercel and apply both SQL migrations. Create an admin account by running `npm run user:create` from the `backend` directory in a secure terminal configured for that production database. Do not use the local database or local `.env` file as production configuration.

Add these environment variables in the Vercel project settings for Production:

- `NODE_ENV=production`
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for the production database
- `DB_SSL=true` when the database provider requires TLS, including TiDB Cloud Starter
- `SESSION_SECRET` generated with the command below
- `APP_ORIGIN` and `CORS_ORIGINS` set to the exact public origin when using a custom domain. Vercel's deployment and production URLs are also allowed automatically.
- `COOKIE_SAME_SITE=lax`

Redeploy after setting or changing environment variables. Keep the database credentials and session secret only in Vercel's encrypted environment-variable settings; never commit them.

The database must allow secure connections from Vercel's serverless functions. Use a provider and connection settings that meet your database's TLS and network-access requirements. Test the health endpoint at `/api/health`, then sign in with the admin account created for the production database.

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