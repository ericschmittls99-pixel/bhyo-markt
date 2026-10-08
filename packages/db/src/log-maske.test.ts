/**
 * E73: Der Maskierungsschritt darf nie werfen und nie Eingabewerte ausgeben —
 * nur die zu maskierenden Bestandteile (Host, Nutzer). Platzhalterwerte.
 */
import { describe, expect, it } from "vitest";

import { maskenAusUmgebung, maskenFuer } from "./log-maske";

describe("maskenFuer", () => {
  it("URL-Form: Host und Nutzer, nie das Passwort", () => {
    const m = maskenFuer("postgresql://leser_platzhalter:geheim%40pw@ep-platzhalter-123.eu.example.tech:5432/neondb?sslmode=require");
    expect(m).toEqual(["ep-platzhalter-123.eu.example.tech", "leser_platzhalter"]);
    expect(m.join(" ")).not.toContain("geheim");
  });
  it("key=value-DSN mit Leerzeichen (Eric 08.10.2026): Host und Nutzer, Passwort und Optionen nicht", () => {
    const m = maskenFuer("host=ep-platzhalter-123.eu.example.tech user=bhyo_platzhalter password=geheim-pw sslmode=require channel_binding=require");
    expect(m).toEqual(["ep-platzhalter-123.eu.example.tech", "bhyo_platzhalter"]);
    expect(m.join(" ")).not.toContain("geheim");
    expect(m.join(" ")).not.toContain("require");
  });
  it("URL mit angehaengter Option nach Leerzeichen bleibt ein Wert — Host und Nutzer werden erkannt, nichts wirft", () => {
    expect(maskenFuer("postgres://nutzer_platzhalter:pw@host.platzhalter.example/db sslmode=require")).toEqual(["host.platzhalter.example", "nutzer_platzhalter"]);
  });
  it("unbrauchbare oder leere Werte: keine Maske, keine Ausnahme — und nie die Eingabe im Ergebnis", () => {
    for (const w of [undefined, "", "   ", "require", "kein-dsn", "%E0%A4%A@x/y"]) {
      let erg: string[] = [];
      expect(() => (erg = maskenFuer(w))).not.toThrow();
      if (w && w.trim().length >= 3) expect(erg).not.toContain(w);
    }
  });
});

describe("maskenAusUmgebung", () => {
  it("liest nur URL_*-Variablen, je Bestandteil eine ::add-mask::-Zeile, nichts sonst", () => {
    const zeilen = maskenAusUmgebung({
      URL_1: "postgres://u_platzhalter:pw@h1.platzhalter.example/db",
      URL_2: "host=h2.platzhalter.example user=u2_platzhalter password=pw2",
      DATABASE_URL: "postgres://nicht:lesen@ignoriert.example/db",
      PATH: "/usr/bin",
    });
    expect(zeilen).toEqual(["::add-mask::h1.platzhalter.example", "::add-mask::u_platzhalter", "::add-mask::h2.platzhalter.example", "::add-mask::u2_platzhalter"]);
    expect(zeilen.join("\n")).not.toContain("pw");
    expect(zeilen.join("\n")).not.toContain("ignoriert");
  });
});
