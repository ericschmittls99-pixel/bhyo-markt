/**
 * AP2.7 PR b (E67): Adressen je eindeutiger Adresse, Treffer-Auswahl ohne
 * Raten (PLZ muss stimmen, mit Strasse nur Adress-Treffer), offen mit Grund.
 */
import { describe, expect, it } from "vitest";

import type { Adresse } from "./geocode";
import { adressGruppen, adressText, brauchtPlzAusOrt, brauchtSitz, istPlzAusOrtBefund, istStandortBefund, kandidatenText, ortGruppen, plzAusOrt, sitzAusLokal, sitzPatch, standortBefund, standortGruppen, waehleSitz } from "./import-adressen";
import type { PlzKandidat } from "./plz-server";

const adresse = (teil: Partial<Adresse>): Adresse => ({ art: "adresse", strasse: "Dorfstraße", hausnummer: "3", plz: "67346", ort: "Speyer", kreis: null, land: null, lng: 8.43, lat: 49.32, ...teil });

describe("adressGruppen", () => {
  it("nimmt nur neue Akteure ohne Pin und ohne Befund, je Adresse einmal (Normalform)", () => {
    const g = adressGruppen([
      { id: "a", felder: { akteur_neu: "1", akteur_sitz_strasse: "Dorfstraße", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
      { id: "b", felder: { akteur_neu: "1", akteur_sitz_strasse: "Dorfstrasse ", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "SPEYER" } },
      { id: "c", felder: { akteur_id: "x", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
      { id: "d", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal", akteur_sitz_lat: "49.1", akteur_sitz_lng: "8.6" } },
      { id: "e", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal", akteur_sitz_offen: "Kein Treffer" } },
      { id: "f", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal" } },
    ]);
    expect(g.map((x) => [x.zeilenIds, adressText(x)])).toEqual([
      [["a", "b"], "Dorfstraße 3, 67346 Speyer"],
      [["f"], "76646 Bruchsal"],
    ]);
    expect(brauchtSitz({ akteur_neu: "1" })).toBe(true);
    expect(brauchtSitz({ akteur_neu: "1", akteur_sitz_lat: "1", akteur_sitz_lng: "2" })).toBe(false);
  });
});

describe("waehleSitz", () => {
  const g = { strasse: "Dorfstraße", hausnummer: "3", plz: "67346", ort: "Speyer" };

  it("mit Strasse: erster Adress-Treffer mit passender PLZ", () => {
    const e = waehleSitz(g, [adresse({ art: "ort", plz: "67346" }), adresse({ plz: "67346", lat: 49.3201 })]);
    expect(e).toEqual({ lat: 49.3201, lng: 8.43, plz: "67346", ort: "Speyer" });
  });

  it("PLZ weicht ab → offen mit Grund, nichts geraten", () => {
    expect(waehleSitz(g, [adresse({ plz: "67354" })])).toEqual({ offen: "PLZ weicht ab: Treffer hat 67354, die Datei 67346." });
  });

  it("mit Strasse genuegt kein Orts-Treffer; ohne Strasse schon (unvollstaendiger Sitz, E66)", () => {
    expect(waehleSitz(g, [adresse({ art: "ort", strasse: null, hausnummer: null })])).toEqual({ offen: "Kein Adress-Treffer — nur Ort oder Objekt gefunden." });
    expect(waehleSitz({ strasse: "", hausnummer: "", plz: "67346", ort: "Speyer" }, [adresse({ art: "ort", strasse: null, hausnummer: null, lat: 49.3, lng: 8.4 })])).toEqual({ lat: 49.3, lng: 8.4, plz: "67346", ort: "Speyer" });
  });

  it("fehlende PLZ in der Datei kommt aus dem Treffer; ohne PLZ und Ort bleibt es offen", () => {
    expect(waehleSitz({ strasse: "Dorfstraße", hausnummer: "3", plz: "", ort: "Speyer" }, [adresse({})])).toEqual({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer" });
    expect(waehleSitz({ strasse: "Dorfstraße", hausnummer: "3", plz: "", ort: "" }, [adresse({})])).toEqual({ offen: "Weder PLZ noch Ort angegeben — die Straße allein bestimmt keinen Sitz." });
    expect(waehleSitz(g, [])).toEqual({ offen: "Kein Treffer der Adresssuche." });
  });

  it("sitzPatch schreibt Maschinenwerte mit Dezimalpunkt und die Quelle", () => {
    expect(sitzPatch({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer" })).toEqual({ akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_quelle: "photon", akteur_sitz_genauigkeit: "unbekannt" });
    expect(sitzPatch({ offen: "x" })).toEqual({ akteur_sitz_offen: "x" });
  });
});

describe("sitzAusLokal (E68 PR 3: lokale Zuordnung, Befunde als Satz)", () => {
  const pin = { lng: 8.43, lat: 49.32 };
  it("PLZ bekannt, Ort passt -> Pin im PLZ-Gebiet, Genauigkeit plz_gebiet", () => {
    expect(sitzAusLokal({ plz: "67346", ort: "Speyer" }, { plzBekannt: true, ortPasst: true, orte: ["Speyer"], pin })).toEqual({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer", genauigkeit: "plz_gebiet", quelle: "plz_gebiet" });
  });
  it("Rot: unbekannte PLZ -> offen mit Satz", () => {
    expect(sitzAusLokal({ plz: "00000", ort: "X" }, { plzBekannt: false, ortPasst: false, orte: [], pin: null })).toEqual({ offen: "PLZ 00000 ist unbekannt — bitte prüfen." });
  });
  it("Rot: Ort passt nicht -> „Meinten Sie …?“ mit hoechstens drei Orten", () => {
    expect(sitzAusLokal({ plz: "54636", ort: "Bitburgg" }, { plzBekannt: true, ortPasst: false, orte: ["Altenkirchen", "Bitburg", "Dudeldorf", "Esch"], pin })).toEqual({ offen: "Ort passt nicht zur PLZ 54636 — meinten Sie Altenkirchen, Bitburg, Dudeldorf …?" });
  });
  it("ohne Ort: einziger Ort der PLZ wird uebernommen, mehrere bleiben offen mit Liste", () => {
    expect(sitzAusLokal({ plz: "67346", ort: "" }, { plzBekannt: true, ortPasst: false, orte: ["Speyer"], pin })).toMatchObject({ ort: "Speyer", genauigkeit: "plz_gebiet" });
    expect(sitzAusLokal({ plz: "54636", ort: "" }, { plzBekannt: true, ortPasst: false, orte: ["A", "B"], pin })).toEqual({ offen: "PLZ 54636 hat 2 Orte — Ort angeben: A, B" });
  });
  it("ohne PLZ keine lokale Zuordnung", () => {
    expect(sitzAusLokal({ plz: "", ort: "Speyer" }, { plzBekannt: false, ortPasst: false, orte: [], pin: null })).toEqual({ offen: "Ohne PLZ keine Zuordnung — PLZ in der Zeile ergänzen." });
  });
});

describe("Standort-Spalten (Zeile 39, Eric 08.10.2026): PLZ/Ort-Pruefung auch bei vorhandenem Akteur", () => {
  const z = (id: string, felder: Record<string, string>) => ({ id, felder });
  it("gruppiert Zeilen mit Standort · PLZ je (PLZ, Ort) — unabhaengig vom Akteur; ohne PLZ nichts", () => {
    const g = standortGruppen([
      z("a", { akteur_id: "x", plz: "68199", ort: "Mannheim-Neckarau" }),
      z("b", { akteur_neu: "1", plz: "68199", ort: "mannheim neckarau" }),
      z("c", { plz: "99999", ort: "Landau" }),
      z("d", { ort: "Mosbach" }),
      z("e", { akteur_sitz_plz: "68159", akteur_sitz_ort: "Heidelberg" }),
    ]);
    expect(g.map((x) => [x.plz, x.zeilenIds])).toEqual([
      ["68199", ["a", "b"]],
      ["99999", ["c"]],
    ]);
  });
  it("Befund: unbekannte PLZ, Ort passt nicht (mit „Meinten Sie“), sonst null; Ortsteil-Toleranz kommt aus der Pruefung selbst", () => {
    const pin = { lng: 8.5, lat: 49.5 };
    expect(standortBefund({ plz: "99999", ort: "Landau" }, { plzBekannt: false, ortPasst: false, orte: [], pin: null })).toBe("PLZ 99999 ist unbekannt — bitte prüfen.");
    expect(standortBefund({ plz: "68159", ort: "Heidelberg" }, { plzBekannt: true, ortPasst: false, orte: ["Mannheim"], pin })).toBe("Ort passt nicht zur PLZ 68159 — meinten Sie Mannheim?");
    expect(standortBefund({ plz: "68199", ort: "Mannheim-Neckarau" }, { plzBekannt: true, ortPasst: true, orte: ["Mannheim"], pin })).toBeNull();
    expect(standortBefund({ plz: "68199", ort: "" }, { plzBekannt: true, ortPasst: false, orte: ["Mannheim"], pin })).toBeNull();
  });
  it("istStandortBefund erkennt nur eigene Befunde — ein Formatfehler von feldWert wird nicht geraeumt", () => {
    expect(istStandortBefund("PLZ 99999 ist unbekannt — bitte prüfen.")).toBe(true);
    expect(istStandortBefund("Ort passt nicht zur PLZ 68159 — meinten Sie Mannheim?")).toBe(true);
    expect(istStandortBefund("muss fünfstellig sein")).toBe(false);
    expect(istStandortBefund(undefined)).toBe(false);
  });
});

describe("PLZ aus Ort (E72, 2.7h, Eric 08.10.2026)", () => {
  const z = (id: string, felder: Record<string, string>) => ({ id, felder });
  const k = (plz: string, ort: string, ars: string, kreis: string | null = null, land: string | null = null): PlzKandidat => ({ plz, ort, ars, kreis, land });

  it("braucht den Schritt nur ohne Sitz-PLZ, mit Ort und Name, ohne Gruppe und ohne eigenen Befund", () => {
    expect(brauchtPlzAusOrt({ akteur_name: "Hofgut Kirchberg", akteur_sitz_ort: "Mosbach" })).toBe(true);
    expect(brauchtPlzAusOrt({ akteur_name: "Hofgut Kirchberg", akteur_sitz_ort: "Mosbach", akteur_sitz_plz: "74821" })).toBe(false);
    expect(brauchtPlzAusOrt({ akteur_name: "Hofgut Kirchberg", akteur_sitz_ort: " " })).toBe(false);
    expect(brauchtPlzAusOrt({ akteur_sitz_ort: "Mosbach" })).toBe(false);
    expect(brauchtPlzAusOrt({ akteur_name: "X", akteur_sitz_ort: "Mosbach", akteur_gruppe: "x|" })).toBe(false);
    expect(brauchtPlzAusOrt({ akteur_name: "X", akteur_sitz_ort: "Freiburg", fehler_akteur_sitz_plz: "Ort „Freiburg\" ist ohne PLZ nicht eindeutig …" })).toBe(false);
  });

  it("gruppiert je Ort (Normalform), Reihenfolge des ersten Auftretens", () => {
    const g = ortGruppen([
      z("a", { akteur_name: "A", akteur_sitz_ort: "Mosbach" }),
      z("b", { akteur_name: "B", akteur_sitz_ort: "MOSBACH " }),
      z("c", { akteur_name: "C", akteur_sitz_ort: "Freiburg" }),
      z("d", { akteur_name: "D", akteur_sitz_ort: "Freiburg", akteur_sitz_plz: "79098" }),
    ]);
    expect(g).toEqual([
      { ort: "Mosbach", zeilenIds: ["a", "b"] },
      { ort: "Freiburg", zeilenIds: ["c"] },
    ]);
  });

  it("a) genau eine PLZ -> PLZ und Hinweis „PLZ aus Ort ergänzt“ (Zeile 18: Mosbach -> 74821)", () => {
    expect(plzAusOrt("Mosbach", [k("74821", "Mosbach", "081255002045", "Neckar-Odenwald-Kreis", "Baden-Württemberg")])).toEqual({ plz: "74821", hinweis: "PLZ aus Ort ergänzt (Mosbach → 74821)" });
  });

  it("Rot b) mehrere gleichnamige Orte -> Befund mit Kandidaten je Ort mit Kreis und Land (Zeile 21: Freiburg)", () => {
    const e = plzAusOrt("Freiburg", [
      k("21729", "Freiburg (Elbe)", "033590014014", "Landkreis Stade", "Niedersachsen"),
      k("79098", "Freiburg im Breisgau", "083110000000", "Stadtkreis Freiburg im Breisgau", "Baden-Württemberg"),
      k("79100", "Freiburg im Breisgau", "083110000000", "Stadtkreis Freiburg im Breisgau", "Baden-Württemberg"),
    ]);
    expect(e).toEqual({
      befund:
        "Ort „Freiburg\" ist ohne PLZ nicht eindeutig (mehrere Orte dieses Namens) — Kandidaten: Freiburg (Elbe), Landkreis Stade, Niedersachsen: 21729; Freiburg im Breisgau, Stadtkreis Freiburg im Breisgau, Baden-Württemberg: 79098, 79100 — PLZ in der Zeile ergänzen.",
    });
    expect(istPlzAusOrtBefund((e as { befund: string }).befund)).toBe(true);
  });

  it("Rot b) ein Ort mit mehreren PLZ -> Befund „mehrere PLZ“, hoechstens zehn PLZ, dann „…“", () => {
    const viele = Array.from({ length: 12 }, (_, i) => k(`681${String(i).padStart(2, "0")}`, "Mannheim", "082220000000", "Stadtkreis Mannheim", "Baden-Württemberg"));
    const e = plzAusOrt("Mannheim", viele) as { befund: string };
    expect(e.befund).toMatch(/^Ort „Mannheim" ist ohne PLZ nicht eindeutig \(mehrere PLZ\) — Kandidaten: Mannheim, Stadtkreis Mannheim, Baden-Württemberg: 68100, 68101, 68102, 68103, 68104, 68105, 68106, 68107, 68108, 68109 … — PLZ in der Zeile ergänzen\.$/);
    // Grenze ueber Orte hinweg: zweiter Ort faellt ganz weg, „…“ bleibt genau einmal.
    const text = kandidatenText([...viele.slice(0, 10), k("21729", "Freiburg (Elbe)", "033590014014", "Landkreis Stade", "Niedersachsen")]);
    expect(text).toBe("Mannheim, Stadtkreis Mannheim, Baden-Württemberg: 68100, 68101, 68102, 68103, 68104, 68105, 68106, 68107, 68108, 68109 …");
  });

  it("Rot: unbekannter Ort -> Befund, Kreis/Land fehlen ohne VG250 ohne Erfindung", () => {
    expect(plzAusOrt("Xyzzy", [])).toEqual({ befund: "Ort „Xyzzy\" ist nicht bekannt — PLZ in der Zeile ergänzen." });
    expect(kandidatenText([k("11111", "Altstadt", "070000000001")])).toBe("Altstadt: 11111");
    expect(istPlzAusOrtBefund("muss fünfstellig sein")).toBe(false);
    expect(istPlzAusOrtBefund(undefined)).toBe(false);
  });
});
