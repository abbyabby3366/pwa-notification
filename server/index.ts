import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webpush, { type PushSubscription } from "web-push";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const VAPID_FILE = path.join(DATA_DIR, "vapid-keys.json");
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, "subscriptions.json");
const DIST_DIR = path.join(ROOT_DIR, "dist");

interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

interface StoredSubscription {
  endpoint: string;
  subscription: PushSubscription;
  userAgent: string;
  createdAt: string;
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
  return parsed as StoredSubscription[];
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
    res.json({
      count: subs.length,
      endpoints: subs.map((s) => ({
        host: new URL(s.endpoint).host,
        createdAt: s.createdAt,
      })),
    });
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
    const existingIndex = subs.findIndex((s) => s.endpoint === subscription.endpoint);
    const record: StoredSubscription = {
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
  pushHost: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

async function deliverPush(
  targets: StoredSubscription[],
  title: string,
  body: string
): Promise<DeliveryResult[]> {
  const payload = JSON.stringify({
    title,
    body,
    sentAt: new Date().toISOString(),
    url: "/",
  });

  const expiredEndpoints = new Set<string>();
  const results: DeliveryResult[] = [];

  for (const target of targets) {
    const pushHost = new URL(target.endpoint).host;
    try {
      const response = await webpush.sendNotification(target.subscription, payload, {
        TTL: 60,
        urgency: "high",
      });
      results.push({
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

app.post("/api/send", async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
    const sendToAll = req.body?.sendToAll === true;
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
    const targets = sendToAll
      ? subs
      : subs.filter((s) => s.endpoint === endpoint);

    if (targets.length === 0) {
      res.status(404).json({
        error: sendToAll
          ? "No subscribed devices found on the server."
          : "This device is not subscribed on the server yet. Enable notifications first.",
      });
      return;
    }

    if (delaySeconds > 0) {
      const scheduledAt = new Date().toISOString();
      setTimeout(() => {
        deliverPush(targets, title, body)
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

    const results = await deliverPush(targets, title, body);
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

// Serve built frontend in production
if (fs.existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".webmanifest")) {
          res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
        }
        if (filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? (isProduction ? 3000 : 3001));

app.listen(port, "0.0.0.0", () => {
  console.log(`[server] Listening on http://0.0.0.0:${port} (${isProduction ? "production" : "development"})`);
});
