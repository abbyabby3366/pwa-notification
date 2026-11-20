# pwaneuronmy — Plain Sample Upstream App

A minimal, plain web app (**no manifest, no service worker, no push notification code**) designed to simulate an upstream website whose repo/source code you do not have access to.

Run this internally (e.g. Docker network `http://pwaneuronmy:3000` or `http://127.0.0.1:3005`), then put **`../pwaio7my`** in front of it on **`https://pwa.neuron.my`** with `UPSTREAM_URL=http://pwaneuronmy:3000` to add iOS PWA + Web Push notifications purely at the proxy layer.

## Run Locally

```bash
npm install
npm run dev
```

## Deploy (Docker)

```bash
docker build -t pwaneuronmy .
docker run -d --name pwaneuronmy --restart unless-stopped -p 127.0.0.1:3005:3000 pwaneuronmy
```

## Deploy (Node.js)

```bash
npm ci
npm run build
PORT=3005 npm start
```

## Verify

```bash
curl -fsS https://pwa.neuron.my/health
```

