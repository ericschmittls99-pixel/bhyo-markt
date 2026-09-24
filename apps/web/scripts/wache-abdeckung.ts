/**
 * F8/E30: Findet jeden Schreibpfad, der nicht durch die Wache geht.
 *
 * Der Sinn ist nicht, den heutigen Stand zu bestaetigen — der ist gruen.
 * Der Sinn ist der MORGIGE Schreibpfad: Wer eine neue Server-Action oder
 * eine neue POST/PUT/PATCH/DELETE-Route anlegt und die Wache vergisst,
 * soll es von der CI erfahren und nicht von einem Betrachter, der etwas
 * geaendert hat. Gleiches Muster wie der step="any"-Test: geprueft wird die
 * Ursache (fehlende Pruefung), nicht das Symptom.
 *
 * Bewusst quellentextbasiert: Ein Laufzeittest muesste jede Route aufrufen
 * und wuerde neue Pfade genau dann verpassen, wenn niemand an ihn denkt.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WURZEL = process.cwd();

/**
 * Was als Durchsetzung gilt, wird aus lib/wache.ts SELBST gelesen — jede
 * dort exportierte Funktion. Eine Liste, die hier noch einmal stuende, waere
 * eine zweite Wahrheit: Sie koennte von der Wache abdriften, und der Test
 * wuerde den Bruch nicht melden, sondern verdecken.
 */
function wacheNamen(wurzel: string): string[] {
  const quelle = readFileSync(join(wurzel, "lib", "wache.ts"), "utf8");
  const namen = [...quelle.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]!);
  if (namen.length === 0) throw new Error("lib/wache.ts exportiert keine Funktion — Test kaputt.");
  return namen;
}

const SCHREIB_METHODEN = ["POST", "PUT", "PATCH", "DELETE"] as const;

export interface Lücke {
  datei: string;
  pfad: string;
  grund: string;
}

function dateien(verzeichnis: string, treffer: string[] = []): string[] {
  for (const eintrag of readdirSync(verzeichnis)) {
    if (eintrag === "node_modules" || eintrag === ".next") continue;
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) dateien(voll, treffer);
    else if (/\.tsx?$/.test(eintrag) && !/\.test\.tsx?$/.test(eintrag)) treffer.push(voll);
  }
  return treffer;
}

/**
 * Schneidet den Rumpf einer exportierten Funktion heraus — von ihrem Beginn
 * bis zum naechsten `export`. Grob, aber ausreichend: Wir fragen nur, ob in
 * diesem Abschnitt ein Wache-Aufruf vorkommt.
 */
function rumpf(quelle: string, ab: number): string {
  const rest = quelle.slice(ab);
  const naechster = rest.slice(1).search(/^export /m);
  return naechster === -1 ? rest : rest.slice(0, naechster + 1);
}

export function findeLuecken(wurzel = WURZEL): Lücke[] {
  const luecken: Lücke[] = [];
  // Wortgrenze, damit `verlange` nicht auf `verlangeSchreibrecht` matcht und
  // umgekehrt — gepruefft wird der Aufruf, nicht die Namensaehnlichkeit.
  const wache = new RegExp(`\\b(${wacheNamen(wurzel).join("|")})\\s*\\(`);

  // 1. Server-Actions: jede exportierte async-Funktion in einer "use server"-Datei.
  for (const datei of dateien(join(wurzel, "lib"))) {
    const quelle = readFileSync(datei, "utf8");
    if (!/^["']use server["'];/m.test(quelle)) continue;
    for (const m of quelle.matchAll(/^export async function (\w+)/gm)) {
      const name = m[1]!;
      // logAenderung ist ein Baustein ohne eigenen Schreibpfad: Es wird
      // ausschliesslich INNERHALB bereits geprueffter Aktionen aufgerufen und
      // bekommt die geprueffte E-Mail uebergeben.
      if (name === "logAenderung") continue;
      if (!wache.test(rumpf(quelle, m.index!))) {
        luecken.push({
          datei: relative(wurzel, datei),
          pfad: `${name}()`,
          grund: "Server-Action ohne Aufruf der Wache",
        });
      }
    }
  }

  // 2. Schreibende API-Routen.
  for (const datei of dateien(join(wurzel, "app", "api"))) {
    if (!datei.endsWith("route.ts")) continue;
    const quelle = readFileSync(datei, "utf8");
    for (const methode of SCHREIB_METHODEN) {
      const m = new RegExp(`^export async function ${methode}\\b`, "m").exec(quelle);
      if (!m) continue;
      if (!wache.test(rumpf(quelle, m.index))) {
        luecken.push({
          datei: relative(wurzel, datei),
          pfad: `${methode}`,
          grund: "schreibende Route ohne Aufruf der Wache",
        });
      }
    }
  }

  return luecken;
}

// Direkt aufrufbar (pnpm --filter web exec tsx scripts/wache-abdeckung.ts),
// damit sich die Liste auch von Hand ansehen laesst.
if (process.argv[1]?.endsWith("wache-abdeckung.ts")) {
  const luecken = findeLuecken();
  if (luecken.length === 0) {
    console.log("Wache-Abdeckung OK — jeder Schreibpfad geht durch lib/wache.ts.");
  } else {
    for (const l of luecken) console.error(`::error file=${l.datei}::${l.pfad} — ${l.grund}`);
    process.exit(1);
  }
}
