import "./styles.css";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Navigator {
    standalone?: boolean;
    install?: () => Promise<void>;
  }
}

type LogKind = "ok" | "err" | "info";

interface ActivityEntry {
  kind: LogKind;
  message: string;
  timestampIso: string;
}

// DOM Elements
const errorBanner = document.getElementById("error-banner") as HTMLElement;
const errorTitle = document.getElementById("error-title") as HTMLElement;
const errorMessage = document.getElementById("error-message") as HTMLElement;
const iosInstallBanner = document.getElementById("ios-install-banner") as HTMLElement;
const deviceBadge = document.getElementById("device-badge") as HTMLElement;

const chkSecure = document.getElementById("chk-secure") as HTMLElement;
const chkStandalone = document.getElementById("chk-standalone") as HTMLElement;
const chkSw = document.getElementById("chk-sw") as HTMLElement;
const chkPermission = document.getElementById("chk-permission") as HTMLElement;
const chkPush = document.getElementById("chk-push") as HTMLElement;
const pushEndpointInfo = document.getElementById("push-endpoint-info") as HTMLElement;

const btnEnablePush = document.getElementById("btn-enable-push") as HTMLButtonElement;
const btnUnsubscribe = document.getElementById("btn-unsubscribe") as HTMLButtonElement;
const notifyForm = document.getElementById("notify-form") as HTMLFormElement;
const inputTitle = document.getElementById("input-title") as HTMLInputElement;
const inputBody = document.getElementById("input-body") as HTMLTextAreaElement;
const btnSendPush = document.getElementById("btn-send-push") as HTMLButtonElement;
const btnSendDelayed = document.getElementById("btn-send-delayed") as HTMLButtonElement;
const btnSendLocal = document.getElementById("btn-send-local") as HTMLButtonElement;
const countdownStatus = document.getElementById("countdown-status") as HTMLElement;

const activityLog = document.getElementById("activity-log") as HTMLUListElement;
const serverCount = document.getElementById("server-count") as HTMLElement;

const installButton = document.getElementById("install-app") as HTMLButtonElement;
const installStatus = document.getElementById("install-status") as HTMLElement;

const confirmDialog = document.getElementById("confirm-unsubscribe-dialog") as HTMLDialogElement;
const btnCancelUnsubscribe = document.getElementById("btn-cancel-unsubscribe") as HTMLButtonElement;
const btnConfirmUnsubscribe = document.getElementById("btn-confirm-unsubscribe") as HTMLButtonElement;

// State
let swRegistration: ServiceWorkerRegistration | null = null;
let currentSubscription: PushSubscription | null = null;
const activities: ActivityEntry[] = [];

// Format full ISO datetime into GMT+8 (Asia/Kuala_Lumpur) with DD-MM-YY date and HH:mm:ss time
function formatGmt8DateTime(iso: string): { date: string; time: string } {
  const dateObj = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dateObj);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${get("day")}-${get("month")}-${get("year")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

function showError(title: string, message: string): void {
  errorTitle.textContent = title;
  errorMessage.textContent = message;
  errorBanner.hidden = false;
}

function clearError(): void {
  errorBanner.hidden = true;
}

function addLog(kind: LogKind, message: string, timestampIso = new Date().toISOString()): void {
  activities.unshift({ kind, message, timestampIso });
  if (activities.length > 20) {
    activities.length = 20;
  }
  renderLogs();
}

function renderLogs(): void {
  if (activities.length === 0) {
    activityLog.innerHTML = `<li class="log-empty">No events yet.</li>`;
    return;
  }

  activityLog.innerHTML = "";
  for (const entry of activities) {
    const { date, time } = formatGmt8DateTime(entry.timestampIso);
    const li = document.createElement("li");
    li.className = `log-item log-item-${entry.kind}`;

    const textSpan = document.createElement("span");
    textSpan.className = "log-text";
    textSpan.textContent = entry.message;

    const tsDiv = document.createElement("div");
    tsDiv.className = "log-timestamp";

    const primaryTime = document.createElement("span");
    primaryTime.className = "log-time-primary";
    primaryTime.textContent = time;

    const secondaryDate = document.createElement("span");
    secondaryDate.className = "log-date-secondary";
    secondaryDate.textContent = `${date} GMT+8`;

    tsDiv.append(primaryTime, secondaryDate);
    li.append(textSpan, tsDiv);
    activityLog.append(li);
  }
}

function setTag(el: HTMLElement, text: string, variant: "ok" | "warn" | "err"): void {
  el.textContent = text;
  el.className = `status-tag status-${variant}`;
}

function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function fetchServerSubscriptionCount(): Promise<void> {
  try {
    const res = await fetch("/api/subscriptions");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { count: number };
    serverCount.textContent = `${data.count} subscribed device${data.count === 1 ? "" : "s"}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unable to reach backend";
    serverCount.textContent = "Server unreachable";
    showError("Backend connection failed", `Could not reach /api/subscriptions (${msg}).`);
  }
}

function updateUIState(): void {
  const ios = isIosDevice();
  const standalone = isStandaloneMode();
  const secure = window.isSecureContext;
  const hasNotificationApi = "Notification" in window;
  const hasPushApi = "PushManager" in window;

  deviceBadge.textContent = ios ? (standalone ? "iOS PWA" : "iOS Browser") : standalone ? "PWA" : "Browser";

  setTag(chkSecure, secure ? "Yes (HTTPS)" : "No (HTTPS Required)", secure ? "ok" : "err");
  setTag(chkStandalone, standalone ? "Yes" : "No (Browser Tab)", standalone ? "ok" : ios ? "warn" : "warn");
  setTag(chkSw, swRegistration ? "Active" : "Not Registered", swRegistration ? "ok" : "err");

  if (!hasNotificationApi) {
    setTag(
      chkPermission,
      ios && !standalone ? "Needs Home Screen" : "Unavailable",
      ios && !standalone ? "warn" : "err"
    );
  } else {
    const perm = Notification.permission;
    setTag(
      chkPermission,
      perm === "granted" ? "Granted" : perm === "denied" ? "Denied" : "Not Requested",
      perm === "granted" ? "ok" : perm === "denied" ? "err" : "warn"
    );
  }

  if (!hasPushApi) {
    setTag(chkPush, ios && !standalone ? "Needs Home Screen" : "Unavailable", ios && !standalone ? "warn" : "err");
  } else if (currentSubscription) {
    setTag(chkPush, "Subscribed", "ok");
    const host = new URL(currentSubscription.endpoint).host;
    pushEndpointInfo.textContent = `Push service: ${host}`;
    pushEndpointInfo.hidden = false;
  } else {
    setTag(chkPush, "Not Subscribed", "warn");
    pushEndpointInfo.hidden = true;
  }

  // Show iOS Add to Home Screen banner when on iOS Safari tab (not standalone)
  iosInstallBanner.hidden = !(ios && !standalone);

  const canEnablePush = secure && Boolean(swRegistration) && hasNotificationApi && hasPushApi;
  btnEnablePush.disabled = !canEnablePush;
  btnEnablePush.textContent = currentSubscription
    ? "Re-Sync Push Subscription"
    : "Enable Push Notifications";

  btnUnsubscribe.hidden = !currentSubscription;

  const canSendPush = Boolean(currentSubscription) && hasNotificationApi && Notification.permission === "granted";
  btnSendPush.disabled = !canSendPush;
  btnSendDelayed.disabled = !canSendPush;

  const canSendLocal = Boolean(swRegistration) && hasNotificationApi && Notification.permission === "granted";
  btnSendLocal.disabled = !canSendLocal;
}

async function initServiceWorkerAndState(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    showError("Service Worker Unsupported", "This browser does not support Service Workers.");
    updateUIState();
    return;
  }

  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    if ("PushManager" in window && swRegistration.pushManager) {
      currentSubscription = await swRegistration.pushManager.getSubscription();
    }

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "PUSH_RECEIVED") {
        addLog("ok", `Push received: "${event.data.title}"`, event.data.receivedAt);
      }
    });

    addLog("info", "Service Worker ready.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Service Worker registration failed";
    showError("Service Worker Error", msg);
    addLog("err", `Service Worker failed: ${msg}`);
  }

  updateUIState();
  await fetchServerSubscriptionCount();
}

async function handleEnablePush(): Promise<void> {
  clearError();

  if (!swRegistration) {
    showError("Service Worker Not Ready", "Service Worker must be registered before enabling push.");
    return;
  }
  if (!("Notification" in window) || !("PushManager" in window)) {
    showError(
      "Push API Unavailable",
      "On iOS, you must Add to Home Screen first and open the app from the Home Screen."
    );
    return;
  }

  btnEnablePush.disabled = true;
  try {
    // Must be called directly inside the click handler on iOS
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showError(
        "Permission Not Granted",
        `Notification permission is "${permission}". If previously denied on iOS, re-enable it in iOS Settings → Notifications → Push Test.`
      );
      addLog("err", `Permission result: ${permission}`);
      updateUIState();
      return;
    }

    const keyRes = await fetch("/api/vapid-public-key");
    if (!keyRes.ok) {
      throw new Error(`Failed to fetch VAPID public key (HTTP ${keyRes.status})`);
    }
    const { publicKey } = (await keyRes.json()) as { publicKey: string };
    if (!publicKey) {
      throw new Error("Server returned an empty VAPID public key.");
    }

    let sub = await swRegistration.pushManager.getSubscription();
    if (!sub) {
      sub = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const saveRes = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });

    const saveData = (await saveRes.json()) as { ok?: boolean; pushHost?: string; error?: string };
    if (!saveRes.ok || !saveData.ok) {
      throw new Error(saveData.error ?? `Failed to save subscription (HTTP ${saveRes.status})`);
    }

    currentSubscription = sub;
    addLog("ok", `Subscribed via ${saveData.pushHost ?? new URL(sub.endpoint).host}`);
    await fetchServerSubscriptionCount();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to enable push notifications";
    showError("Subscription Failed", msg);
    addLog("err", `Subscribe failed: ${msg}`);
  } finally {
    updateUIState();
  }
}

async function performUnsubscribe(): Promise<void> {
  clearError();
  if (!currentSubscription) return;

  const endpoint = currentSubscription.endpoint;
  try {
    await currentSubscription.unsubscribe();
    const res = await fetch("/api/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    currentSubscription = null;
    addLog("info", "Unsubscribed this device from push notifications.");
    await fetchServerSubscriptionCount();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unsubscribe failed";
    showError("Unsubscribe Error", msg);
    addLog("err", `Unsubscribe failed: ${msg}`);
  } finally {
    updateUIState();
  }
}

async function sendWebPush(delaySeconds: number): Promise<void> {
  clearError();
  if (!currentSubscription) {
    showError("Not Subscribed", "Enable push notifications first.");
    return;
  }

  const title = inputTitle.value.trim();
  const body = inputBody.value.trim();
  if (!title || !body) {
    showError("Missing Fields", "Both Title and Message are required.");
    return;
  }

  btnSendPush.disabled = true;
  btnSendDelayed.disabled = true;

  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: currentSubscription.endpoint,
        title,
        body,
        delaySeconds,
      }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      scheduled?: boolean;
      delaySeconds?: number;
      error?: string;
      results?: Array<{ pushHost: string; ok: boolean; statusCode?: number; error?: string }>;
    };

    if (!res.ok || !data.ok) {
      const detail =
        data.results?.find((r) => !r.ok)?.error ??
        data.error ??
        `Server returned HTTP ${res.status}`;
      throw new Error(detail);
    }

    if (data.scheduled && delaySeconds > 0) {
      addLog("info", `Scheduled Web Push in ${delaySeconds}s — lock your screen now!`);
      let remaining = delaySeconds;
      countdownStatus.hidden = false;
      countdownStatus.textContent = `Sending in ${remaining}s — lock your iPhone or go to Home Screen now!`;

      const timer = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          window.clearInterval(timer);
          countdownStatus.textContent = "Push dispatched by server.";
          window.setTimeout(() => {
            countdownStatus.hidden = true;
          }, 3000);
        } else {
          countdownStatus.textContent = `Sending in ${remaining}s — lock your iPhone or go to Home Screen now!`;
        }
      }, 1000);
    } else {
      const firstResult = data.results?.[0];
      const statusSuffix = firstResult?.statusCode ? ` (HTTP ${firstResult.statusCode})` : "";
      addLog("ok", `Web Push sent to ${firstResult?.pushHost ?? "push service"}${statusSuffix}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send Web Push";
    showError("Web Push Failed", msg);
    addLog("err", `Web Push error: ${msg}`);
  } finally {
    updateUIState();
  }
}

async function sendLocalNotification(): Promise<void> {
  clearError();
  if (!swRegistration) {
    showError("Service Worker Not Ready", "Service Worker is required to show notifications.");
    return;
  }

  const title = inputTitle.value.trim();
  const body = inputBody.value.trim();
  if (!title || !body) {
    showError("Missing Fields", "Both Title and Message are required.");
    return;
  }

  try {
    await swRegistration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    });
    addLog("ok", `Local notification shown: "${title}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to show local notification";
    showError("Local Notification Failed", msg);
    addLog("err", `Local notification error: ${msg}`);
  }
}

// Progressive Web Install API (navigator.install() with beforeinstallprompt fallback)
function initInstallPrompt(): void {
  const supportsWebInstall = typeof Navigator.prototype.install === "function";
  let deferredInstallPrompt: BeforeInstallPromptEvent | undefined;

  if (supportsWebInstall && !isStandaloneMode()) {
    installButton.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    if (!supportsWebInstall) {
      installButton.hidden = false;
    }
  });

  installButton.addEventListener("click", async () => {
    if (installButton.getAttribute("aria-disabled") === "true") {
      return;
    }
    installButton.setAttribute("aria-disabled", "true");

    try {
      if (supportsWebInstall && navigator.install) {
        await navigator.install();
        installStatus.textContent = "The app was installed or opened.";
        installButton.hidden = true;
      } else if (deferredInstallPrompt) {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = undefined;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        installStatus.textContent =
          outcome === "accepted" ? "The app was installed." : "Installation canceled.";
        if (!deferredInstallPrompt) {
          installButton.hidden = true;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        installStatus.textContent = "Installation was canceled or could not complete.";
      } else {
        const msg = err instanceof Error ? err.message : "Installation could not start.";
        showError("Install Error", msg);
      }
    } finally {
      installButton.removeAttribute("aria-disabled");
    }
  });
}

// Event Listeners
btnEnablePush.addEventListener("click", () => {
  void handleEnablePush();
});

btnUnsubscribe.addEventListener("click", () => {
  confirmDialog.showModal();
});

btnCancelUnsubscribe.addEventListener("click", () => {
  confirmDialog.close();
});

btnConfirmUnsubscribe.addEventListener("click", () => {
  confirmDialog.close();
  void performUnsubscribe();
});

notifyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendWebPush(0);
});

btnSendDelayed.addEventListener("click", () => {
  void sendWebPush(5);
});

btnSendLocal.addEventListener("click", () => {
  void sendLocalNotification();
});

// Boot
initInstallPrompt();
void initServiceWorkerAndState();
