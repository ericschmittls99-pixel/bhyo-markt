# AP0a – Ablauf und Prompts für die Coding-Umgebung

Reihenfolge einhalten: die manuellen Schritte dazwischen sind Voraussetzung für den
jeweils nächsten Prompt.

## Schritt 1 · Voraussetzungen (Eric, Terminal)

```
node -v      # 20 oder neuer
pnpm -v      # sonst: corepack enable && corepack prepare pnpm@latest --activate
gh auth status   # optional, für das GitHub-Repo
```

## Schritt 2 · Git und GitHub (Prompt)

> Initialisiere hier ein Git-Repository und lege einen `.gitignore` für ein
> pnpm/Next.js/Cloudflare-Projekt an (`node_modules`, `.next`, `.open-next`,
> `.wrangler`, `.dev.vars`, `.DS_Store`). Erster Commit mit `CLAUDE.md` und `docs/`.
> Lege danach mit `gh` ein **privates** Repo `bhyo-markt` an und pushe `main`.
> Falls `gh` nicht verfügbar ist, sag mir die manuellen Schritte statt zu raten.

## Schritt 3 · Grundgerüst (Prompt)

> Lies `CLAUDE.md` und `docs/ap0a-worker-skeleton.md`.
>
> Setze ausschließlich das Grundgerüst um: pnpm-Workspace mit `apps/web`
> (Next.js App Router + `@opennextjs/cloudflare`) und `packages/rechenkern`
> (leeres TypeScript-Package mit Vitest, exportiert `RECHENKERN_VERSION`).
> `apps/web/wrangler.jsonc` mit `nodejs_compat`, aktuellem `compatibility_date`,
> Worker-Name `bhyo-markt` und zweiter Umgebung `preview` (`bhyo-markt-preview`).
>
> Routen: `/api/health` liefert JSON mit `status`, `commit` (Build-Variable, lokal
> `"dev"`), `env` und Zeit. `/` ist eine minimale Platzhalterseite ohne Design.
>
> Kein Auth-Code, keine Datenbank, kein Drizzle, kein Design-System.
>
> Prüfe selbst: `pnpm install` läuft, der Dev-Server startet, `/api/health`
> antwortet lokal, die Tests im Rechenkern laufen durch. Zeig mir danach die
> Dateiliste und den Inhalt von `wrangler.jsonc`.

## Schritt 4 · Cloudflare-Anmeldung (Eric, Terminal)

```
pnpm dlx wrangler login     # Browser-OAuth, reicht für den ersten Deploy
pnpm dlx wrangler whoami    # Account-ID notieren
```

## Schritt 5 · Erstes Deployment (Prompt)

> Ich bin lokal per `wrangler login` authentifiziert. Deploye Production und
> Preview, nenne mir beide URLs und prüfe per `curl`, dass `/api/health` in beiden
> mit 200 und dem erwarteten JSON antwortet.

## Schritt 6 · Access aktivieren (Eric, Dashboard)

1. Zero Trust → Access → Worker `bhyo-markt` auswählen, Sign-in erzwingen,
   Previews **und** Production schützen
2. Policy „Access with bhyo" zuweisen: Include `Emails ending in @bhyo.de`,
   zweiter Include-Eintrag mit externen Einzeladressen, Session 24 h,
   keine Require-Regel solange One-Time-PIN der einzige Login-Weg ist
3. Test im Inkognito-Fenster: eigene Adresse kommt rein, fremde wird abgewiesen

## Schritt 7 · Token-Validierung (Prompt, erst nach Schritt 6)

> Access ist jetzt auf dem Worker aktiv, Team-Domain `bhyo.cloudflareaccess.com`.
>
> Baue die serverseitige Validierung: Middleware prüft den Header
> `Cf-Access-Jwt-Assertion` gegen
> `https://bhyo.cloudflareaccess.com/cdn-cgi/access/certs` — Signatur, `aud`, `iss`
> und Ablauf, JWKS mit Cache. Die verifizierte E-Mail wird als Request-Kontext
> bereitgestellt. `/api/me` gibt sie zurück, ohne gültiges Token 403.
>
> Für die lokale Entwicklung über eine Env-Variable abschaltbar, die in Production
> nie greifen darf. Tests für gültiges, abgelaufenes und manipuliertes Token.

## Schritt 8 · CI (Prompt)

Vorher im GitHub-Repo hinterlegen: Settings → Secrets and variables → Actions →
`CLOUDFLARE_API_TOKEN` (Cloudflare-Dashboard → My Profile → API Tokens → Template
„Edit Cloudflare Workers", sonst Custom Token mit *Workers Scripts: Edit*) und
`CLOUDFLARE_ACCOUNT_ID`.

> Lege `.github/workflows/deploy.yml` an: Push auf `main` deployt Production, Pull
> Requests deployen Preview. Nutze `CLOUDFLARE_API_TOKEN` und
> `CLOUDFLARE_ACCOUNT_ID` aus den Repo-Secrets und reiche den Commit-SHA als
> Build-Variable in die Health-Route. Keine Secrets und keine Account-IDs im Klartext
> in der Workflow-Datei.

## Fertig, wenn

Login funktioniert auf Production und Preview, eine fremde Adresse wird abgewiesen,
`/api/me` liefert die eingeloggte E-Mail, und ein Push auf `main` deployt automatisch.

Danach folgt der Neon-Teil von AP0: Datenbank, Drizzle-Setup, Migration 0001 mit den
drei Enums aus `docs/ap0-schema-entscheidungen.md`, Backup und Restore-Test.
