# Deploying GLOBAL SJX OS on cPanel (exact steps)

Layout: **API** on `https://api.globalsjxltd.com` (cPanel "Setup Node.js App"), **web app** on `https://os.globalsjxltd.com` (static files), **database** on MongoDB Atlas (cPanel has no MongoDB). Replace the domains with yours.

Requirements: your host must offer **Setup Node.js App** (CloudLinux / Passenger) with **Node 20.19 or newer (22 is best)**. If the Node selector tops out below 20.19, ask the host to enable it, or use a small VPS instead. SSH is helpful but not required.

## 1. Database (MongoDB Atlas, free tier is fine to start)
1. Create an account at mongodb.com/atlas → create a **free cluster**, region London (or nearest to your host).
2. Database Access → add a user `gsjx_app` with a long password and role **readWriteAnyDatabase**.
3. Network Access → add your cPanel server's outgoing IP (cPanel home → "Server Information" / ask the host; the address shown as "Shared IP"). If the host can't give a stable one, use `0.0.0.0/0` temporarily; the database password and TLS still protect it, but tighten it later.
4. Connect → Drivers → copy the string and make it: `mongodb+srv://gsjx_app:PASSWORD@cluster0.xxxxx.mongodb.net/gsjx_os_prod?retryWrites=true&w=majority`. Special characters in the password must be URL-encoded. The database name must not contain "dev", "test" or "staging" or the API refuses to start.
5. For real use move to a paid tier (M10) with automatic backups. The free tier has **no backups**.

## 2. Create the subdomains and certificates
cPanel → **Domains** (or Subdomains): create `api.globalsjxltd.com` and `os.globalsjxltd.com`. Then **SSL/TLS Status → Run AutoSSL** until both show a padlock.

## 3. Build the two upload packages on your own computer
You need Node 20.19+ and `zip`. From the project root:
```
API_URL=https://api.globalsjxltd.com ./deploy/pack-for-cpanel.sh
```
This produces `deploy/out/backend-upload.zip` (compiled API + package files) and `deploy/out/frontend-upload.zip` (the web app with your API address built in, plus `.htaccess`). If you change the API address later you must rebuild the frontend.

## 4. Generate your secrets (once)
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Run it twice: one value for `JWT_SECRET`, one for `DATA_ENCRYPTION_KEY`. **Save `DATA_ENCRYPTION_KEY` in your password manager. If it is lost, encrypted bank/payment details cannot be recovered.**

## 5. Upload and start the API
1. cPanel → **File Manager** → in your home folder (not public_html) create `gsjx-api`. Upload `backend-upload.zip` there and **Extract**. You should see `dist/`, `package.json`, `package-lock.json`.
2. cPanel → **Setup Node.js App** → **Create Application**:
   - Node.js version: 22 (or 20.19+)
   - Application mode: **Production**
   - Application root: `gsjx-api`
   - Application URL: `api.globalsjxltd.com`
   - Application startup file: `dist/server.js`
3. In the same screen add **Environment variables** from `backend/.env.production.example` (APP_ENV, NODE_ENV, MONGO_URI, JWT_SECRET, DATA_ENCRYPTION_KEY, CLIENT_ORIGIN, APP_URL, PUBLIC_API_URL, SMTP_*, ALLOW_SEED=false). Click **Save**.
4. Click **Run NPM Install** (installs production dependencies; wait for it to finish).
5. Click **Restart**. Open `https://api.globalsjxltd.com/health`. You should see a JSON "ok". If the page shows an error, open `gsjx-api/stderr.log` (or the Passenger log shown on that screen): the API prints exactly which setting is wrong ("Refusing to start: ...").

## 6. Upload the web app
1. File Manager → open the document root of `os.globalsjxltd.com` (usually `public_html/os` or the folder you chose in step 2). Delete the placeholder files.
2. Upload `frontend-upload.zip` there and **Extract**. Turn on **Settings → Show Hidden Files** and confirm `.htaccess` is present (it makes links such as `/sign/<token>` and `/book-visit` work when opened directly).
3. Open `https://os.globalsjxltd.com`. The login page should load. Logging in will fail until step 7.

## 7. Create the company and the first administrator
The old `npm run seed` wipes data and refuses production; use `bootstrap` instead. It never deletes anything and is safe to re-run.

On your computer, in `backend/`, with the **production** connection string:
```
cd backend
npm ci
MONGO_URI="mongodb+srv://gsjx_app:PASSWORD@cluster0.xxxxx.mongodb.net/gsjx_os_prod?retryWrites=true&w=majority" \
APP_ENV=production JWT_SECRET=x DATA_ENCRYPTION_KEY=x \
BOOTSTRAP_ADMIN_EMAIL=you@globalsjxltd.com BOOTSTRAP_ADMIN_NAME="Joe" \
BOOTSTRAP_ADMIN_PASSWORD='A-long-Passw0rd-here' npm run bootstrap
```
(`JWT_SECRET` / `DATA_ENCRYPTION_KEY` are only needed so the config loads; the script does not use them. Windows: set the variables with `$env:NAME="..."` in PowerShell first.) Log in at the web app; you are forced to change the password on first login.

## 8. Load your ISMS folder (assets, policies, registers)
Run from your computer so the 230 MB folder is never uploaded. Unzip the folder first, then:
```
cd backend
MONGO_URI="<same production string>" APP_ENV=production JWT_SECRET=x DATA_ENCRYPTION_KEY=x \
npm run import:folder -- "/path/to/Global SJX ISO-27001 Client Folder" --dry-run
```
Read the report, then run it again without `--dry-run`. Options: `--only=registers,assets,vendors,policies` and `--publish` (default: policies arrive as **drafts** for you to review and approve). It is safe to repeat; anything already loaded is skipped.

Afterwards use **Import data** in the app (Security & Compliance) for later spreadsheets and Word policies, with a preview before anything is saved.

## 9. Keep scheduled jobs alive
Reminders and automation rules run inside the API process. On shared hosting the process can be stopped when idle, so add a heartbeat: cPanel → **Cron Jobs** → every 5 minutes:
```
*/5 * * * * curl -fsS https://api.globalsjxltd.com/health > /dev/null
```
This helps but cannot guarantee the process never restarts; rules are idempotent, so a missed run is caught up on the next one. A VPS or the Docker setup in `docker-compose.prod.yml` is more reliable if the jobs are critical.

## 10. After go-live checklist
- Atlas: enable backups (paid tier) or schedule `mongodump` to somewhere safe.
- Back up `gsjx-api/uploads/` (evidence files, signatures PDFs) with cPanel Backup; it lives on the server disk. **A redeploy must not delete this folder** (upload only `dist/`, `package*.json`).
- Send a test e-mail (invite a user) to confirm SMTP; check spam placement and set SPF/DKIM in cPanel → Email Deliverability.
- Remove `0.0.0.0/0` from Atlas once the server IP is known.
- Updating later: upload the new `backend-upload.zip` over `gsjx-api`, **Run NPM Install** if `package.json` changed, **Restart**. Replace the frontend files for web changes.

## Troubleshooting
| Symptom | Fix |
|---|---|
| 503 / "Incomplete response" on API | Wrong startup file or crash. Check stderr.log; startup file must be `dist/server.js` |
| "Refusing to start: JWT_SECRET..." | Secret under 32 chars or missing |
| CORS error in the browser | `CLIENT_ORIGIN` must exactly equal the web address (https, no slash) |
| Login page loads, logging in fails | Frontend was built with the wrong `API_URL`; rebuild and re-upload |
| `MongooseServerSelectionError` | Atlas IP allow-list or wrong password encoding |
| Refresh on `/sign/...` gives 404 | `.htaccess` missing in the web folder |
