# Environments

| | Development | Test / CI | Staging | Production |
|---|---|---|---|---|
| `APP_ENV` | development | test | staging | production |
| Database | `gsjx_os_dev` (synthetic) | in-memory / ephemeral | `gsjx_os_staging` (synthetic) | `gsjx_os_prod` |
| Secrets | throw-away dev values | CI secrets | unique, 32+ chars | unique, 32+ chars, in a secrets manager |
| Origins | localhost | n/a | staging domain(s) | production domain(s) only |
| Seed script | allowed | allowed | needs `ALLOW_SEED=true` | **refused** |
| Real customer data | never | never | never | yes |
| Network | local | runner | isolated VPC / compose network | isolated; DB not exposed publicly |

Start-up guards (`backend/src/config/env.ts`): in staging/production the API exits unless `JWT_SECRET` is strong, `CLIENT_ORIGIN` is explicit and non-localhost, `MONGO_URI` is set and its database name matches the environment.

**Run locally:** `docker compose up --build` then `docker compose exec backend node dist/seed/seed.js` (uses `ALLOW_SEED`).
**Production-like:** copy `.env.prod.example` values into `.env.prod`, then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`. Put a TLS-terminating reverse proxy (HSTS) in front of the `frontend` and `backend` services.

**Backups:** `mongodump --uri "$MONGO_URI" --archive=backup.gz --gzip` daily to encrypted storage; test a restore quarterly (`mongorestore --archive=backup.gz --gzip --drop` into a scratch database).
