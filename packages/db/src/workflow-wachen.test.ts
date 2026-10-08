/**
 * Review Eric (24.09.2026): Das Deploy-Ziel darf nicht allein am Event
 * haengen — ein workflow_dispatch auf einem Feature-Branch haette
 * ungeprueften Code nach Production geschoben. Die `ziel-wache` in
 * deploy.yml schliesst das; dieser Test haelt die Verdrahtung fest.
 *
 * Der bestellte Dispatch-Versuch von einem Wegwerf-Branch ist der Beweis,
 * dass die Wache greift — aber er laeuft einmal von Hand. Dauerhaft geprueft
 * wird hier: dass die Wache existiert und dass Gate und Deploy wirklich an
 * ihr haengen. Besonders die `if`-Bedingung des Deploy-Jobs, denn sie beginnt
 * mit `always()` — ohne die ausdrueckliche Abfrage von
 * `needs.ziel-wache.result` liefe der Deploy trotz roter Wache weiter, und
 * `needs` allein waere wirkungslos.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);

describe("deploy.yml: Production nur von main", () => {
  it("hat den Job ziel-wache", () => {
    expect(workflow).toMatch(/^ {2}ziel-wache:$/m);
  });

  it("prueft den Ref gegen refs/heads/main und bricht sonst ab", () => {
    expect(workflow).toContain('"$REF" != "refs/heads/main"');
    expect(workflow).toMatch(/PRODUCTION NUR VON MAIN/);
    // Preview bleibt fuer beliebige Branches erlaubt.
    expect(workflow).toContain('"$EVENT" = "pull_request"');
  });

  it("macht die Wache zur Vorbedingung von schema-gate und deploy", () => {
    expect(workflow).toContain("needs: [typen-und-tests, ziel-wache]");
    // E68 PR 1: deploy wartet zusaetzlich auf die Wegwerf-DB (Migrationen auf leer + PLZ-Kette).
    expect(workflow).toContain("needs: [typen-und-tests, ziel-wache, schema-gate, wegwerf-db]");
  });

  it("fragt das Ergebnis der Wache trotz always() ausdruecklich ab", () => {
    expect(workflow).toContain("needs.ziel-wache.result == 'success'");
  });
});

describe("migrate-production.yml: Migration nur von main", () => {
  const migrate = readFileSync(
    new URL("../../../.github/workflows/migrate-production.yml", import.meta.url),
    "utf8",
  );

  it("hat den Job ziel-wache und prueft den Ref", () => {
    expect(migrate).toMatch(/^ {2}ziel-wache:$/m);
    expect(migrate).toContain('"$REF" != "refs/heads/main"');
    expect(migrate).toMatch(/MIGRATION NUR VON MAIN/);
  });

  it("laeuft ohne Environment — sonst greift die Branch-Policy vorher und die Meldung bleibt aus", () => {
    const wache = migrate.slice(migrate.indexOf("  ziel-wache:"), migrate.indexOf("  migrate:"));
    expect(wache).not.toContain("environment:");
  });

  it("macht die Wache zur Vorbedingung des migrate-Jobs", () => {
    expect(migrate).toContain("needs: [ziel-wache]");
  });
});

describe("lese-diagnose.yml: der Leseweg", () => {
  // Ohne Kommentare: Der erklaerende Vorspann dieses Workflows NENNT die
  // ziel-wache und `main`, um zu begruenden, warum es sie hier nicht gibt.
  // Ein Guard, der daran scheitert, wird durch Umformulieren umgangen statt
  // befolgt — geprueft wird, was YAML tatsaechlich ausfuehrt.
  const leseweg = readFileSync(
    new URL("../../../.github/workflows/lese-diagnose.yml", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((z) => !/^\s*#/.test(z))
    .join("\n");

  it("laeuft im Environment production-lesend, nicht in production", () => {
    expect(leseweg).toContain("environment: production-lesend");
    // Ein Tippfehler hier waere fatal: `production` traegt die schreibende
    // Zugangsberechtigung UND die main-Policy — der Leseweg liefe dann mit
    // Schreibrechten und nur noch von main.
    expect(leseweg).not.toMatch(/environment: production\s*$/m);
  });

  it("hat bewusst KEINE Branch-Wache — er soll von jedem Branch laufen", () => {
    expect(leseweg).not.toContain("ziel-wache");
    expect(leseweg).not.toContain("refs/heads/main");
  });

  it("nutzt ausschliesslich das lesende Secret", () => {
    expect(leseweg).toContain("DATABASE_URL_PRODUCTION_LESEND");
    expect(leseweg).not.toMatch(/DATABASE_URL_PRODUCTION\s*\}\}/);
  });

  it("das Skript prueft den Schreibversuch, statt ihn zu behaupten", () => {
    const skript = readFileSync(new URL("./lese-diagnose.ts", import.meta.url), "utf8");
    expect(skript).toContain("SCHREIBVERSUCH");
    expect(skript).toContain("insert into");
    expect(skript).toContain("update ");
    // Zielnachweis im gewohnten Format, mit Rolle.
    expect(skript).toContain("LESEND host=");
  });

  it("prueft die Standardrechte gegen die migrierende Rolle", () => {
    // Review Eric (24.09.2026): Standardrechte gelten PRO VERGEBENDER ROLLE.
    // Sind sie fuer die falsche gesetzt, hat die Leserolle auf jede kuenftig
    // migrierte Tabelle kein SELECT — und das faellt genau dann auf, wenn der
    // Leseweg vor einer Migration gebraucht wird. Deshalb wird der
    // Tabellenbesitzer gelesen und mit dem Vergeber verglichen, statt ihn
    // anzunehmen.
    const skript = readFileSync(new URL("./lese-diagnose.ts", import.meta.url), "utf8");
    expect(skript).toContain("pg_default_acl");
    expect(skript).toContain("tableowner");
    expect(skript).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE");
  });
});

describe("schema-gate: Zielnachweis", () => {
  it("druckt Host und Datenbank vor dem Urteil", () => {
    const gate = readFileSync(new URL("./schema-gate.ts", import.meta.url), "utf8");
    expect(gate).toContain("GATE host=");
    expect(gate).toContain("db=");
    // Nie die ganze URL: sie traegt das Passwort.
    expect(gate).not.toMatch(/console\.log\([^)]*\$\{url\}/);
  });
});

// Haertung (29.09.2026, Punkt 3): Nach jedem main-Deploy laeuft der Leseweg
// automatisch — nur lesend, nur nach erfolgreichem Deploy, rot bei Fehlschlag.
describe("deploy.yml: Leseweg nach dem main-Deploy", () => {
  const deployYml = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const job = deployYml.slice(deployYml.indexOf("  lese-diagnose:"));
  it("haengt am deploy-Job, nur bei main-Push und nur nach Erfolg", () => {
    expect(job).toContain("needs: [deploy]");
    expect(job).toContain("github.event_name != 'pull_request' && needs.deploy.result == 'success'");
  });
  it("laeuft im Environment production-lesend und nutzt ausschliesslich das lesende Secret", () => {
    expect(job).toContain("environment: production-lesend");
    expect(job).toContain("DATABASE_URL_PRODUCTION_LESEND");
    expect(job).not.toContain("DATABASE_URL_PRODUCTION }}");
    expect(job).not.toContain("DATABASE_URL_PREVIEW");
  });
  it("fuehrt Zielnachweis, Abweichungsliste und Messung aus", () => {
    for (const s of ["lese-diagnose", "beleg-abweichung", "protokoll-messung"]) expect(job).toContain(`pnpm --filter @bhyo/db ${s}`);
  });
});

// Haertung (30.09.2026): Environments getrennt — Leseweg nur mit der Leserolle
// in production-lesend, Restore nur in neon-restore, RESTORE_DATABASE_URL ist
// entfallen (restore-test.yml entfernt).
describe("Environments: Leseweg und Restore getrennt", () => {
  const ordner = new URL("../../../.github/workflows/", import.meta.url);
  const lies = (name: string) =>
    readFileSync(new URL(name, ordner), "utf8")
      .split("\n")
      .filter((z) => !/^\s*#/.test(z))
      .join("\n");
  const restore = lies("restore-woechentlich.yml");
  const alle = readdirSync(ordner).filter((n) => n.endsWith(".yml")).map((n) => [n, lies(n)] as const);

  it("restore-woechentlich laeuft nur in neon-restore und nutzt dort nur die Neon-Secrets", () => {
    expect(restore).toContain("environment: neon-restore");
    expect(restore).not.toContain("production-lesend");
    expect(restore).not.toMatch(/environment: production\s*$/m);
    for (const s of ["NEON_API_KEY", "NEON_PROJECT_ID", "NEON_PARENT_BRANCH_ID"]) expect(restore).toContain(`secrets.${s}`);
    expect(restore).not.toContain("DATABASE_URL_PRODUCTION");
  });
  it("restore-test.yml existiert nicht mehr, kein Workflow nutzt das Secret RESTORE_DATABASE_URL", () => {
    expect(alle.map(([n]) => n)).not.toContain("restore-test.yml");
    for (const [name, inhalt] of alle) expect(inhalt, name).not.toContain("secrets.RESTORE_DATABASE_URL");
  });
  it("die Neon-Secrets liegen nur in neon-restore — kein anderer Workflow greift darauf zu", () => {
    for (const [name, inhalt] of alle) {
      if (name === "restore-woechentlich.yml") continue;
      expect(inhalt, name).not.toMatch(/secrets\.NEON_/);
    }
  });
  it("Leseweg (lese-diagnose.yml, deploy.yml) nur mit der Leserolle in production-lesend", () => {
    for (const name of ["lese-diagnose.yml", "deploy.yml"]) {
      const inhalt = lies(name);
      const ab = inhalt.indexOf("environment: production-lesend");
      expect(ab, name).toBeGreaterThan(-1);
      expect(inhalt, name).not.toMatch(/secrets\.NEON_/);
      expect(inhalt, name).not.toContain("secrets.RESTORE_DATABASE_URL");
    }
  });
});

describe("job-wache.yml: jeder Lauf prueft (Betrieb 04.10.2026)", () => {
  const wache = readFileSync(new URL("../../../.github/workflows/job-wache.yml", import.meta.url), "utf8");
  // Code ohne Kommentare — der Kopfkommentar darf die alte Sperre beim Namen nennen.
  const skript = readFileSync(new URL("./job-wache.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("keine Stundensperre: weder im Workflow (JOB_WACHE_STUNDE) noch im Skript (berlinStunde / 'prueft nicht')", () => {
    expect(wache).not.toMatch(/JOB_WACHE_STUNDE/);
    expect(skript).not.toMatch(/berlinStunde|istBerlinStunde|prueft nicht|JOB_WACHE_STUNDE/);
  });
  it("der faellige Stichtag kommt aus der reinen Funktion faelligerStichtag", () => {
    expect(skript).toMatch(/import \{ faelligerStichtag \} from "\.\/job-wache-stichtag"/);
    expect(skript).toMatch(/faelligerStichtag\(jetzt\)/);
  });
  it("jeder Fehlerpfad endet rot (exit 1/2), kein return mit Gruen vor der Pruefung", () => {
    const rumpf = skript.slice(skript.indexOf("async function main()"));
    expect(rumpf).not.toMatch(/^\s*return;\s*$/m);
    expect(skript).toMatch(/main\(\)\.catch[\s\S]*process\.exit\(2\)/);
  });
  it("mehrere Cron-Zeiten taeglich, alle auf krummen Minuten", () => {
    const crons = [...wache.matchAll(/- cron: "(\d+) (\d+) \* \* \*"/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(crons.length).toBeGreaterThanOrEqual(3);
    for (const [minute] of crons) expect(minute % 5, `Minute ${minute}`).not.toBe(0);
  });
  it("der Workflow-Name beginnt mit 'job-wache' — Erics Mail-Filter haengt am Betreff (04.10.2026)", () => {
    expect(wache).toMatch(/^name: job-wache\b/m);
  });
  it("laeuft im Environment production-lesend mit dem lesenden Secret", () => {
    expect(wache).toMatch(/environment: production-lesend/);
    expect(wache).toMatch(/DATABASE_URL_PRODUCTION_LESEND/);
    expect(wache).not.toMatch(/secrets\.DATABASE_URL_PRODUCTION\b/);
  });
});

// Regel Eric 01.10.2026: Entwuerfe (draft) bekommen keinen Preview-Deploy und keine
// Migration — nur der naechste zu mergende PR migriert die geteilte Preview.
describe("deploy.yml: Entwuerfe deployen nicht auf die Preview", () => {
  it("der deploy-Job (Migration + Preview-Deploy) ist fuer Entwuerfe ausgeschlossen", () => {
    const deployJob = workflow.slice(workflow.indexOf("\n  deploy:\n"), workflow.indexOf("\n  lese-diagnose:\n"));
    expect(deployJob).toMatch(/github\.event\.pull_request\.draft == false/);
  });
  it("ready_for_review loest den Lauf aus, damit der fertige PR die Preview bekommt", () => {
    expect(workflow).toMatch(/pull_request:\n(?:\s+#.*\n)*\s+types: \[opened, synchronize, reopened, ready_for_review, labeled\]/);
  });
  it("Migration und Preview-Deploy liegen im deploy-Job — nirgends sonst", () => {
    expect(workflow.indexOf("Migrate Preview-DB")).toBeGreaterThan(workflow.indexOf("\n  deploy:\n"));
    expect(workflow.indexOf("wrangler deploy --env preview")).toBeGreaterThan(workflow.indexOf("\n  deploy:\n"));
    expect(workflow.indexOf("Migrate Preview-DB")).toBeLessThan(workflow.indexOf("\n  lese-diagnose:\n"));
  });
});

describe("Betriebs-PR (05.10.2026): Warteschlange statt Abbruch, Freigabe als ein Skript", () => {
  const migrateWf = readFileSync(new URL("../../../.github/workflows/migrate-production.yml", import.meta.url), "utf8");
  const freigabe = readFileSync(new URL("../../../scripts/freigabe.sh", import.meta.url), "utf8");
  const mergeSicher = readFileSync(new URL("../../../scripts/merge-sicher.sh", import.meta.url), "utf8");

  // CI-Diaet (Betriebs-PR 3, 08.10.2026): Die drei folgenden Pruefungen kehren
  // den Stand vom 05.10. bewusst um — PR-Laeufe werden immer abgebrochen,
  // migrate-production loest den Deploy aus, das Gate wartet nicht mehr.
  it("deploy.yml bricht ueberholte PR-Laeufe desselben Branches ab (alle PR-Ereignisse); main wartet (CI-Diaet)", () => {
    expect(workflow).toMatch(/group: deploy-\$\{\{ github\.ref \}\}\n\s+cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    expect(workflow).not.toMatch(/cancel-in-progress: true/);
  });

  it("migrate-production.yml bleibt Warteschlange und loest nach Erfolg den Deploy von main aus (CI-Diaet)", () => {
    expect(migrateWf).toMatch(/group: migrate-production\n\s+cancel-in-progress: false/);
    expect(migrateWf).toMatch(/- name: Deploy von main ausloesen\n(?:[^\n]*\n){0,4}\s+run: gh workflow run deploy\.yml --ref main/);
    expect(migrateWf).toMatch(/actions: write/);
  });

  it("das schema-gate prueft genau einmal und endet bei Rueckstand sofort ROT mit Handlungsanweisung; DB nicht erreichbar bleibt Exit 2 (CI-Diaet)", () => {
    expect(workflow).toMatch(/if pnpm --filter @bhyo\/db schema-gate; then exit 0; fi\n\s+rc=\$\?\n\s+if \[ "\$rc" = "2" \]; then[^\n]*exit 2/);
    expect(workflow).toMatch(/echo "::error::schema-gate: Production liegt hinter dem Journal — Migration ausstehend\. migrate-production\.yml \(bestaetigung=production\) starten; es loest den Deploy von main danach selbst aus\. Dieser Lauf bleibt rot \(kein Deploy\)\."\n\s+exit 1/);
    expect(workflow).not.toMatch(/seq 1 40/);
    expect(workflow).not.toMatch(/sleep 30/);
    // Der Deploy-Job haengt weiterhin am Gate-Ergebnis: rot = kein Deploy.
    expect(workflow).toMatch(/needs\.schema-gate\.result == 'success'/);
  });

  it("freigabe.sh bricht bei jedem Fehlschlag sofort ab (set -euo pipefail) und merged ueber merge-sicher.sh", () => {
    expect(freigabe).toMatch(/^set -euo pipefail$/m);
    expect(freigabe).toContain('"$HIER/merge-sicher.sh" "$PR" "$head" "$BETREFF"');
    expect(mergeSicher).toMatch(/^set -euo pipefail$/m);
  });

  it("freigabe.sh: Reihenfolge a) Head/Zustand, b) Merge, c) main = Squash, d) Migration nur bei neuer Migrationsdatei, e) Deploy", () => {
    const pos = (s: string) => {
      const i = freigabe.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const a = pos('echo "==> (a)');
    const b = pos('echo "==> (b)');
    const c = pos('echo "==> (c)');
    const d = pos('echo "==> (d)');
    const e = pos('echo "==> (e)');
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(c).toBeLessThan(d);
    expect(d).toBeLessThan(e);
    // Die Migration wird erst nach (c) und nur bedingt ausgeloest.
    expect(freigabe.indexOf("gh workflow run migrate-production.yml")).toBeGreaterThan(d);
    expect(freigabe).toMatch(/if \[\[ -n "\$migrationen" \]\]; then\n[^\n]*\n\s+gh workflow run migrate-production\.yml/);
    expect(freigabe).toContain('packages/db/migrations/[0-9]{4}_');
  });

  it("freigabe.sh startet einen abgebrochenen Deploy-Lauf am Head genau einmal neu und wartet", () => {
    expect(freigabe).toMatch(/select\(\.conclusion == "cancelled"\)/);
    expect(freigabe).toMatch(/gh run rerun "\$lauf"\n\s+gh run watch "\$lauf" --exit-status/);
  });

  it("freigabe.sh haengt gestapelte PRs vor dem Merge auf main um und meldet sie (#160/#169, 05.10.2026)", () => {
    const umhaengen = freigabe.indexOf('gh pr list --base "$branch" --state open');
    const patch = freigabe.indexOf('gh api -X PATCH "repos/$REPO/pulls/$kind" -f base=main');
    const merge = freigabe.indexOf('"$HIER/merge-sicher.sh"');
    expect(umhaengen).toBeGreaterThan(-1);
    expect(patch).toBeGreaterThan(umhaengen);
    expect(merge).toBeGreaterThan(patch);
    expect(freigabe).toContain('echo "    gestapelter PR #$kind: Base $branch -> main umgehaengt"');
  });

  it("freigabe.sh prueft nach dem Merge, dass main auf dem Squash-Commit steht", () => {
    expect(freigabe).toContain("--jq .mergeCommit.oid");
    expect(freigabe).toMatch(/"\$main" != "\$squash"/);
  });
});

describe("Betriebs-PR 2 (05.10.2026): Laeufe-Wache, krumme Minuten, Label preview-migrieren, Runner", () => {
  const jobWache = readFileSync(new URL("../../../.github/workflows/job-wache.yml", import.meta.url), "utf8");
  const backup = readFileSync(new URL("../../../.github/workflows/backup.yml", import.meta.url), "utf8");
  const restore = readFileSync(new URL("../../../.github/workflows/restore-woechentlich.yml", import.meta.url), "utf8");
  const minuten = (wf: string) => [...wf.matchAll(/cron: "(\d+) /g)].map((m) => Number(m[1]));

  it("job-wache prueft Backup und Restore-Test ueber die GitHub-API, nur lesend, auch nach roter DB-Wache", () => {
    expect(jobWache).toContain("actions/workflows/backup.yml/runs?status=success");
    expect(jobWache).toContain("actions/workflows/restore-woechentlich.yml/runs?status=success");
    expect(jobWache).toMatch(/if: always\(\)\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}/);
    expect(jobWache).toMatch(/actions: read/);
    expect(jobWache).toContain("pnpm --filter @bhyo/db laeufe-wache /tmp/backup.json /tmp/restore.json");
    expect(jobWache).not.toMatch(/actions: write/);
  });

  it("Backup und Restore-Test laufen auf krummen Minuten; Restore nach dem Backup", () => {
    expect(minuten(backup)).toEqual([23]);
    expect(minuten(restore)).toEqual([41]);
    expect(backup).toContain('cron: "23 2 * * *"');
    expect(restore).toContain('cron: "41 3 * * 1"');
  });

  it("die Preview wird nur mit dem Label preview-migrieren migriert; das Label loest den Lauf aus; DB-Checks laufen ohne Label", () => {
    expect(workflow).toMatch(/- name: Migrate Preview-DB \(nur mit Label preview-migrieren\)\n\s+if: github\.event_name == 'pull_request' && contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview-migrieren'\)\n/);
    expect(workflow).toMatch(/types: \[opened, synchronize, reopened, ready_for_review, labeled\]/);
    expect(workflow).toMatch(/- name: Inbox-Check \(Inbox\)\n\s+if: github\.event_name == 'pull_request'\n/);
  });

  it("Migration laeuft ueberall ueber den Runner (pnpm run migrate / @bhyo/db migrate)", () => {
    expect(workflow).toMatch(/preview-migrieren'\)\n(?:[^\n]*\n){0,6}\s+run: pnpm run migrate/);
    expect(workflow).not.toContain("drizzle-kit migrate");
  });
});

describe("Betriebs-Nachtrag (05.10.2026)", () => {
  const jobWache = readFileSync(new URL("../../../.github/workflows/job-wache.yml", import.meta.url), "utf8");
  const freigabe = readFileSync(new URL("../../../scripts/freigabe.sh", import.meta.url), "utf8");

  it("die Grenzen der Laeufe-Wache werden in Anfuehrungszeichen uebergeben — leere Eingabe bleibt an ihrer Stelle", () => {
    expect(jobWache).toContain('laeufe-wache /tmp/backup.json /tmp/restore.json "${{ inputs.backup_max_stunden }}" "${{ inputs.restore_max_tage }}"');
  });

  it("freigabe.sh fasst beim Deploy-Log nach, statt ein noch nicht verfuegbares Log leer zu lassen", () => {
    // Kommentarzeilen zwischen „do" und dem Aufruf sind erlaubt (seit dem Leseweg-Filter, #188).
    expect(freigabe).toMatch(/for i in \$\(seq 1 6\); do\n(\s*#.*\n)*\s+if leseweg=\$\(gh run view "\$dep" --log/);
  });
});

describe("Betriebs-PR 3 (08.10.2026): CI-Diaet", () => {
  const migrateWf = readFileSync(new URL("../../../.github/workflows/migrate-production.yml", import.meta.url), "utf8");
  const freigabe = readFileSync(new URL("../../../scripts/freigabe.sh", import.meta.url), "utf8");
  const mergeSicher = readFileSync(new URL("../../../scripts/merge-sicher.sh", import.meta.url), "utf8");
  const fakeGh = readFileSync(new URL("../../../scripts/tests/fake-gh.sh", import.meta.url), "utf8");
  const freigabeTest = readFileSync(new URL("../../../scripts/tests/freigabe-test.sh", import.meta.url), "utf8");
  const andere: Array<[string, string]> = ["migrate-production.yml", "backup.yml", "restore-woechentlich.yml", "job-wache.yml"].map((n) => [
    n,
    readFileSync(new URL(`../../../.github/workflows/${n}`, import.meta.url), "utf8"),
  ]);

  it("nur deploy.yml bricht Laeufe ab — Migration, Backup, Restore und Wache nie", () => {
    for (const [name, wf] of andere) {
      expect(wf, name).not.toMatch(/cancel-in-progress: (true|\$\{\{)/);
    }
  });

  const muster = readFileSync(new URL("../../../scripts/nur-doku-muster.txt", import.meta.url), "utf8").split("\n").filter((z) => z && !z.startsWith("#"));

  it("ein Muster fuer „reine Doku\" (scripts/nur-doku-muster.txt): *.md, docs/**, Screenshots — deploy.yml liest es per API, merge-sicher.sh von der Platte", () => {
    expect(muster).toHaveLength(1);
    const re = new RegExp(muster[0]!);
    for (const d of ["docs/betrieb.md", "README.md", "docs/screenshots/e68/01-light.png", "apps/web/README.md", "docs/x/y.jpg"]) expect(re.test(d), d).toBe(true);
    for (const d of ["apps/web/lib/x.ts", "packages/db/migrations/0051_x.sql", ".github/workflows/deploy.yml", "scripts/freigabe.sh", "docs.ts"]) expect(re.test(d), d).toBe(false);
    // Folge-PR (Eric 08.10.2026): das Muster kommt von der BASIS — sonst koennte ein PR seine eigene Einstufung aendern.
    expect(workflow).toContain("contents/scripts/nur-doku-muster.txt?ref=$BASIS");
    expect(workflow).not.toContain("nur-doku-muster.txt?ref=$KOPF");
    expect(workflow).toMatch(/musterdatei=\$\(printf '%s\\n' "\$dateien" \| grep -cx 'scripts\/nur-doku-muster\.txt' \|\| true\)/);
    expect(workflow).toMatch(/\[ "\$doku" -eq "\$anzahl" \] && \[ "\$musterdatei" -eq 0 \]; then nur_doku=true/);
    expect(mergeSicher).toContain('basis=$(gh pr view "$PR" --json baseRefName --jq .baseRefName)');
    expect(mergeSicher).toContain('contents/scripts/nur-doku-muster.txt?ref=$basis');
    expect(mergeSicher).not.toContain('"$HIER/nur-doku-muster.txt"');
    expect(mergeSicher).toMatch(/doku == anzahl_dateien && musterdatei == 0 \)\)/);
  });

  it("ziel-wache: nur_doku nur fuer Pull Requests ueber die Vergleichs-API; main und Dispatch sind nie „nur Doku\"; nicht lesbar = voller Lauf", () => {
    expect(workflow).toMatch(/id: aenderungen\n/);
    expect(workflow).toMatch(/nur_doku: \$\{\{ steps\.aenderungen\.outputs\.nur_doku \}\}/);
    expect(workflow).toMatch(/nur_doku=false\n\s+if \[ "\$EVENT" = "pull_request" \]/);
    expect(workflow).toContain("compare/$BASIS...$KOPF");
    expect(workflow).toMatch(/if \[ "\$anzahl" -gt 0 \] && \[ "\$doku" -eq "\$anzahl" \] && \[ "\$musterdatei" -eq 0 \]; then nur_doku=true; fi/);
    // Kein Pfadfilter auf DB-Dateien mehr (Eric 08.10.2026, 1a): „bereit" ist immer ein voller Lauf.
    expect(workflow).not.toMatch(/outputs\.db\b/);
    expect(workflow).not.toMatch(/db_treffer/);
  });

  it("typen-und-tests: bei reiner Doku-Aenderung laeuft nur der Konfliktmarker-Check (jeder andere Schritt an VOLL gebunden)", () => {
    const job = workflow.slice(workflow.indexOf("\n  typen-und-tests:"), workflow.indexOf("\n  wegwerf-db:"));
    expect(job).toMatch(/VOLL: \$\{\{ needs\.ziel-wache\.outputs\.nur_doku != 'true' \}\}/);
    const schritte = job.split(/\n      - (?=name:|uses:)/).slice(1);
    const ungebunden = schritte.filter((st) => !/^\s*if: env\.VOLL == 'true'/m.test(st)).map((st) => st.split("\n")[0]);
    expect(ungebunden).toEqual(["uses: actions/checkout@v7", "name: konfliktmarker-check (versionierte Dateien)"]);
  });

  it("wegwerf-db laeuft fuer jeden Nicht-Entwurf und auf main, nur nicht fuer reine Doku-PRs; der Deploy verlangt sie gruen (skipped nur, wo ohnehin nicht deployt wird)", () => {
    expect(workflow).toMatch(/\n  wegwerf-db:\n\s+needs: \[ziel-wache\]\n(?:\s+#[^\n]*\n)*\s+if: >-\n\s+needs\.ziel-wache\.outputs\.nur_doku != 'true' &&\n\s+\(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.draft == false\)/);
    const deploy = workflow.slice(workflow.indexOf("\n  deploy:"), workflow.indexOf("\n  lese-diagnose:"));
    expect(deploy).toMatch(/needs\.ziel-wache\.outputs\.nur_doku != 'true' &&/);
    expect(deploy).toMatch(/\(needs\.wegwerf-db\.result == 'success' \|\| needs\.wegwerf-db\.result == 'skipped'\)/);
    expect(deploy).toMatch(/github\.event\.pull_request\.draft == false/);
  });

  it("die DB-Checks im Deploy-Job haengen an keinem Pfadfilter (jeder Nicht-Entwurf-PR prueft die Preview-DB)", () => {
    const job = workflow.slice(workflow.indexOf("\n  deploy:"), workflow.indexOf("\n  lese-diagnose:"));
    const checks = [...job.matchAll(/- name: ([^\n]*(?:[Cc]heck|Probe|Vorpruefung|Paritaet|Abweichungsliste)[^\n]*)\n\s+if: ([^\n]*)/g)].filter((m) => !/^Health-Check/.test(m[1]!));
    expect(checks.length).toBeGreaterThanOrEqual(18);
    for (const [, name, bedingung] of checks) {
      expect(bedingung, name).toMatch(/^github\.event_name == 'pull_request'/);
      expect(bedingung, name).not.toContain("outputs.");
    }
  });

  it("merge-sicher.sh wertet je Check-Namen nur den juengsten Lauf; Pflicht-Checks muessen success sein (cancelled, skipped, fehlend = nicht gruen); Doku-PR nur ziel-wache und typen-und-tests", () => {
    expect(mergeSicher).toContain("group_by(.name) | map(max_by(.id // 0))");
    expect(mergeSicher).toMatch(/ABBRUCH: kein Check-Lauf am Head/);
    expect(mergeSicher).toMatch(/pflicht="ziel-wache typen-und-tests wegwerf-db deploy"/);
    expect(mergeSicher).toMatch(/doku == anzahl_dateien && musterdatei == 0 \)\); then\n\s+pflicht="ziel-wache typen-und-tests"/);
    expect(mergeSicher).toMatch(/\[\[ "\$stand" == "completed\/success" \]\] \|\| fehlend=/);
    expect(mergeSicher).toMatch(/ABBRUCH: Pflicht-Checks nicht gruen:/);
    expect(mergeSicher).not.toMatch(/conclusion != "neutral"/);
  });

  it("Journal-Waechter: idx lueckenlos, when strikt steigend, Datei je Eintrag — laeuft als Test in typen-und-tests", () => {
    const wache = readFileSync(new URL("./journal-wache.ts", import.meta.url), "utf8");
    expect(wache).toMatch(/export function pruefeJournal/);
    expect(workflow).toMatch(/- name: Tests — packages\/db/);
  });

  it("freigabe.sh wiederholt Netzfehler bei gh bis zu dreimal mit Pause und wartet nach einer Migration auf den Dispatch-Lauf", () => {
    expect(freigabe).toMatch(/gh_wiederholt\(\) \{[\s\S]*for versuch in 1 2 3; do/);
    expect(freigabe).toMatch(/connection reset\|i\/o timeout/);
    expect(freigabe).toMatch(/if \[\[ -n "\$migrationen" \]\]; then\n(?:\s+#[^\n]*\n)*\s+echo "==> \(e\) Deploy von main \(Dispatch-Lauf nach der Migration\) und Leseweg"[\s\S]*lauf_am_commit deploy\.yml "\$squash" workflow_dispatch/);
    expect(freigabe).toMatch(/gh_wiederholt run watch "\$dep" --exit-status/);
    // Ein ueberholter, abgebrochener Lauf am Head wird nicht neu gestartet, wenn ein juengerer gruen ist.
    expect(freigabe).toMatch(/gruen_am_head=\$\(gh run list --commit "\$head"/);
  });

  it("die Freigabe-Tests decken Netzfehler, Migration mit Dispatch-Lauf und ueberholte Laeufe ab", () => {
    expect(fakeGh).toMatch(/netz_scheitert\(\)/);
    expect(fakeGh).toMatch(/migrate-production\.yml\)\n[\s\S]*event: \\"workflow_dispatch\\"/);
    expect(freigabeTest).toMatch(/netzfehler=2/);
    expect(freigabeTest).toMatch(/\(d\/e\) Migration im PR/);
    expect(freigabeTest).toMatch(/\(a\) abgebrochener Lauf am Head, juengerer gruen/);
    for (const fall of ["juengster Lauf von deploy cancelled", "wegwerf-db auf einem Code-PR uebersprungen", "Pflicht-Check deploy fehlt am Head", "reiner Doku-PR: Wegwerf-DB und Deploy uebersprungen sind erlaubt", "(Folge) Muster kommt von der Basis", "(Folge) PR aendert die Musterdatei selbst", "(Folge) Muster in der Basis nicht lesbar"]) {
      expect(freigabeTest, fall).toContain(fall);
    }
  });
});
