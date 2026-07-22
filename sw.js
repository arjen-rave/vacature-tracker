// VAPID public key and worker URL are duplicated here (also in index.html) because
// this file runs in the service worker scope, not the page scope, and needs its own
// copy to handle pushsubscriptionchange. The public key is, as the name says, public
// — safe to embed client-side.
const VAPID_PUBLIC_KEY = "BJaeAvCGohpg7Q2DHrdqWZnvp3nCWE0T5jWispamQAkVsRPJlJel1GxRcUTu3EmGcLrS1EbZBB9Du5BBo86sw0c";
const WORKER_URL = "https://vacature-tracker-subscribe.arjen-ravestein.workers.dev";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

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
