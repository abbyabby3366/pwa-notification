# PWA Push Notification Lab (iOS Ready — Single Domain Proxy Setup)

This repository adds **Apple iOS Home Screen PWA + Web Push Notifications + `/admin` broadcast panel** to **`https://pwa.neuron.my`** without modifying the upstream app's source code (`pwaneuronmy/`).

---

## Architecture (For Hermes Deployment Agent)

Single public HTTPS domain: **`https://pwa.neuron.my`**

```text
iPhone Safari ──▶ https://pwa.neuron.my
                        │ (HTTPS reverse proxy: Caddy / Nginx / Cloudflare)
                        ▼
                  pwaio7my (127.0.0.1:3000) — PWA + Push + /admin wrapper
                        │ (UPSTREAM_URL=http://pwaneuronmy:3000)
                        ▼
                  pwaneuronmy (internal only, port 3000) — plain app, NO PWA code
```

| Folder | Role | Exposure |
| --- | --- | --- |
| `pwaneuronmy/` | Plain upstream web app (intentionally has **NO** manifest, **NO** service worker, **NO** push code). | Internal only (Docker network `pwa-net`, or `127.0.0.1:3005` if bare Node). |
| `pwaio7my/` | PWA + iOS Web Push + `/admin` wrapper sitting in front of `pwaneuronmy`. Proxies `/` and injects `manifest.webmanifest`, iOS meta tags, `/sw.js`, and a floating **Enable Notifications** button on the fly. | Public via **`https://pwa.neuron.my`** → `http://127.0.0.1:3000`. |

---

## Deployment Instructions (For Hermes)

### Option A: Docker (Recommended)

1. Create a shared internal Docker network:
   ```bash
   docker network create pwa-net || true
   ```

2. Build & run **`pwaneuronmy`** (internal only, no host port needed):
   ```bash
   cd pwaneuronmy
   docker build -t pwaneuronmy .
   docker run -d \
     --name pwaneuronmy \
     --network pwa-net \
     --restart unless-stopped \
     pwaneuronmy
   ```

3. Build & run **`pwaio7my`** (publicly fronted by `https://pwa.neuron.my`):
   > **Important:** Always mount `-v "$(pwd)/data:/app/data"` so `data/vapid-keys.json` and `data/subscriptions.json` persist across restarts/redeploys.
   ```bash
   cd ../pwaio7my
   docker build -t pwaio7my .
   docker run -d \
     --name pwaio7my \
     --network pwa-net \
     --restart unless-stopped \
     -p 127.0.0.1:3000:3000 \
     -e NODE_ENV=production \
     -e PORT=3000 \
     -e UPSTREAM_URL="http://pwaneuronmy:3000" \
     -e PWA_SHORT_NAME="Neuron App" \
     -e VAPID_SUBJECT="mailto:admin@neuron.my" \
     -v "$(pwd)/data:/app/data" \
     pwaio7my
   ```

4. Route HTTPS **`https://pwa.neuron.my`** → `http://127.0.0.1:3000` (Caddy / Nginx / Cloudflare Tunnel). Do **not** aggressively cache `/sw.js` or `/inject.js`.

### Option B: Direct Node.js / PM2 (No Docker)

```bash
# 1. Start plain upstream internally on port 3005
cd pwaneuronmy && npm ci && npm run build
PORT=3005 pm2 start dist/server.js --name pwaneuronmy

# 2. Start PWA wrapper on port 3000 pointing to internal upstream
cd ../pwaio7my && npm ci && npm run build
NODE_ENV=production PORT=3000 UPSTREAM_URL="http://127.0.0.1:3005" PWA_SHORT_NAME="Neuron App" VAPID_SUBJECT="mailto:admin@neuron.my" \
  pm2 start dist-server/index.js --name pwaio7my
pm2 save
```

---

## Post-Deploy Verification (For Hermes)

```bash
# 1. Verify pwa.neuron.my serves Neuron Sample App WITH injected PWA tags
curl -fsS https://pwa.neuron.my/ | grep -E "Neuron Sample App|manifest.webmanifest|/inject.js"

# 2. Verify PWA & Admin endpoints on pwa.neuron.my (all should return HTTP 200)
curl -fsSI https://pwa.neuron.my/manifest.webmanifest
curl -fsSI https://pwa.neuron.my/sw.js
curl -fsSI https://pwa.neuron.my/inject.js
curl -fsSI https://pwa.neuron.my/admin
curl -fsS  https://pwa.neuron.my/api/vapid-public-key
```

---

## How to Test on iPhone (iOS 16.4+)

1. Open **`https://pwa.neuron.my`** in **Safari** on your iPhone.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Neuron App** from your **Home Screen** (not Safari).
4. Tap the floating **Enable Notifications** pill → tap **Allow**.
5. On your computer (or phone), open **`https://pwa.neuron.my/admin`**, confirm your iPhone appears under **Subscribed Devices**, and click **Send Push Notification** (or pick a 5s delay and lock your iPhone!).

See individual folder READMEs for full details:
- [`pwaio7my/README.md`](./pwaio7my/README.md)
- [`pwaneuronmy/README.md`](./pwaneuronmy/README.md)
