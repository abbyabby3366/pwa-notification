self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let title = "PWA Push Notification";
  let body = "Push received from server.";
  let url = "/";
  let sentAt = new Date().toISOString();

  if (event.data) {
    try {
      const data = event.data.json();
      if (typeof data.title === "string" && data.title.length > 0) {
        title = data.title;
      }
      if (typeof data.body === "string" && data.body.length > 0) {
        body = data.body;
      }
      if (typeof data.url === "string" && data.url.length > 0) {
        url = data.url;
      }
      if (typeof data.sentAt === "string") {
        sentAt = data.sentAt;
      }
    } catch {
      const text = event.data.text();
      if (text) {
        body = text;
      }
    }
  }

  const showPromise = self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url, sentAt },
  });

  const notifyClientsPromise = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({
          type: "PUSH_RECEIVED",
          title,
          body,
          receivedAt: new Date().toISOString(),
        });
      }
    });

  event.waitUntil(Promise.all([showPromise, notifyClientsPromise]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
