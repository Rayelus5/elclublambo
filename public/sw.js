// Service worker for Web Push. Payload: { title, body, url, tag }. The server only sends text it has already
// checked against the recipient's visibility; this file never fetches or caches anything.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeUrl(raw) {
  // Same origin only: anything else (other origin, javascript:, data:) falls back to the home page.
  try {
    const target = new URL(typeof raw === "string" ? raw : "/", self.location.origin);
    return target.origin === self.location.origin ? target : new URL("/", self.location.origin);
  } catch {
    return new URL("/", self.location.origin);
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  // JSON `null`, numbers, strings and booleans parse fine but are not a payload object.
  if (!payload || typeof payload !== "object") payload = {};
  const title = typeof payload.title === "string" && payload.title ? payload.title : "El Club Lambo";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    data: { url: safeUrl(payload.url).href },
    icon: "/favicon.ico",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target.href);
            } catch {
              // navigation is best-effort
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target.href);
    }),
  );
});
