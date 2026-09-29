/**
 * Enum-Rename-Waechter (Entscheidung Eric, 29.09.2026, AP2.2 PR c Nachtrag).
 *
 * Migration 0028 deklariert inbox_typ_text(inbox_typ) als IMMUTABLE, damit
 * der Enum→Text-Vergleich in einem Index-Praedikat stehen darf. Das ist nur
 * dann wahr, wenn die Werte des Enums nie umbenannt werden: Ein
 * ALTER TYPE … RENAME VALUE wuerde Index-Praedikat und ON CONFLICT still
 * verfaelschen (der Index behielte die alte Antwort der Funktion). Deshalb
 * weist dieser Waechter jede Migration ab, die einen hier gelisteten Enum
 * (oder den Typ selbst) umbenennt. Ein Wert wird stattdessen ersetzt: neuen
 * Wert anlegen, Daten migrieren, alten Wert nicht mehr verwenden.
 *
 * Quellentextbasiert ueber alle Migrationsdateien; laeuft in der CI.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Enums, die in einer IMMUTABLE-Funktion verwendet werden — mit der Funktion. */
export const IMMUTABLE_ENUMS: ReadonlyMap<string, string> = new Map([["inbox_typ", "inbox_typ_text (Migration 0028)"]]);

export interface Verstoss {
  datei: string;
  zeile: number;
  text: string;
  grund: string;
}

export function findeVerstoesse(migrationsOrdner: string, enums: ReadonlyMap<string, string> = IMMUTABLE_ENUMS): Verstoss[] {
  const verstoesse: Verstoss[] = [];
  for (const datei of readdirSync(migrationsOrdner).filter((d) => d.endsWith(".sql")).sort()) {
    const zeilen = readFileSync(join(migrationsOrdner, datei), "utf8").split("\n");
    zeilen.forEach((zeile, i) => {
      // Kommentare zaehlen nicht — dort darf der Grund stehen.
      const sql = zeile.replace(/--.*$/, "");
      const m = /alter\s+type\s+(?:"?[\w]+"?\.)?"?(\w+)"?\s+rename\s+(value|to)\b/i.exec(sql);
      if (!m) return;
      const typ = m[1]!.toLowerCase();
      const funktion = enums.get(typ);
      if (!funktion) return;
      verstoesse.push({
        datei,
        zeile: i + 1,
        text: sql.trim(),
        grund:
          m[2]!.toLowerCase() === "value"
            ? `Werte von ${typ} duerfen nicht umbenannt werden — ${funktion} ist IMMUTABLE und steht in Index-Praedikaten. Stattdessen: neuen Wert anlegen, Daten migrieren, alten nicht mehr verwenden.`
            : `Der Typ ${typ} darf nicht umbenannt werden — ${funktion} ist IMMUTABLE und an ihn gebunden.`,
      });
    });
  }
  return verstoesse;
}

if (process.argv[1]?.endsWith("enum-rename-check.ts")) {
  const ordner = join(process.cwd(), "migrations");
  const verstoesse = findeVerstoesse(ordner);
  if (verstoesse.length === 0) {
    console.log(`enum-rename-check OK — kein RENAME an ${[...IMMUTABLE_ENUMS.keys()].join(", ")} in ${ordner}.`);
  } else {
    for (const v of verstoesse) console.error(`::error file=packages/db/migrations/${v.datei},line=${v.zeile}::${v.text} — ${v.grund}`);
    process.exit(1);
  }
}
