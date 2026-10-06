/* Calltime service worker: Web Push only (no offline caching). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Calltime", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Calltime";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/home" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/home", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url === target && "focus" in client) return client.focus();
      }
      const same = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (same && "navigate" in same) {
        await same.navigate(target);
        return same.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
