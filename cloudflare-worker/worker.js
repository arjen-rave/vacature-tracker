// Cloudflare Worker for vacature-tracker push subscriptions and status updates.
// Mirrors the pattern used in eclipse2026/cloudflare-worker: the browser can't write
// to the GitHub repo directly (no credentials, and it shouldn't have any), so this
// Worker is the thin authenticated backend that receives subscribe/unsubscribe/
// status-update calls from the site and persists them via the GitHub Contents API.
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

const VALID_STATUSES = [
  "Niet gesolliciteerd",
  "Gesolliciteerd",
  "Sollicitatie begonnen",
  "Afgewezen",
  "Aanbod",
  "Niet interessant"
];

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
        await updateJsonFile(env, "subscriptions.json", (subs) => {
          const exists = subs.some((s) => s.endpoint === sub.endpoint);
          return exists ? subs : [...subs, sub];
        });
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      if (url.pathname === "/unsubscribe") {
        const { endpoint } = await request.json();
        await updateJsonFile(env, "subscriptions.json", (subs) => subs.filter((s) => s.endpoint !== endpoint));
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      // /update-status: called from the site when Arjen changes a vacancy's
      // "Sollicitatie status" dropdown. Persists straight into data.json's
      // active array, matched by link (unique per vacancy). This is the only
      // write path into data.json that doesn't go through the daily-check
      // scheduled task — everything else about data.json stays untouched here.
      // Note: it deliberately does NOT move "Afgewezen"/"Niet interessant"
      // items to the archive itself — that happens the next time the daily-check
      // task runs (see SKILL.md), keeping this endpoint a simple, fast write.
      if (url.pathname === "/update-status") {
        const { link, status } = await request.json();
        if (!link || !VALID_STATUSES.includes(status)) {
          return new Response("Invalid link or status", { status: 400, headers: CORS_HEADERS(origin) });
        }
        let matched = false;
        await updateJsonFile(env, "data.json", (data) => {
          const active = data.active || [];
          const idx = active.findIndex((item) => item.link === link);
          if (idx === -1) {
            matched = false;
            return data;
          }
          matched = true;
          active[idx] = { ...active[idx], status };
          return { ...data, active };
        });
        if (!matched) {
          return new Response("Vacancy not found in active list", { status: 404, headers: CORS_HEADERS(origin) });
        }
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      return new Response("Not found", { status: 404, headers: CORS_HEADERS(origin) });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500, headers: CORS_HEADERS(origin) });
    }
  }
};

// Generic GET-mutate-PUT-with-sha helper against the GitHub Contents API, used
// for both subscriptions.json and data.json. Retries on 409/422 (sha mismatch,
// i.e. someone else — usually the daily-check Action — wrote in between).
async function updateJsonFile(env, filePath, mutate) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;

  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "vacature-tracker-worker",
    Accept: "application/vnd.github+json"
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const getRes = await fetch(apiUrl, { headers: ghHeaders });
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const current = await getRes.json();
    // decodeURIComponent/escape trick handles UTF-8 (Dutch diacritics, €, etc.)
    // correctly when going through atob/btoa, which are Latin1-only otherwise.
    const currentContent = JSON.parse(decodeURIComponent(escape(atob(current.content))));
    const nextContent = mutate(currentContent);

    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(nextContent, null, 2))));

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Update ${filePath} via worker [skip ci]`,
        content: encoded,
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
  throw new Error(`Failed to update ${filePath} after 3 attempts (conflict).`);
}
