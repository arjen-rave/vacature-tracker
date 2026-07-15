# vacature-tracker

Dagelijkse vacature-tracker voor senior strategisch/adviserende rollen bij TSO's/netbeheerders en
grote duurzame energieproducenten. Gebouwd naar het patroon van [eclipse2026](https://github.com/arjen-rave/eclipse2026):
statische site op GitHub Pages, pushmeldingen via een Cloudflare Worker + web-push, dagelijkse
opdracht via GitHub Actions.

## Onderdelen

- `index.html`, `data.json`, `sw.js`, `manifest.json` — de site zelf (GitHub Pages).
- `subscriptions.json` — pushsubscripties, wordt geschreven door de Cloudflare Worker.
- `.github/workflows/send-push.yml` — dagelijkse cron (07:00 UTC / 09:00 Amsterdam) die iedereen
  in `subscriptions.json` een pushmelding stuurt.
- `cloudflare-worker/worker.js` — ontvangt subscribe/unsubscribe-verzoeken vanaf de site en
  schrijft `subscriptions.json` terug naar dit repo via de GitHub API.

## Data bijwerken

`data.json` wordt dagelijks bijgewerkt door een Cowork scheduled task (Claude), die de
vacaturesites checkt (inclusief JS-gerenderde sites via Claude in Chrome) en het resultaat
commit vóór 09:00 Amsterdamse tijd.

## Eenmalige setup (door Arjen)

1. GitHub Secrets toevoegen (Settings → Secrets and variables → Actions):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
2. Cloudflare Worker deployen met `cloudflare-worker/worker.js`, en daar als secret een
   GitHub Personal Access Token (scope: `repo`) instellen onder de naam `GITHUB_TOKEN`, plus
   dezelfde VAPID-keys.
3. `WORKER_URL` en `VAPID_PUBLIC_KEY` in `index.html` invullen met de echte waarden.
4. GitHub Pages aanzetten op de `main`-branch (Settings → Pages).
