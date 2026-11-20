(() => {
  if (window.__PWA_INJECTED__) return;
  window.__PWA_INJECTED__ = true;

  const isIos = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function createToastContainer() {
    let el = document.getElementById("__pwa-widget-root");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__pwa-widget-root";
    el.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:calc(env(safe-area-inset-bottom, 0px) + 14px)",
      "z-index:2147483647",
      "display:flex",
      "flex-direction:column",
      "align-items:flex-end",
      "gap:8px",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "max-width:calc(100vw - 28px)",
    ].join(";");
    document.body.appendChild(el);
    return el;
  }

  function showNotice(text, isError) {
    const root = createToastContainer();
    const msg = document.createElement("div");
    msg.setAttribute("role", isError ? "alert" : "status");
    msg.textContent = text;
    msg.style.cssText = [
      "padding:10px 14px",
      "border-radius:12px",
      "font-size:13px",
      "line-height:1.4",
      "max-width:300px",
      "box-shadow:0 10px 28px rgba(0,0,0,0.35)",
      isError
        ? "background:#7f1d1d;color:#fecaca;border:1px solid rgba(248,113,113,0.45)"
        : "background:#064e3b;color:#d1fae5;border:1px solid rgba(52,211,153,0.45)",
    ].join(";");
    root.appendChild(msg);
    setTimeout(() => msg.remove(), isError ? 6000 : 3500);
  }

  function renderFloatingButton(label, onClick, dismissKey) {
    if (dismissKey && sessionStorage.getItem(dismissKey) === "1") return;
    const root = createToastContainer();

    const wrap = document.createElement("div");
    wrap.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:6px",
      "background:#0f172a",
      "color:#f8fafc",
      "border:1px solid rgba(148,163,184,0.3)",
      "border-radius:999px",
      "padding:4px 6px 4px 12px",
      "box-shadow:0 10px 28px rgba(0,0,0,0.4)",
    ].join(";");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = [
      "appearance:none",
      "border:none",
      "background:transparent",
      "color:#f8fafc",
      "font:600 13px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "padding:8px 6px",
      "cursor:pointer",
    ].join(";");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = [
      "appearance:none",
      "border:none",
      "background:rgba(148,163,184,0.18)",
      "color:#cbd5e1",
      "width:26px",
      "height:26px",
      "border-radius:999px",
      "font-size:16px",
      "line-height:1",
      "cursor:pointer",
    ].join(";");

    closeBtn.addEventListener("click", () => {
      if (dismissKey) sessionStorage.setItem(dismissKey, "1");
      wrap.remove();
    });

    btn.addEventListener("click", () => onClick(wrap, btn));
    wrap.append(btn, closeBtn);
    root.appendChild(wrap);
  }

  async function init() {
    if (!("serviceWorker" in navigator)) return;

    let registration;
    try {
      registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    } catch (err) {
      showNotice(`Service Worker error: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }

    if (isIos() && !isStandalone()) {
      renderFloatingButton(
        "Install for Alerts",
        () => {
          showNotice(
            "In Safari, tap Share → Add to Home Screen, then open from your Home Screen to enable notifications.",
            false
          );
        },
        "__pwa_ios_hint_dismissed"
      );
      return;
    }

    if (!("Notification" in window) || !("PushManager" in window)) {
      return;
    }

    const existingSub = await registration.pushManager.getSubscription();
    if (existingSub && Notification.permission === "granted") {
      try {
        await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: existingSub.toJSON() }),
        });
      } catch {
        // Non-fatal background re-sync
      }
      return;
    }

    renderFloatingButton("Enable Notifications", async (wrap, btn) => {
      btn.disabled = true;
      btn.textContent = "Enabling…";
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          showNotice(
            `Permission "${permission}". On iOS, re-enable in Settings → Notifications.`,
            true
          );
          btn.disabled = false;
          btn.textContent = "Enable Notifications";
          return;
        }

        const keyRes = await fetch("/api/vapid-public-key");
        if (!keyRes.ok) {
          throw new Error(`Failed to fetch VAPID key (HTTP ${keyRes.status})`);
        }
        const { publicKey } = await keyRes.json();
        if (!publicKey) {
          throw new Error("Server returned empty VAPID public key.");
        }

        let sub = await registration.pushManager.getSubscription();
        if (!sub) {
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }

        const saveRes = await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok || !saveData.ok) {
          throw new Error(saveData.error || `HTTP ${saveRes.status}`);
        }

        wrap.remove();
        showNotice("Notifications enabled for this device!", false);
      } catch (err) {
        showNotice(
          `Could not enable notifications: ${err instanceof Error ? err.message : String(err)}`,
          true
        );
        btn.disabled = false;
        btn.textContent = "Enable Notifications";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
