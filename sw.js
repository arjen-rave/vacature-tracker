// VAPID public key and worker URL are duplicated here (also in index.html) because
// this file runs in the service worker scope, not the page scope, and needs its own
// copy to handle pushsubscriptionchange. The public key is, as the name says, public
// — safe to embed client-side.
const VAPID_PUBLIC_KEY = "BJaeAvCGohpg7Q2DHrdqWZnvp3nCWE0T5jWispamQAkVsRPJlJel1GxRcUTu3EmGcLrS1EbZBB9Du5BBo86sw0c";
const WORKER_URL = "https://vacature-tracker-subscribe.arjen-ravestein.workers.dev";

// APP_VERSION must be bumped every time index.html/manifest.json/icons change,
// so the cache name below changes too — that's what forces old, stale assets
// out and a fresh copy in. Keep this in sync with the "v1.4" footer in index.html.
const APP_VERSION = "1.4";
const CACHE = `vacature-tracker-v${APP_VERSION}`;
const ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png"
];

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Precache the app shell on install, and activate this version immediately
// instead of waiting for all tabs to close — combined with clients.claim()
// below, that means a deploy takes effect on the very next page load instead
// of silently waiting in the background.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// On activate, delete every cache that isn't this version's — this is the
// actual "cache update" mechanism: bump APP_VERSION, the old vacature-tracker-vX
// cache gets removed here on the next visit, so nothing stale lingers.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for the precached app shell: serve instantly from
// cache if available (fast + works offline), but always also fetch a fresh
// copy in the background and update the cache for next time. data.json is
// deliberately excluded — the page already fetches it with cache:"no-store",
// and the tracker must never show yesterday's vacatures from a cached copy.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("data.json")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Vacature-tracker", body: "De tracker is bijgewerkt." };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    // ignore malformed payload, fall back to default
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(clients.openWindow(url));
});

// Chrome/Android periodically rotate the underlying push registration in the
// background (normal FCM behaviour), which silently invalidates the old
// subscription. Without this handler, the site never learns about it: the new
// subscription just sits locally on the device and nothing tells our server,
// so the old (now-dead) endpoint keeps accumulating in subscriptions.json and
// pushes silently stop arriving. This re-subscribes automatically and swaps
// the old endpoint for the new one server-side, closing that gap.
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;

  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      .then((newSub) =>
        fetch(WORKER_URL + "/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub),
        }).then(() => {
          if (oldEndpoint) {
            return fetch(WORKER_URL + "/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: oldEndpoint }),
            });
          }
        })
      )
      .catch((err) => {
        // Nothing we can do from here but avoid an unhandled rejection —
        // worst case the old subscription is cleaned up on the next manual
        // uitzetten/aanzetten toggle or the next daily-check push failure log.
        console.error("pushsubscriptionchange handling failed:", err);
      })
  );
});
