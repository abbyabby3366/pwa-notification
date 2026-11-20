import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import webpush, { type PushSubscription } from "web-push";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const VAPID_FILE = path.join(DATA_DIR, "vapid-keys.json");
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "subscriptions.json");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const UPSTREAM_URL = process.env.UPSTREAM_URL?.trim().replace(/\/+$/, "") || "";
const UPSTREAM_ORIGIN = UPSTREAM_URL ? new URL(UPSTREAM_URL).origin : "";
const PWA_SHORT_NAME = process.env.PWA_SHORT_NAME?.trim() || "Push Test";

interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  subscription: PushSubscription;
  userAgent: string;
  createdAt: string;
}

function makeSubscriptionId(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 12);
}

function parseDeviceLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone (iOS)";
  if (/iPad/i.test(ua)) return "iPad (iOS)";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown Device";
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadOrCreateVapidConfig(): VapidConfig {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  const envSubject = process.env.VAPID_SUBJECT?.trim();

  if (envPublic && envPrivate) {
    if (!envSubject) {
      throw new Error("VAPID_SUBJECT must be set when VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are provided.");
    }
    return {
      subject: envSubject,
      publicKey: envPublic,
      privateKey: envPrivate,
    };
  }

  ensureDataDir();

  if (fs.existsSync(VAPID_FILE)) {
    const raw = fs.readFileSync(VAPID_FILE, "utf8");
    const parsed = JSON.parse(raw) as VapidConfig;
    if (!parsed.publicKey || !parsed.privateKey || !parsed.subject) {
      throw new Error(`Invalid VAPID key file at ${VAPID_FILE}`);
    }
    return parsed;
  }

  const keys = webpush.generateVAPIDKeys();
  const config: VapidConfig = {
    subject: envSubject ?? "mailto:pwa-test@example.com",
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
  fs.writeFileSync(VAPID_FILE, JSON.stringify(config, null, 2), "utf8");
  console.log(`[vapid] Generated new VAPID keys and saved to ${VAPID_FILE}`);
  return config;
}

function readSubscriptions(): StoredSubscription[] {
  ensureDataDir();
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Corrupted subscriptions store at ${SUBSCRIPTIONS_FILE}`);
  }
  return (parsed as StoredSubscription[]).map((item) => ({
    ...item,
    id: item.id || makeSubscriptionId(item.endpoint),
  }));
}

function writeSubscriptions(subscriptions: StoredSubscription[]): void {
  ensureDataDir();
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2), "utf8");
}

function isValidPushSubscription(input: unknown): input is PushSubscription {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length === 0) return false;
  const keys = candidate.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== "object") return false;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

const vapid = loadOrCreateVapidConfig();
webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/vapid-public-key", (_req, res) => {
  res.json({ publicKey: vapid.publicKey });
});

app.get("/api/subscriptions", (_req, res) => {
  try {
    const subs = readSubscriptions();
    res.json({ count: subs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read subscriptions";
    res.status(500).json({ error: message });
  }
});

app.post("/api/subscribe", (req, res) => {
  try {
    const subscription = req.body?.subscription;
    if (!isValidPushSubscription(subscription)) {
      res.status(400).json({ error: "Invalid push subscription payload. Missing endpoint or keys." });
      return;
    }

    const subs = readSubscriptions();
    const id = makeSubscriptionId(subscription.endpoint);
    const existingIndex = subs.findIndex((s) => s.endpoint === subscription.endpoint);
    const record: StoredSubscription = {
      id,
      endpoint: subscription.endpoint,
      subscription,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "unknown",
      createdAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      subs[existingIndex] = record;
    } else {
      subs.push(record);
    }

    writeSubscriptions(subs);

    res.status(201).json({
      ok: true,
      id,
      count: subs.length,
      pushHost: new URL(subscription.endpoint).host,
      savedAt: record.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save push subscription";
    res.status(500).json({ error: message });
  }
});

app.delete("/api/subscribe", (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      res.status(400).json({ error: "Missing subscription endpoint to remove." });
      return;
    }

    const subs = readSubscriptions();
    const nextSubs = subs.filter((s) => s.endpoint !== endpoint);
    writeSubscriptions(nextSubs);

    res.json({
      ok: true,
      removed: subs.length - nextSubs.length,
      count: nextSubs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete subscription";
    res.status(500).json({ error: message });
  }
});

interface DeliveryResult {
  id: string;
  device: string;
  pushHost: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

async function deliverPush(
  targets: StoredSubscription[],
  title: string,
  body: string,
  url: string
): Promise<DeliveryResult[]> {
  const payload = JSON.stringify({
    title,
    body,
    sentAt: new Date().toISOString(),
    url,
  });

  const expiredEndpoints = new Set<string>();
  const results: DeliveryResult[] = [];

  for (const target of targets) {
    const pushHost = new URL(target.endpoint).host;
    const device = parseDeviceLabel(target.userAgent);
    try {
      const response = await webpush.sendNotification(target.subscription, payload, {
        TTL: 60,
        urgency: "high",
      });
      results.push({
        id: target.id,
        device,
        pushHost,
        ok: true,
        statusCode: response.statusCode,
      });
    } catch (err) {
      const statusCode =
        typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : undefined;
      const bodyText =
        typeof err === "object" && err !== null && "body" in err
          ? String((err as { body: unknown }).body)
          : err instanceof Error
            ? err.message
            : "Unknown push delivery error";

      if (statusCode === 404 || statusCode === 410) {
        expiredEndpoints.add(target.endpoint);
      }

      results.push({
        id: target.id,
        device,
        pushHost,
        ok: false,
        statusCode,
        error: bodyText,
      });
    }
  }

  if (expiredEndpoints.size > 0) {
    const current = readSubscriptions();
    writeSubscriptions(current.filter((s) => !expiredEndpoints.has(s.endpoint)));
  }

  return results;
}

// Self-test push endpoint (from the PWA itself)
app.post("/api/send", async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    const rawDelay = req.body?.delaySeconds;

    if (!title) {
      res.status(400).json({ error: "Notification title is required." });
      return;
    }
    if (!body) {
      res.status(400).json({ error: "Notification message is required." });
      return;
    }
    if (!endpoint) {
      res.status(400).json({ error: "Missing device endpoint." });
      return;
    }

    let delaySeconds = 0;
    if (rawDelay !== undefined) {
      const parsedDelay = Number(rawDelay);
      if (!Number.isInteger(parsedDelay) || parsedDelay < 0 || parsedDelay > 30) {
        res.status(400).json({ error: "delaySeconds must be an integer between 0 and 30." });
        return;
      }
      delaySeconds = parsedDelay;
    }

    const subs = readSubscriptions();
    const targets = subs.filter((s) => s.endpoint === endpoint);

    if (targets.length === 0) {
      res.status(404).json({
        error: "This device is not subscribed on the server yet. Enable notifications first.",
      });
      return;
    }

    if (delaySeconds > 0) {
      const scheduledAt = new Date().toISOString();
      setTimeout(() => {
        deliverPush(targets, title, body, "/")
          .then((results) => {
            console.log(`[push] Delayed (${delaySeconds}s) delivery results:`, results);
          })
          .catch((err) => {
            console.error("[push] Delayed delivery failed:", err);
          });
      }, delaySeconds * 1000);

      res.status(202).json({
        ok: true,
        scheduled: true,
        delaySeconds,
        targetCount: targets.length,
        scheduledAt,
      });
      return;
    }

    const results = await deliverPush(targets, title, body, "/");
    const anyFailed = results.some((r) => !r.ok);

    res.status(anyFailed ? 502 : 200).json({
      ok: !anyFailed,
      scheduled: false,
      deliveredAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send push notification";
    res.status(500).json({ error: message });
  }
});

// ---------------- Admin API ----------------

app.get("/api/admin/subscriptions", (_req, res) => {
  try {
    const subs = readSubscriptions()
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({
      count: subs.length,
      subscriptions: subs.map((s) => ({
        id: s.id,
        device: parseDeviceLabel(s.userAgent),
        pushHost: new URL(s.endpoint).host,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list subscriptions";
    res.status(500).json({ error: message });
  }
});

app.delete("/api/admin/subscriptions/:id", (req, res) => {
  try {
    const id = req.params.id?.trim();
    if (!id) {
      res.status(400).json({ error: "Missing subscription ID." });
      return;
    }

    const subs = readSubscriptions();
    const nextSubs = subs.filter((s) => s.id !== id);
    if (nextSubs.length === subs.length) {
      res.status(404).json({ error: `Subscription "${id}" not found.` });
      return;
    }

    writeSubscriptions(nextSubs);
    res.json({ ok: true, id, count: nextSubs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove subscription";
    res.status(500).json({ error: message });
  }
});

app.post("/api/admin/send", async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const url = typeof req.body?.url === "string" && req.body.url.trim().length > 0 ? req.body.url.trim() : "/";
    const targetId = typeof req.body?.targetId === "string" ? req.body.targetId.trim() : "";
    const rawDelay = req.body?.delaySeconds;

    if (!title) {
      res.status(400).json({ error: "Notification title is required." });
      return;
    }
    if (!body) {
      res.status(400).json({ error: "Notification message is required." });
      return;
    }

    let delaySeconds = 0;
    if (rawDelay !== undefined) {
      const parsedDelay = Number(rawDelay);
      if (!Number.isInteger(parsedDelay) || parsedDelay < 0 || parsedDelay > 30) {
        res.status(400).json({ error: "delaySeconds must be an integer between 0 and 30." });
        return;
      }
      delaySeconds = parsedDelay;
    }

    const subs = readSubscriptions();
    const targets = targetId ? subs.filter((s) => s.id === targetId) : subs;

    if (targets.length === 0) {
      res.status(404).json({
        error: targetId
          ? `Target device "${targetId}" was not found.`
          : "No subscribed devices found on the server.",
      });
      return;
    }

    if (delaySeconds > 0) {
      const scheduledAt = new Date().toISOString();
      setTimeout(() => {
        deliverPush(targets, title, body, url)
          .then((results) => {
            console.log(`[admin-push] Delayed (${delaySeconds}s) delivery results:`, results);
          })
          .catch((err) => {
            console.error("[admin-push] Delayed delivery failed:", err);
          });
      }, delaySeconds * 1000);

      res.status(202).json({
        ok: true,
        scheduled: true,
        delaySeconds,
        targetCount: targets.length,
        scheduledAt,
      });
      return;
    }

    const results = await deliverPush(targets, title, body, url);
    const anyFailed = results.some((r) => !r.ok);

    res.status(anyFailed ? 502 : 200).json({
      ok: !anyFailed,
      scheduled: false,
      deliveredAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send push notification";
    res.status(500).json({ error: message });
  }
});

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function injectPwaTags(html: string): string {
  const safeShortName = escapeHtmlAttr(PWA_SHORT_NAME);
  const headInjection = [
    `<link rel="manifest" href="/manifest.webmanifest">`,
    `<meta name="apple-mobile-web-app-capable" content="yes">`,
    `<meta name="mobile-web-app-capable" content="yes">`,
    `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
    `<meta name="apple-mobile-web-app-title" content="${safeShortName}">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">`,
  ].join("\n");

  const bodyInjection = `<script src="/inject.js" defer></script>`;

  let output = html;
  if (/<\/head>/i.test(output)) {
    output = output.replace(/<\/head>/i, `${headInjection}\n</head>`);
  } else {
    output = `${headInjection}\n${output}`;
  }

  if (/<\/body>/i.test(output)) {
    output = output.replace(/<\/body>/i, `${bodyInjection}\n</body>`);
  } else {
    output = `${output}\n${bodyInjection}`;
  }

  return output;
}

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyToUpstream(req: Request, res: Response): Promise<void> {
  const targetUrl = new URL(req.originalUrl, UPSTREAM_ORIGIN);
  const proxyOrigin = `${req.protocol}://${req.get("host")}`;

  const forwardHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) forwardHeaders.append(key, v);
    } else {
      forwardHeaders.set(key, value);
    }
  }
  forwardHeaders.set("host", new URL(UPSTREAM_ORIGIN).host);
  forwardHeaders.set("accept-encoding", "identity");

  const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
  const bodyBuffer = hasBody ? await readRawBody(req) : undefined;

  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuffer && bodyBuffer.length > 0 ? new Uint8Array(bodyBuffer) : undefined,
      redirect: "manual",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream unreachable";
    res.status(502).type("text/plain").send(`Bad Gateway: Could not reach ${UPSTREAM_ORIGIN} (${message})`);
    return;
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "";
  const isHtml = contentType.toLowerCase().includes("text/html");

  res.status(upstreamRes.status);

  upstreamRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === "content-encoding" || lower === "set-cookie") {
      return;
    }
    if (isHtml && (lower === "content-security-policy" || lower === "content-security-policy-report-only")) {
      return;
    }
    if (lower === "location") {
      const rewritten = value.startsWith(UPSTREAM_ORIGIN)
        ? value.replace(UPSTREAM_ORIGIN, proxyOrigin)
        : value;
      res.setHeader("location", rewritten);
      return;
    }
    res.setHeader(key, value);
  });

  const setCookies =
    typeof upstreamRes.headers.getSetCookie === "function"
      ? upstreamRes.headers.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    res.setHeader(
      "set-cookie",
      setCookies.map((cookie) => cookie.replace(/;\s*domain=[^;]+/gi, ""))
    );
  }

  if (isHtml) {
    const html = await upstreamRes.text();
    res.send(injectPwaTags(html));
    return;
  }

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstreamRes.body as unknown as import("node:stream/web").ReadableStream);
  nodeStream.pipe(res);
}

// Serve built frontend in production
if (fs.existsSync(DIST_DIR)) {
  app.get(["/admin", "/admin/"], (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "admin.html"));
  });

  // In UPSTREAM_URL reverse-proxy mode, serve our static PWA/admin files (not index.html)
  // and proxy all other requests (including "/") to UPSTREAM_URL with PWA tags injected.
  app.use(
    express.static(DIST_DIR, {
      index: UPSTREAM_ORIGIN ? false : "index.html",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".webmanifest")) {
          res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        }
        if (filePath.endsWith("sw.js") || filePath.endsWith("inject.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );

  if (UPSTREAM_ORIGIN) {
    app.use((req, res) => {
      void proxyToUpstream(req, res);
    });
  } else {
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(DIST_DIR, "index.html"));
    });
  }
} else if (UPSTREAM_ORIGIN) {
  app.use((req, res) => {
    void proxyToUpstream(req, res);
  });
}

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? (isProduction ? 3000 : 3001));

app.listen(port, "0.0.0.0", () => {
  const modeNote = UPSTREAM_ORIGIN ? ` -> proxying ${UPSTREAM_ORIGIN}` : "";
  console.log(`[server] Listening on http://0.0.0.0:${port}${modeNote} (${isProduction ? "production" : "development"})`);
});
