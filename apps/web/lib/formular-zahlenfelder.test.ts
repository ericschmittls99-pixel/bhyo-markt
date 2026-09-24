import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * F4-Review (Eric, 24.09.2026): `step` auf einem Zahlenfeld ist ein
 * Eingaberaster, keine Rundung — der Browser weist jeden Zwischenwert mit
 * „Please enter a nearest value" ab. Erst fiel es beim Saisonalitaetsprofil
 * auf (step=5), dieselbe Falle steckte danach noch in acht Feldern
 * (step=0.01 / 0.1): ein TS-Anteil von 33,333 % war damit nicht eingebbar.
 * Gerundet wird beim Rechnen und an der Ausgabegrenze, nie durch die
 * Browser-Validierung.
 */
const DATEIEN = [
  "components/stroeme/FormularPanel.tsx",
  "components/stroeme/SeasonBarsEdit.tsx",
];

describe("Zahlenfelder im Erfassungsformular", () => {
  for (const rel of DATEIEN) {
    it(`${rel}: kein enges step-Raster`, () => {
      // Kommentare zuerst raus: dieser Test erklaert sich im Code selbst mit
      // einem `step="0.1"` als Beispiel — ein Guard, der am erklaerenden Text
      // scheitert, wird durch Umformulieren umgangen statt befolgt.
      const quelle = readFileSync(join(process.cwd(), rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const enge = [...quelle.matchAll(/step=(?:"([^"]*)"|\{([^}]*)\})/g)]
        .map((m) => (m[1] ?? m[2]).trim())
        .filter((wert) => wert !== "any" && wert !== '"any"');
      expect(enge).toEqual([]);
    });
  }
});
