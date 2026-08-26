# AP0b – Handoff: Worker-Skeleton

Übergabe für den ersten Umsetzungsschritt in AP0. Ziel ist ausschließlich ein leeres,
deploybares Gerüst – keine Fachlogik, keine Datenbank, kein Design.

## Ziel und Definition of Done

Ein Next.js-Worker läuft in zwei Umgebungen auf Cloudflare, `/api/health` antwortet in
beiden, das Deployment kommt aus der CI.

Fertig, wenn:

- `pnpm dev` lokal läuft
- `wrangler deploy` Production und Preview hochbringt
- `/api/health` in beiden Umgebungen das erwartete JSON liefert

## Stack

Next.js (App Router, aktuelle stabile Version mit OpenNext-Unterstützung),
`@opennextjs/cloudflare`, Wrangler, TypeScript, pnpm.

## Struktur

```
apps/web/              Next.js-App, wird als Worker deployt
packages/rechenkern/   reines TypeScript, keine DB-Abhängigkeit,
                       vorerst nur Typen und Vitest-Setup
docs/                  Handoff- und Konzeptdokumente
pnpm-workspace.yaml
.github/workflows/deploy.yml
```

Das Monorepo entsteht bewusst sofort: Der Rechenkern für Scoring, Baureihen-Sweep und
Logistik muss ohne Infrastruktur testbar bleiben. Ihn später aus der Web-Hülle
herauszulösen kostet mehr, als ihn jetzt getrennt anzulegen.

## Konfiguration

- `apps/web/wrangler.jsonc`: `name` = `bhyo-markt`, `compatibility_flags` =
  `["nodejs_compat"]`, aktuelles `compatibility_date`
- Zwei Umgebungen: top-level = Production, `env.preview` = `bhyo-markt-preview`
- Deploy-Skript: `opennextjs-cloudflare build && wrangler deploy`

## Routen

| Route | Inhalt |
| --- | --- |
| `/api/health` | JSON mit Status, Commit-SHA, Umgebung und Zeit. Kein Datenbankzugriff, keine Secrets, keine Nutzerdaten – die Route wird später ggf. per Service Token oder eng begrenztem Bypass für das Monitoring freigegeben. |
| `/` | Minimale Platzhalterseite. Kein Design, kein Liquid Glass in diesem Paket. |

## CI

- Push auf `main` deployt Production, ein Pull Request deployt Preview
- Repo-Secrets `CLOUDFLARE_API_TOKEN` (Scope: Workers Scripts Edit) und
  `CLOUDFLARE_ACCOUNT_ID`; keine Secrets im Repo
- Commit-SHA als Build-Variable in die Health-Route reichen

## Nicht in diesem Paket

Authentifizierungscode (übernimmt Cloudflare Access), Datenbank und Drizzle,
Datenmodell, UI-Design, Rechenlogik.

## Folgeschritt nach dem Deployment

Reihenfolge zwingend: erst Worker deployen, dann Access im Dashboard auf den Worker
legen (Policy „Access with bhyo"), erst danach die Token-Validierung bauen – vorher
existiert kein Token zum Testen.

Die Middleware prüft `Cf-Access-Jwt-Assertion` gegen
`https://bhyo.cloudflareaccess.com/cdn-cgi/access/certs`; `/api/me` gibt die eingeloggte
E-Mail zurück. Für die lokale Entwicklung über ein Env-Flag abschaltbar. Dem Header ohne
Signaturprüfung zu vertrauen ist die klassische Lücke, sobald der Worker auf irgendeinem
Weg ohne Access erreichbar ist.

Zu beachten: Access schützt auch die Preview-URLs. Testet die CI später gegen eine
Preview, braucht sie ein Service Token – derselbe Punkt wie beim Health-Check.
