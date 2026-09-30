import { describe, expect, it } from "vitest";

import { findeFeldLuecken } from "../scripts/feld-check";
import { FELD_EINSTUFUNG, fachlicheFelder, istFachlich, METADATA_EINSTUFUNG } from "./feldeinstufung";

// AP2.4 PR a (E62, D6): Feldeinstufung als Daten, Waechter gegen Luecken.
describe("Feldeinstufung", () => {
  it.skip("tmp: Vitest-Fall ausgesetzt, damit der CI-Schritt feld-check selbst rot zeigt", () => {
    expect(findeFeldLuecken()).toEqual([]);
  });
  it("Entscheidung 0.5: kontaktperson und extern_nachvollziehbar redaktionell, Notizen redaktionell, Rest wie beschlossen", () => {
    expect(FELD_EINSTUFUNG.biomassestrom.kontaktperson).toBe("redaktionell");
    expect(FELD_EINSTUFUNG.output_bedarf.kontaktperson).toBe("redaktionell");
    expect(FELD_EINSTUFUNG.beleg.extern_nachvollziehbar).toBe("redaktionell");
    expect(FELD_EINSTUFUNG.beleg.notiz).toBe("redaktionell");
    expect(METADATA_EINSTUFUNG).toEqual({ quellenangabe: "fachlich", kernnotiz: "redaktionell" });
    for (const sp of ["menge_roh_fm", "preis_min", "zeitraum_von", "materialart_code", "akteur_id", "standort_geom", "reserviert_bhyo", "beleg_id"]) {
      expect(istFachlich("biomassestrom", sp), sp).toBe(true);
    }
    for (const sp of ["typ", "datei_key", "link_url", "gueltig_bis", "erstellt_am"]) expect(istFachlich("beleg", sp), sp).toBe(true);
    for (const sp of ["vergeben_von", "vergeben_bis", "vergeben_an", "an_bhyo"]) expect(istFachlich("vergabe_zeitraum", sp), sp).toBe(true);
    // Technisch ist ausdruecklich gefuehrt, nicht weggelassen.
    for (const sp of ["id", "status", "gesperrt_von", "gesperrt_am", "created_at", "updated_at", "menge_atro"]) {
      expect(FELD_EINSTUFUNG.biomassestrom[sp], sp).toBe("technisch");
    }
    expect(FELD_EINSTUFUNG.beleg.qualitaet).toBe("technisch");
    expect(FELD_EINSTUFUNG.beleg.beleg_nr).toBe("technisch");
  });
  it("fachlicheFelder: nur fachliche bleiben; unbekannte gelten als fachlich; metadata-Schluessel gesondert", () => {
    expect(fachlicheFelder("biomassestrom", ["kontaktperson", "menge_roh_fm", "beleg.notiz", "beleg.typ", "beleg.metadata.kernnotiz", "beleg.metadata.quellenangabe", "vergabe_zeitraum.vergeben_an"])).toEqual([
      "menge_roh_fm",
      "beleg.typ",
      "beleg.metadata.quellenangabe",
      "vergabe_zeitraum.vergeben_an",
    ]);
    expect(fachlicheFelder("output_bedarf", ["gibt_es_nicht"])).toEqual(["gibt_es_nicht"]);
    expect(fachlicheFelder("output_bedarf", [])).toEqual([]);
  });
});
