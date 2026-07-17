// Sends a push reminder to everyone in subscriptions.json.
// Triggered manually via workflow_dispatch — either by Arjen (GitHub web/app),
// or automatically by the Cowork "vacature-tracker-daily-check" scheduled task,
// which only clicks "Run workflow" on days where the active vacancy list actually
// changed (addition, removal, or a repost). GitHub's own `schedule:` cron trigger
// was tried first but proved unreliable (two consecutive missed mornings with no
// visible error) and was dropped in favor of this event-driven trigger — which
// also avoids sending a pointless "nothing changed" notification every day.
// Reads subscriptions written by the Cloudflare Worker (cloudflare-worker/worker.js);
// does not modify subscriptions.json itself (unlike eclipse2026's reminder script,
// there's no per-user "already sent" state to track here — it's a single blast per trigger).
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SITE_URL = process.env.SITE_URL || "https://arjen-rave.github.io/vacature-tracker/";
const TEST_SEND = process.env.TEST_SEND === "true";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets.");
  process.exit(1);
}

webpush.setVapidDetails("mailto:arjen.ravestein@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const repoRoot = path.resolve(__dirname, "..", "..");
const subsPath = path.join(repoRoot, "subscriptions.json");
const dataPath = path.join(repoRoot, "data.json");

const subscriptions = fs.existsSync(subsPath) ? JSON.parse(fs.readFileSync(subsPath, "utf8")) : [];

if (subscriptions.length === 0) {
  console.log("No subscribers yet, nothing to send.");
  process.exit(0);
}

let activeCount = 0;
try {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  activeCount = (data.active || []).length;
} catch (e) {
  console.warn("Could not read data.json for active count:", e.message);
}

const body = TEST_SEND
  ? "Testmelding — vacature-tracker werkt."
  : activeCount > 0
    ? `${activeCount} actieve vacature(s) in de tracker. Bekijk de site.`
    : "Vacature-tracker is bijgewerkt. Bekijk de site voor de laatste stand.";

const payload = JSON.stringify({
  title: "Vacature-tracker",
  body,
  url: SITE_URL
});

(async () => {
  let sent = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      failed++;
      console.error("Push failed for a subscriber:", err.statusCode || err.message);
    }
  }
  console.log(`Done. Sent: ${sent}, failed: ${failed}, total subscribers: ${subscriptions.length}`);
})();
