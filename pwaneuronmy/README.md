# pwaneuronmy — Plain Sample Upstream App

A minimal, plain web app (**no manifest, no service worker, no push notification code**) designed to simulate an upstream website whose repo/source code you do not have access to.

Deploy this to **`https://pwa.neuron.my`**, then wrap it using **`../pwaio7my`** with `UPSTREAM_URL=https://pwa.neuron.my` to test adding iOS PWA + Web Push notifications purely at the domain/proxy layer.

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

