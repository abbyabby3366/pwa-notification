# PWA Push Notification Lab (iOS Ready)

This repository tests **Apple iOS Home Screen PWA + Web Push Notifications** in two setups, including adding push notifications to a web app **without access to its source code** using a reverse-proxy wrapper.

---

## Goal (For Hermes Deployment Agent)

Deploy **two separate apps** on two HTTPS subdomains:

| Folder | Target Subdomain | Role | Suggested Local Port |
| --- | --- | --- | --- |
| `pwaneuronmy/` | `https://pwa.neuron.my` | **Plain upstream app** (intentionally has **NO** manifest, **NO** service worker, **NO** push code). Simulates a site whose repo we cannot modify. | `3005` |
| `pwaio7my/` | `https://pwa.io7.my` | **PWA + iOS Web Push + `/admin` server**. When `UPSTREAM_URL` is set (e.g. `https://pwa.neuron.my`), it reverse-proxies that upstream site and injects `manifest.webmanifest`, iOS meta tags, `/sw.js`, and a floating **Enable Notifications** button on the fly. | `3000` |

> **End-state:** Users open `https://pwa.io7.my` on iPhone Safari (which displays the `pwa.neuron.my` app), tap **Add to Home Screen**, open it from the Home Screen, and tap **Enable Notifications**. You can then open **`https://pwa.io7.my/admin`** anytime to send push notifications to subscribed devices.
>
> Later, to wrap `https://statsdashboard.onrender.com` instead, just change `UPSTREAM_URL=https://statsdashboard.onrender.com` on `pwaio7my` and restart—no code changes needed.

---

## Deployment Instructions (For Hermes)

### 1. Deploy `pwaneuronmy` → `https://pwa.neuron.my`

```bash
cd pwaneuronmy
docker build -t pwaneuronmy .
docker run -d \
  --name pwaneuronmy \
  --restart unless-stopped \
  -p 127.0.0.1:3005:3000 \
  pwaneuronmy
```

Route HTTPS `https://pwa.neuron.my` → `http://127.0.0.1:3005`.

### 2. Deploy `pwaio7my` → `https://pwa.io7.my`

> **Important:** Always mount `-v "$(pwd)/data:/app/data"` so `data/vapid-keys.json` and `data/subscriptions.json` persist across container restarts/redeploys.

**Mode A — Reverse-Proxy Wrapper Mode (wrapping `https://pwa.neuron.my`):**
```bash
cd pwaio7my
docker build -t pwaio7my .
docker run -d \
  --name pwaio7my \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e UPSTREAM_URL="https://pwa.neuron.my" \
  -e PWA_SHORT_NAME="Neuron App" \
  -e VAPID_SUBJECT="mailto:admin@io7.my" \
  -v "$(pwd)/data:/app/data" \
  pwaio7my
```

**Mode B — Standalone PWA Push Test Mode:**
Same command as above, simply omit `-e UPSTREAM_URL=...`.

Route HTTPS `https://pwa.io7.my` → `http://127.0.0.1:3000`. Do **not** aggressively cache `/sw.js` or `/inject.js`.

---

## Post-Deploy Verification (For Hermes)

```bash
# 1. Verify plain upstream app (should NOT contain manifest.webmanifest)
curl -fsS https://pwa.neuron.my/health
curl -fsS https://pwa.neuron.my/ | grep -c "manifest.webmanifest" || true  # expected: 0

# 2. Verify wrapper app injects PWA tags into proxied HTML
curl -fsS https://pwa.io7.my/ | grep -E "Neuron Sample App|manifest.webmanifest|/inject.js"

# 3. Verify PWA & Admin endpoints on pwa.io7.my (all should return HTTP 200)
curl -fsSI https://pwa.io7.my/manifest.webmanifest
curl -fsSI https://pwa.io7.my/sw.js
curl -fsSI https://pwa.io7.my/inject.js
curl -fsSI https://pwa.io7.my/admin
curl -fsS  https://pwa.io7.my/api/vapid-public-key
```

---

## How to Test on iPhone (iOS 16.4+)

1. Open **`https://pwa.io7.my`** in **Safari** on your iPhone (you should see the Neuron Sample App).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Neuron App** from your **Home Screen** (not Safari).
4. Tap the floating **Enable Notifications** pill → tap **Allow**.
5. On your computer (or phone), open **`https://pwa.io7.my/admin`**, confirm your iPhone appears in **Subscribed Devices**, and click **Send Push Notification** (or pick a 5s delay and lock your iPhone!).

See individual folder READMEs for full details:
- [`pwaio7my/README.md`](./pwaio7my/README.md)
- [`pwaneuronmy/README.md`](./pwaneuronmy/README.md)
