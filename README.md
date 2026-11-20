# PWA Push Test (iOS Ready)

A single-page Progressive Web App (PWA) with a lightweight Node.js + TypeScript Web Push server built for testing **Apple iOS Add to Home Screen** and **Web Push (APNs)** notifications on a custom HTTPS subdomain.

---

## Architecture Overview (For Deployment Agents)

- **Runtime:** Node.js LTS (`>= 20`, Dockerfile uses `node:lts-alpine`)
- **Single-Port Production Server:** In production (`NODE_ENV=production`), Express (`dist-server/index.js`) serves both the static Vite frontend (`dist/`) and the Web Push API (`/api/*`) on a single port (`PORT`, default `3000`).
- **Persistent State (`./data`):**
  - `data/vapid-keys.json` — Auto-generated on first boot if `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are not supplied via env vars.
  - `data/subscriptions.json` — Active push subscriptions.
  - **Important:** Persist `./data` across restarts/redeploys (or supply fixed VAPID env vars). If VAPID keys change, existing iOS subscriptions will fail until re-subscribed.
- **HTTPS Requirement:** Apple iOS **strictly requires HTTPS** (valid TLS cert) on the target subdomain to register Service Workers and expose `Notification` / `PushManager`.

---

## Environment Variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | Recommended | `production` | Set to `production` in deployment. |
| `PORT` | Optional | `3000` (prod) / `3001` (dev) | Server listens on `0.0.0.0:$PORT`. |
| `VAPID_SUBJECT` | Optional | `mailto:pwa-test@example.com` | **Must** be `mailto:` or `https://` (Apple APNs rejects `localhost`). Required if custom VAPID keys are set. |
| `VAPID_PUBLIC_KEY` | Optional | Auto-generated in `data/vapid-keys.json` | URL-safe base64 VAPID public key. |
| `VAPID_PRIVATE_KEY` | Optional | Auto-generated in `data/vapid-keys.json` | URL-safe base64 VAPID private key. |

---

## Deployment Options

### Option 1: Docker (Recommended)

```bash
docker build -t pwa-notification .

docker run -d \
  --name pwa-notification \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e VAPID_SUBJECT="mailto:admin@yourdomain.com" \
  -v "$(pwd)/data:/app/data" \
  pwa-notification
```

### Option 2: Direct Node.js (Bare Metal / PM2 / systemd)

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 VAPID_SUBJECT="mailto:admin@yourdomain.com" npm start
```

Example with PM2:
```bash
NODE_ENV=production PORT=3000 VAPID_SUBJECT="mailto:admin@yourdomain.com" \
  pm2 start dist-server/index.js --name pwa-notification
pm2 save
```

---

## Reverse Proxy & HTTPS Setup (Subdomain)

Point your subdomain DNS (`A` / `AAAA` / `CNAME`) to your host and terminate HTTPS in front of `http://127.0.0.1:3000`.

### Caddy (Automatic HTTPS)
```caddyfile
push.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Nginx (with Certbot / TLS)
```nginx
server {
    listen 443 ssl http2;
    server_name push.yourdomain.com;

    # ssl_certificate / ssl_certificate_key managed by certbot or your CA

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Cloudflare Tunnel
Route `https://push.yourdomain.com` → `http://127.0.0.1:3000`.

> **Caching Note:** The Express server already sends `Content-Type: application/manifest+json` for `/manifest.webmanifest` and `Cache-Control: no-cache, no-store, must-revalidate` for `/sw.js`. Do not override `/sw.js` with aggressive CDN caching.

---

## Post-Deploy Verification (Agent Checklist)

Replace `https://push.yourdomain.com` with your deployed subdomain and verify all checks return HTTP `200`:

```bash
# 1. Health check
curl -fsS https://push.yourdomain.com/api/health

# 2. VAPID public key (should return JSON with an 87-char publicKey)
curl -fsS https://push.yourdomain.com/api/vapid-public-key

# 3. Manifest (verify Content-Type: application/manifest+json and "display": "standalone")
curl -fsSI https://push.yourdomain.com/manifest.webmanifest
curl -fsS https://push.yourdomain.com/manifest.webmanifest

# 4. Service Worker (verify Cache-Control: no-cache)
curl -fsSI https://push.yourdomain.com/sw.js

# 5. iOS Home Screen icon
curl -fsSI https://push.yourdomain.com/icons/apple-touch-icon.png
```

---

## Local Development

Runs both backend (`tsx watch` on port `3001`) and frontend (Vite HMR on port `5173`, proxying `/api` to `3001`) concurrently:

```bash
npm install
npm run dev
```

---

## How to Test on Apple iOS (iOS 16.4+)

1. Open `https://push.yourdomain.com` in **Safari** on your iPhone or iPad.
2. Tap **Share** (square with up arrow) → **Add to Home Screen** → **Add**.
3. Close Safari and launch **Push Test** from your **Home Screen**.
4. Confirm all **Environment Checklist** items show green (`HTTPS`, `Standalone`, `Service Worker`).
5. Tap **Enable Push Notifications** and tap **Allow** on the iOS prompt.
6. Test notifications:
   - **Send Web Push Now** — immediate server → Apple Push Service (`web.push.apple.com`) delivery.
   - **Send Web Push in 5s (Lock Screen Test)** — tap, then immediately lock your iPhone or swipe to Home Screen to verify background/lock-screen delivery.
   - **Send Local Notification** — triggers `registration.showNotification` directly without the push server.

---

## Troubleshooting iOS Push

- **"Needs Home Screen" in checklist:** You opened the site in Safari instead of launching the installed Home Screen icon.
- **Permission denied:** Re-enable in iOS **Settings → Notifications → Push Test**.
- **Push returns `403` / `400` from Apple:** Ensure `VAPID_SUBJECT` is a valid `mailto:` or `https://` address (not `localhost`) and that `data/vapid-keys.json` did not change after subscribing.
- **Icons not updating on iOS:** Delete the Home Screen icon, clear Safari website data for the subdomain, and re-add to Home Screen.
