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
    expect(workflow).toContain("needs: [typen-und-tests, ziel-wache, schema-gate]");
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
