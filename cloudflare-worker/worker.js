// Cloudflare Worker for vacature-tracker push subscriptions.
// Mirrors the pattern used in eclipse2026/cloudflare-worker: the browser can't write
// to the GitHub repo directly (no credentials, and it shouldn't have any), so this
// Worker is the thin authenticated backend that receives subscribe/unsubscribe calls
// from the site and persists them into subscriptions.json via the GitHub Contents API.
//
// Required Worker secrets (set via `wrangler secret put` or the Cloudflare dashboard,
// never committed to the repo):
//   GITHUB_TOKEN   - a GitHub Personal Access Token with `repo` scope (fine-grained:
//                    Contents read/write on this repo only)
//
// Required Worker vars (plain, non-secret):
//   GITHUB_OWNER   = "arjen-rave"
//   GITHUB_REPO    = "vacature-tracker"
//   GITHUB_BRANCH  = "main"
//   ALLOWED_ORIGIN = "https://arjen-rave.github.io"

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS(origin) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS(origin) });
    }

    try {
      if (url.pathname === "/subscribe") {
        const sub = await request.json();
        if (!sub || !sub.endpoint) {
          return new Response("Invalid subscription", { status: 400, headers: CORS_HEADERS(origin) });
        }
        await updateSubscriptions(env, (subs) => {
          const exists = subs.some((s) => s.endpoint === sub.endpoint);
          return exists ? subs : [...subs, sub];
        });
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      if (url.pathname === "/unsubscribe") {
        const { endpoint } = await request.json();
        await updateSubscriptions(env, (subs) => subs.filter((s) => s.endpoint !== endpoint));
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      return new Response("Not found", { status: 404, headers: CORS_HEADERS(origin) });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500, headers: CORS_HEADERS(origin) });
    }
  }
};

async function updateSubscriptions(env, mutate) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const filePath = "subscriptions.json";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;

  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "vacature-tracker-worker",
    Accept: "application/vnd.github+json"
  };

  // Retry a few times in case of a concurrent write racing with the daily
  // GitHub Action commit (same conflict window as eclipse2026's Worker/Action pair).
  for (let attempt = 1; attempt <= 3; attempt++) {
    const getRes = await fetch(apiUrl, { headers: ghHeaders });
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const current = await getRes.json();
    const currentSubs = JSON.parse(atob(current.content));
    const nextSubs = mutate(currentSubs);

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update push subscriptions [skip ci]",
        content: btoa(JSON.stringify(nextSubs, null, 2)),
        sha: current.sha,
        branch
      })
    });

    if (putRes.ok) return;
    if (putRes.status !== 409 && putRes.status !== 422) {
      throw new Error(`GitHub PUT failed: ${putRes.status}`);
    }
    // 409/422 usually means sha mismatch (someone else wrote in between) — retry.
    await new Promise((r) => setTimeout(r, attempt * 500));
  }
  throw new Error("Failed to update subscriptions.json after 3 attempts (conflict).");
}
