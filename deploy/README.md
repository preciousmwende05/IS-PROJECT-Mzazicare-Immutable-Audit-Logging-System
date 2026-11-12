# Deploying MzaziCare to production

```
  Users ──HTTPS──▶ Vercel (frontend)            app.<domain> / *.vercel.app
     │
     └──HTTPS──▶ Azure server (Ubuntu) ── Caddy ──┬─▶ api      api.<domain>
                                                  ├─▶ rustfs   files.<domain>
                                                  └─  redis    (internal only)
                         api ──▶ MongoDB Atlas (managed database)
                         cron ─▶ nightly backup, hourly ML alerts
```

Time: about a day, most of it creating accounts. Do the steps in order.

---

## 0. Before you start

- [x] **Proxy setting (done).** The API trusts one proxy hop in production (`TRUST_PROXY`, default 1
      when `NODE_ENV=production`), so the login rate limit and the audit log see each user's real
      address behind Caddy. Only change it if you add another proxy in front (e.g. Cloudflare: `2`).
- [ ] Decide your domain. Free option: a `.me` domain from Namecheap via the GitHub Student Pack.
      You need two names pointing at the server: `api.<domain>` and `files.<domain>`.
- [ ] Copy the trained model folder somewhere you can upload from:
      `ml/audit-anomaly/runs/20261105-025753_113141a_sim-v3-role-relative/` (not in git).

## 1. Accounts

| Service | What for | Notes |
|---|---|---|
| Azure for Students (azure.microsoft.com/free/students) | the server | no card; ~US$100 credit/year |
| MongoDB Atlas (mongodb.com/atlas) | database | free M0 cluster |
| Vercel (vercel.com) | frontend | sign in with GitHub |
| Gmail (app password) | sign-up verification codes by email | free; the account you already set up |
| UptimeRobot (uptimerobot.com) | "site is down" emails | free |

## 2. Database: MongoDB Atlas

1. Create a **free M0** cluster. Region: the one closest to Kenya that is offered (e.g. Cape Town, else Europe).
2. **Database Access** → add a user with a long random password (letters and digits only, so it needs no escaping in the URI).
3. **Network Access** → add your server's public IP (after step 3). Do **not** use `0.0.0.0/0`.
4. **Connect → Drivers** → copy the `mongodb+srv://…` string; you'll put it in `.env` as `MONGODB_URI` with `/mzazicare` as the database name.

> The free tier has no restorable automatic backups. `scripts/backup.sh` covers that (step 7).

## 3. Server: Azure

1. Portal → **Virtual machines → Create**.
   - Region **South Africa North**, image **Ubuntu Server 24.04 LTS**, size **B1ms** (1 vCPU, 2 GB).
   - Authentication: **SSH public key** (download the key; keep it safe).
   - Inbound ports: **SSH (22), HTTP (80), HTTPS (443)**.
2. After it starts, copy its **public IP** and make it **static** (IP address → Configuration → Static).
3. Add the IP to Atlas Network Access (step 2.3).
4. At your domain's DNS, create two **A records** to that IP: `api` and `files`.
5. Connect: `ssh -i your-key.pem azureuser@<ip>`

## 4. Install and configure

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/scripts/setup-server.sh -o setup.sh
sudo bash setup.sh https://github.com/<you>/<repo>.git
exit   # log out and back in so Docker works without sudo
```

If the repository is private, clone with a GitHub fine-grained token, or make a read-only
deploy key, instead of the plain URL.

From your own computer, upload the trained model:

```bash
scp -i your-key.pem -r ml/audit-anomaly/runs/20261105-025753_113141a_sim-v3-role-relative azureuser@<ip>:/opt/mzazicare/ml/audit-anomaly/runs/
```

On the server:

```bash
cd /opt/mzazicare/deploy
cp .env.example .env
nano .env
```

Fill in every `CHANGE_ME`. Generate each secret with `openssl rand -base64 48`.
**Use new secrets, never the development ones.** Save `AUDIT_HMAC_SECRET` in a password
manager: without it the audit chain can never be verified again.

## 5. Go live

```bash
bash scripts/deploy.sh
```

It refuses to run while any `CHANGE_ME` remains, builds the production image, starts
everything, and waits until `https://api.<domain>/v1/health` answers. Caddy fetches the HTTPS
certificates by itself on first start (DNS from step 3.4 must already point at the server).

## 6. Frontend: Vercel

1. **Add New → Project** → import the GitHub repository.
2. **Root Directory:** `Mzazicare-frontend` (Vercel reads `vercel.json` there).
3. **Environment variable:** `VITE_API_URL` = `https://api.<domain>/v1`.
4. Deploy. Put the Vercel address (and your custom domain, if you add one) in `ALLOWED_ORIGINS`
   in the server's `.env`, then run `bash scripts/deploy.sh` again.

Every push to `main` now redeploys the frontend. To update the backend: push, then run
`bash scripts/deploy.sh` on the server.

## 7. First admin, catalog, scheduled jobs

1. Open the frontend, **register** with your own phone and email, and enter the emailed code.
   (Not arriving? Check `docker compose -f docker-compose.prod.yml logs api | grep -i email`.)
2. Make that account the first admin:
   ```bash
   bash scripts/make-admin.sh +2547XXXXXXXX
   ```
3. Publish the starting care services (prices in `scripts/seed-catalog.mjs`, check them first):
   ```bash
   bash scripts/seed-catalog.sh +2547XXXXXXXX
   ```
4. Turn on the nightly backup and hourly ML alerts:
   ```bash
   crontab /opt/mzazicare/deploy/crontab.txt
   bash scripts/backup.sh      # run once now to check it works
   bash scripts/ml-alert.sh    # likewise
   ```
5. **UptimeRobot:** add an HTTPS monitor for `https://api.<domain>/v1/health` (every 5 minutes).

## 8. Final checks

- [ ] Register → verify → sign in works from a phone on mobile data
- [ ] Add an elder, request a visit, see the notification
- [ ] Audit log page: chain **Verified**, last check within 30 minutes
- [ ] `https://api.<domain>/v1/health` shows `"status":"ok"`; `http://` redirects to `https://`
- [ ] No test accounts, seeded audit entries or test caregiver profiles were copied over

## Everyday operations

| Task | Command (in `/opt/mzazicare/deploy`) |
|---|---|
| Update after a push | `bash scripts/deploy.sh` |
| See API logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Restart everything | `docker compose -f docker-compose.prod.yml restart` |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Backup now | `bash scripts/backup.sh` |
| Restore database | printed at the end of every backup |

### Off-server copies

Backups in `/opt/mzazicare/backups` are lost if the server is. At least weekly, copy them off:

```bash
scp -i your-key.pem -r azureuser@<ip>:/opt/mzazicare/backups ./mzazicare-backups
```

(or sync them to Cloudflare R2 / OneDrive with `rclone`).

## Data protection (Kenya)

MzaziCare processes health data (care plans, vitals). Before real users:
register with the **Office of the Data Protection Commissioner (ODPC)** as a data controller,
publish a privacy notice users see before registering, and document that hosting in South
Africa (Azure, Atlas) is a cross-border transfer with appropriate safeguards.

## Costs

Free while student credit lasts (verification codes go by Gmail, which is free).
After the credit: about US$15/month (server) + US$9/month if you outgrow Atlas's 512 MB.
