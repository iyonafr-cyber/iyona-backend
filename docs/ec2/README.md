# Iyona backend on EC2

Instance: `i-0d97189370f8c7770` in `eu-west-3c`. App dir: `~/iyona-backend`.

## SSH

From this directory:

```bash
./ssh
```

Equivalent (Elastic IP `51.44.129.116`):

```bash
ssh -i iyona-pem.pem ubuntu@ec2-51-44-129-116.eu-west-3.compute.amazonaws.com
```

### Elastic IP

Allocated and associated: **`51.44.129.116`** (`eipalloc-00e61cabac7b83b59`). SSH and GitHub Actions fallback host are updated to `ec2-51-44-129-116.eu-west-3.compute.amazonaws.com`.

## HTTPS — `api.iyona.fr`

DNS A record already points at the Elastic IP. Nginx terminates TLS and proxies to Nest on `127.0.0.1:4000`. Let's Encrypt cert auto-renews via `certbot.timer`.

- Site: `/etc/nginx/sites-enabled/api.iyona.fr` (source copy: [`nginx-api.iyona.fr.conf`](./nginx-api.iyona.fr.conf))
- Health: `curl -sS https://api.iyona.fr/api/v1/health` (needs Mongo reachable — Atlas must allow `51.44.129.116`)
- Box env: `PUBLIC_BACKEND_URL=https://api.iyona.fr`. Set `FRONTEND_BASE_URL` when the front subdomain exists.

Security group `launch-wizard-1` allows TCP **22 / 80 / 443** from `0.0.0.0/0`. Do not expose **4000** publicly; nginx is the front door.

Still do:

- GitHub → `iyona-backend` → **Settings → Secrets → Actions** → set `EC2_HOST` to `ec2-51-44-129-116.eu-west-3.compute.amazonaws.com`.
- Atlas **Network Access**: allow `51.44.129.116`.

## First boot (already done)

- Ubuntu user, Node 24 via nvm, PM2, 2G swap
- Code at `~/iyona-backend` (`npm ci` + `npm run build`)
- `.env` is on the box (`chmod 600`). `FRONTEND_BASE_URL` is left unset until the public subdomain is ready.

```bash
cd ~/iyona-backend
pm2 startOrReload ecosystem.config.cjs --only iyona --update-env --env production
pm2 save
```

## PM2

```bash
cd ~/iyona-backend
pm2 startOrReload ecosystem.config.cjs --only iyona --update-env --env production
pm2 restart iyona --update-env
pm2 logs iyona
```

**Checks:**

- SSH: `./ssh` from this folder
- API health (after Atlas allowlists the Elastic IP): `curl -sS https://api.iyona.fr/api/v1/health`
