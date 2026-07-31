# vacature-tracker

Dagelijkse vacature-tracker voor senior strategisch/adviserende rollen bij TSO's/netbeheerders en
grote duurzame energieproducenten. Gebouwd naar het patroon van [eclipse2026](https://github.com/arjen-rave/eclipse2026):
statische site op GitHub Pages, pushmeldingen via een Cloudflare Worker + web-push, dagelijkse
opdracht via een Cowork scheduled task.

## Onderdelen

- `index.html`, `data.json`, `sw.js`, `manifest.json` — de site zelf (GitHub Pages). De actieve/
  archief/niet-controleerbare lijsten worden getoond als uitklapbare kaarten (mobielvriendelijk,
  geen brede tabellen). Elke actieve kaart heeft een "Sollicitatie status"-dropdown die direct
  naar `data.json` schrijft via de Cloudflare Worker.
- `subscriptions.json` — pushsubscripties, wordt geschreven door de Cloudflare Worker.
- `.github/workflows/send-push.yml` — verstuurt een pushmelding naar iedereen in
  `subscriptions.json`. Wordt getriggerd via `workflow_dispatch` door de dagelijkse
  Cowork-taak, bij élke succesvolle run — dus ook op dagen zonder nieuwe vacatures.
  Dat is bewust: de melding is Arjens signaal dat de data van vandaag vers is, niet
  alleen een "er is iets nieuws"-alarm. Draait niet meer op een `schedule:`-cron:
  die bleek voor dit repo onbetrouwbaar (meerdere ochtenden zonder enige automatische
  run, ondanks correcte configuratie). Kan ook altijd handmatig getriggerd worden,
  ook vanaf de telefoon via de GitHub-app/mobiele site.
- `cloudflare-worker/worker.js` — ontvangt drie soorten verzoeken vanaf de site en schrijft
  terug naar dit repo via de GitHub API:
  - `POST /subscribe`, `POST /unsubscribe` — pushsubscripties, schrijven naar `subscriptions.json`.
  - `POST /update-status` — Arjens handmatige wijziging van de "Sollicitatie status"-dropdown
    op een actieve vacature (`{ link, status }`), schrijft direct naar het bijbehorende item
    in `data.json`. Verplaatst een vacature bewust NIET meteen naar het archief als de status
    "Afgewezen" of "Niet interessant" wordt — dat gebeurt pas bij de eerstvolgende dagelijkse
    check (zie hieronder), zodat dit endpoint simpel en snel blijft.

## Data bijwerken

`data.json` wordt dagelijks bijgewerkt door een Cowork scheduled task (Claude), die de
vacaturesites checkt (inclusief JS-gerenderde sites via Claude in Chrome), 2-4 Engelse tags per
actieve vacature toekent, vacatures met status "Afgewezen"/"Niet interessant" naar het archief
verplaatst, het resultaat commit, en daarna altijd de pushmelding triggert — als bevestiging dat
de check die dag daadwerkelijk heeft gedraaid en de site actueel is.

Omdat Arjen via de site op elk moment zelf een status kan wijzigen (buiten de dagelijkse taak om,
rechtstreeks via de Worker), leest de dagelijkse taak `data.json` vlak vóór het schrijven van zijn
eigen commit nogmaals opnieuw in, om een race condition met een status-wijziging van diezelfde
dag te voorkomen.

## data.json schema

```json
{
  "lastUpdated": "<ISO-timestamp met +02:00>",
  "active": [
    {
      "bedrijf": "",
      "titel": "",
      "link": "",
      "beschrijving": "",
      "fit": "",
      "status": "Niet gesolliciteerd | Gesolliciteerd | Sollicitatie begonnen | Afgewezen | Aanbod | Niet interessant",
      "tags": ["energy", "strategy", "..."]
    }
  ],
  "archive": [
    { "bedrijf": "", "titel": "", "reden": "", "datum": "YYYY-MM-DD" }
  ],
  "notControlled": [
    { "bedrijf": "", "titel": "", "reden": "", "link": "" }
  ]
}
```

## Eenmalige setup (door Arjen)

1. GitHub Secrets toevoegen (Settings → Secrets and variables → Actions):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
2. Cloudflare Worker deployen met `cloudflare-worker/worker.js`, en daar als secret een
   GitHub Personal Access Token (scope: `repo`) instellen onder de naam `GITHUB_TOKEN`, plus
   dezelfde VAPID-keys.
3. `WORKER_URL` en `VAPID_PUBLIC_KEY` in `index.html` invullen met de echte waarden.
4. GitHub Pages aanzetten op de `main`-branch (Settings → Pages).

### Belangrijk: Worker moet handmatig opnieuw gedeployed worden

`cloudflare-worker/worker.js` is bijgewerkt met het nieuwe `/update-status`-endpoint (voor de
status-dropdown op de site). Deze wijziging staat alleen in de broncode in dit repo — Cloudflare
Workers worden niet automatisch herdeployed vanuit GitHub. Arjen moet de nieuwe versie van
`worker.js` zelf opnieuw deployen (via `wrangler deploy` of door de code te plakken in de
Cloudflare dashboard-editor voor deze Worker) vóórdat de status-dropdown op de site echt werkt.
Tot die tijd geeft de dropdown een foutmelding ("Opslaan mislukt: Worker gaf status 404") omdat
de live Worker het `/update-status`-pad nog niet kent.
