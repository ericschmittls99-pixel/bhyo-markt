/**
 * AP2.2 PR a: JE SCHREIBPFAD ein Ereignis mit richtiger Art, Urheber
 * (benutzer_id) und Objektbezug. Die Aktionen und Routen werden echt
 * aufgerufen; Datenbank, Wache und Sperrprüfung sind Attrappen, die alles
 * durchlassen — hier geht es nicht um Rechte, sondern darum, dass jeder Pfad
 * das Protokoll bedient. `protokolliere` selbst ist gemockt und zeichnet auf.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ERIC = { id: "00000000-0000-4000-8000-0000000000e1", email: "eric.schmitt@bhyo.de", rolle: "admin" as const, name: "Eric Schmitt", aktiv: true };
const BERND = { id: "00000000-0000-4000-8000-0000000000b1", email: "bernd@bhyo.de", rolle: "bearbeiter" as const, name: "Bernd Bearbeiter", aktiv: true };
const NEU = "00000000-0000-4000-8000-00000000aaaa";
const STROM = "00000000-0000-4000-8000-00000000c001";

/** Zeilen, die jede Abfrage der Attrappe liefert — breit genug für alle Pfade. */
const ZEILEN = [
  { ...ERIC, code: "landwirtschaft", aktiv: true, status: "entwurf", belegId: null, reserviertSeit: null, letzte_nummer: 0, akteurId: NEU, kreis_ars: "08221" },
  { ...BERND, code: "kommune", aktiv: true, status: "entwurf", belegId: null, reserviertSeit: null, letzte_nummer: 0, akteurId: NEU, kreis_ars: "08221" },
];
/** AP2.5 (E66): vollstaendige Akteur-Eingabe — Name, Sektor, Sitz (PLZ, Ort), Pin. */
const AKTEUR_EINGABE = { name: "Hof Müller", sektor: "landwirtschaft", sitz_plz: "74889", sitz_ort: "Sinsheim", sitz_strasse: "Hauptstraße", sitz_hausnummer: "1", lat: "49.25", lng: "8.88" };
const EINGEFUEGT = [{ id: NEU, name: "x", sektor: null }];

/** Kette, die jeden Methodenaufruf annimmt und beim Warten Zeilen liefert. */
function kette(zeilen: unknown[]): unknown {
  const ziel = () => {};
  return new Proxy(ziel, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => void) => res(zeilen);
      if (prop === "transaction") return async (f: (t: unknown) => unknown) => f(kette(zeilen));
      if (prop === "execute") return async () => zeilen;
      if (prop === "insert" || prop === "returning") return () => kette(EINGEFUEGT);
      return () => kette(zeilen);
    },
    apply: () => kette(zeilen),
  });
}

const protokolliere = vi.fn(async () => {});
/** PR b: einzelne Tests brauchen einen Strom MIT Beleg (Beleg-Pflicht beim Pruefen). */
let aktuelleZeilen: unknown[] = ZEILEN;
const BELEG = "00000000-0000-4000-8000-0000000000b0";
const mitBeleg = (extra: Record<string, unknown> = {}) =>
  ZEILEN.map((z) => ({ ...z, belegId: BELEG, typ: "gespraech", gueltigBis: null, abgelaufenAm: null, ...extra }));
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => ERIC.email,
  withDb: async (fn: (db: unknown) => unknown) => fn(kette(aktuelleZeilen)),
  getBelegeBucket: async () => ({ put: async () => {}, get: async () => null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/wache", async (orig) => ({
  ...(await orig<typeof import("@/lib/rechte/wache")>()),
  rechtFuerAction: async () => ({ email: ERIC.email, zugang: { art: "erlaubt", ...ERIC } }),
  wacheFuerRoute: async () => ({ ok: true, zugang: { art: "erlaubt", ...ERIC } }),
}));
vi.mock("@/lib/rechte/sperre-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/rechte/sperre-server")>()),
  pruefeStromSperre: async () => ({ gesperrtVon: ERIC.id, gesperrtAm: new Date(), zugewiesene: [] }),
  pruefeBelegSperre: async () => {},
  loescheZuweisungen: async () => {},
}));
vi.mock("@/lib/formular-modell", async (orig) => ({
  ...(await orig<typeof import("@/lib/formular-modell")>()),
  validiereFormular: () => ({}),
}));
vi.mock("@/lib/vergabe-fenster", async (orig) => ({
  ...(await orig<typeof import("@/lib/vergabe-fenster")>()),
  validiereVergaben: () => ({}),
}));

const { statusSetzen, stromVerwerfen, stromPruefen, stromReverifizieren, belegAbgelaufenMarkieren } = await import("@/lib/stroeme-actions");
const { akteurBearbeiten, akteurLoeschen } = await import("@/lib/akteur-actions");
const { keineDubletteMarkieren, keineDubletteAufheben, akteureZusammenfuehren } = await import("@/lib/dubletten-actions");
const { stromSperren, stromEntsperren, stromZuweisen, zuweisungEntfernen } = await import("@/lib/sperre-actions");
const { benutzerAnlegen, rolleSetzen, aktivSetzen } = await import("@/lib/benutzer-actions");
const { stromSpeichern } = await import("@/lib/formular-actions");
const akteure = await import("@/app/api/akteure/route");
const regionen = await import("@/app/api/regionen/route");
const projekte = await import("@/app/api/projekte/route");

function ereignis() {
  expect(protokolliere).toHaveBeenCalledTimes(1);
  return (protokolliere.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
}
function post(body: unknown) {
  return new Request("http://test/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}
function formular(felder: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  protokolliere.mockClear();
  aktuelleZeilen = ZEILEN;
});

describe("jeder Schreibpfad protokolliert — Art, Urheber, Objektbezug", () => {
  // AP2.4 (E62, 0.4): jeder Statuswechsel mit eigener Art — status_gesetzt wird nie mehr geschrieben.
  it("statusSetzen entwurf → in_pruefung: in_pruefung_gegeben am Strom", async () => {
    expect(await statusSetzen("biomasse", STROM, "in_pruefung")).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "in_pruefung_gegeben", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
  });
  it("statusSetzen: geprueft geht hier nicht — das ist strom.pruefen", async () => {
    const r = await statusSetzen("biomasse", STROM, "geprueft");
    expect(r.ok).toBe(false);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("stromPruefen → geprueft am Strom (aus entwurf direkt, mit Beleg)", async () => {
    aktuelleZeilen = mitBeleg();
    expect(await stromPruefen("biomasse", STROM)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "geprueft", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
  });
  it("PR b: stromPruefen ohne Beleg — abgewiesen, kein Ereignis", async () => {
    expect(await stromPruefen("biomasse", STROM)).toEqual({ ok: false, fehler: "Ohne Beleg kann nicht geprüft werden." });
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("PR b: stromReverifizieren → reverifiziert am geprueften Strom mit Beleg, ohne Statuswechsel", async () => {
    aktuelleZeilen = mitBeleg({ status: "geprueft" });
    expect(await stromReverifizieren("output", STROM)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "reverifiziert", entitaet: "output_bedarf", id: STROM, benutzerId: ERIC.id });
  });
  it("PR b: stromReverifizieren — D3-Regeln: nicht geprueft, markiert, gueltig_bis erreicht → Fehler, kein Ereignis", async () => {
    aktuelleZeilen = mitBeleg({ status: "entwurf" });
    expect((await stromReverifizieren("biomasse", STROM)).ok).toBe(false);
    aktuelleZeilen = mitBeleg({ status: "geprueft", abgelaufenAm: "2026-09-01" });
    expect((await stromReverifizieren("biomasse", STROM)).fehler).toMatch(/Markierung aufheben/);
    aktuelleZeilen = mitBeleg({ status: "geprueft", typ: "vertrag", gueltigBis: "2026-01-01" });
    expect((await stromReverifizieren("biomasse", STROM)).fehler).toMatch(/Gültig bis ist erreicht/);
    aktuelleZeilen = mitBeleg({ status: "geprueft", typ: "vertrag", gueltigBis: "2099-01-01" });
    expect(await stromReverifizieren("biomasse", STROM)).toEqual({ ok: true });
    expect(protokolliere).toHaveBeenCalledTimes(1);
  });
  it("belegAbgelaufenMarkieren ohne Beleg: Fehler, kein Ereignis", async () => {
    const r = await belegAbgelaufenMarkieren("biomasse", STROM);
    expect(r).toEqual({ ok: false, fehler: "Der Strom hat keinen Beleg." });
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("stromVerwerfen → verworfen am Output-Bedarf", async () => {
    expect(await stromVerwerfen("output", STROM)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "verworfen", entitaet: "output_bedarf", id: STROM, benutzerId: ERIC.id });
  });
  it("stromSperren → gesperrt", async () => {
    expect(await stromSperren("biomasse", STROM)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "gesperrt", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
  });
  it("stromEntsperren → entsperrt", async () => {
    expect(await stromEntsperren("biomasse", STROM)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "entsperrt", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
  });
  it("stromZuweisen → zugewiesen, Text nennt die zugewiesene Person", async () => {
    expect(await stromZuweisen("biomasse", STROM, BERND.id)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "zugewiesen", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id, text: "Eric Schmitt zugewiesen" });
  });
  it("zuweisungEntfernen → zuweisung_entfernt", async () => {
    expect(await zuweisungEntfernen("biomasse", STROM, BERND.id)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "zuweisung_entfernt", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
  });
  it("benutzerAnlegen → benutzer_angelegt am NEUEN Benutzer", async () => {
    expect(await benutzerAnlegen({ ok: false }, formular({ email: "neu@bhyo.de", rolle: "betrachter" }))).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "benutzer_angelegt", entitaet: "benutzer", id: NEU, benutzerId: ERIC.id });
  });
  it("rolleSetzen → rolle_gesetzt am betroffenen Benutzer", async () => {
    expect(await rolleSetzen(BERND.email, "pruefer")).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "rolle_gesetzt", entitaet: "benutzer", id: BERND.id, benutzerId: ERIC.id });
  });
  it("aktivSetzen → benutzer_deaktiviert / benutzer_aktiviert", async () => {
    expect(await aktivSetzen(BERND.email, false)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "benutzer_deaktiviert", entitaet: "benutzer", id: BERND.id, benutzerId: ERIC.id });
    protokolliere.mockClear();
    expect(await aktivSetzen(BERND.email, true)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "benutzer_aktiviert" });
  });
  it("POST /api/akteure → akteur_angelegt (ohne Namen im Freitext, E57)", async () => {
    const antwort = await akteure.POST(post(AKTEUR_EINGABE));
    expect(antwort.status).toBe(201);
    expect(ereignis()).toMatchObject({ art: "akteur_angelegt", entitaet: "akteur", id: NEU, benutzerId: ERIC.id });
    expect(ereignis().text).toBeUndefined();
  });
  it("AP2.5: POST /api/akteure ohne PLZ/Ort oder ohne Pin → 400, kein Ereignis", async () => {
    for (const body of [{ ...AKTEUR_EINGABE, sitz_plz: "" }, { ...AKTEUR_EINGABE, sitz_ort: "" }, { ...AKTEUR_EINGABE, lat: "", lng: "" }]) {
      expect((await akteure.POST(post(body))).status).toBe(400);
    }
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("AP2.5: akteurBearbeiten → akteur_geaendert mit Feldnamen; akteurLoeschen (verwaist) → akteur_geloescht", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ ...AKTEUR_EINGABE, name: "Hof Müller GmbH" })) fd.set(k, v);
    expect(await akteurBearbeiten(STROM, fd)).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "akteur_geaendert", entitaet: "akteur", id: STROM, benutzerId: ERIC.id });
    expect(ereignis().text).toMatch(/^Felder: /);
    expect(ereignis().text).not.toContain("Müller");
    protokolliere.mockClear();
    expect(await akteurLoeschen(STROM)).toEqual({ ok: true });
    // PR b: die Attrappe liefert eine „Kontaktperson" beim Loeschen — je Person ein Ereignis (nur IDs), danach der Akteur.
    const arten = (protokolliere.mock.calls as unknown as [unknown, { art: string; entitaet: string; id: string; text?: string }][]).map((c) => c[1]);
    expect(arten.at(-1)).toMatchObject({ art: "akteur_geloescht", entitaet: "akteur", id: STROM, benutzerId: ERIC.id });
    for (const e of arten.slice(0, -1)) {
      expect(e).toMatchObject({ art: "kontaktperson_geloescht", entitaet: "kontaktperson" });
      expect(e.text).toBe(`Akteur ${STROM} gelöscht`);
    }
  });
  it("AP2.5 PR c: keineDubletteMarkieren → keine_dublette_markiert an BEIDEN Akteuren, Text nur IDs", async () => {
    const A = "00000000-0000-4000-8000-0000000000a1";
    const B = "00000000-0000-4000-8000-0000000000a2";
    expect(await keineDubletteMarkieren(B, A)).toEqual({ ok: true });
    const arten = (protokolliere.mock.calls as unknown as [unknown, { art: string; entitaet: string; id: string; text?: string }][]).map((c) => c[1]);
    expect(arten.map((e) => e.id)).toEqual([A, B]);
    for (const e of arten) expect(e).toMatchObject({ art: "keine_dublette_markiert", entitaet: "akteur", benutzerId: ERIC.id, text: `Paar ${A} · ${B}` });
  });
  it("AP2.5 PR c: keineDubletteAufheben → keine_dublette_aufgehoben an beiden Akteuren des Paars", async () => {
    const A = "00000000-0000-4000-8000-0000000000a1";
    const B = "00000000-0000-4000-8000-0000000000a2";
    aktuelleZeilen = [{ ...ZEILEN[0]!, a: A, b: B }];
    expect(await keineDubletteAufheben("00000000-0000-4000-8000-0000000000d1")).toEqual({ ok: true });
    const arten = (protokolliere.mock.calls as unknown as [unknown, { art: string; id: string; text?: string }][]).map((c) => c[1]);
    expect(arten.map((e) => e.id)).toEqual([A, B]);
    for (const e of arten) expect(e).toMatchObject({ art: "keine_dublette_aufgehoben", text: `Paar ${A} · ${B}` });
  });
  it("AP2.5 PR c: akteureZusammenfuehren → akteur_zusammengefuehrt an der Quelle ZUERST (Trigger liest es), akteur_geaendert am Ziel, geaendert je Strom, kontaktperson_geaendert je Person — nur IDs", async () => {
    const Q = "00000000-0000-4000-8000-0000000000a1";
    const Z = "00000000-0000-4000-8000-0000000000a2";
    // Die Attrappe liefert fuer jede Abfrage ZEILEN: zwei „Akteure" (ids ERIC/BERND passen nicht) — deshalb eigene Zeilen mit Q und Z.
    aktuelleZeilen = [
      { ...ZEILEN[0]!, id: Q, name: "Quelle GmbH", sektor: "landwirtschaft", sitzStrasse: null, sitzHausnummer: null, sitzPlz: "1", sitzOrt: "X", bezeichnung: "Strom A" },
      { ...ZEILEN[1]!, id: Z, name: "Ziel", sektor: "energie", sitzStrasse: null, sitzHausnummer: null, sitzPlz: "1", sitzOrt: "X", bezeichnung: "Strom B" },
    ];
    const erg = await akteureZusammenfuehren(Q, Z, { name: "quelle" });
    expect(erg).toMatchObject({ ok: true, zielId: Z });
    const arten = (protokolliere.mock.calls as unknown as [unknown, { art: string; entitaet: string; id: string; text?: string }][]).map((c) => c[1]);
    expect(arten[0]).toMatchObject({ art: "akteur_zusammengefuehrt", entitaet: "akteur", id: Q, benutzerId: ERIC.id });
    expect(arten[0]!.text).toContain(`Quelle ${Q} → Ziel ${Z}`);
    expect(arten[0]!.text).toContain("Felder aus Quelle: name");
    expect(arten[1]).toMatchObject({ art: "akteur_geaendert", entitaet: "akteur", id: Z });
    expect(arten.some((e) => e.art === "geaendert" && e.entitaet === "biomassestrom" && e.text === `Akteur zusammengeführt: ${Q} → ${Z}`)).toBe(true);
    expect(arten.some((e) => e.art === "kontaktperson_geaendert" && e.entitaet === "kontaktperson")).toBe(true);
    for (const e of arten) {
      expect(e.text ?? "").not.toContain("Quelle GmbH");
      expect(e.text ?? "").not.toContain("Ziel\b");
    }
  });
  it("POST /api/regionen → region_angelegt", async () => {
    const antwort = await regionen.POST(post({ name: "Kraichgau", bbox: [8.5, 49.0, 8.9, 49.3] }));
    expect(antwort.status).toBe(201);
    expect(ereignis()).toMatchObject({ art: "region_angelegt", entitaet: "region", benutzerId: ERIC.id });
  });
  it("POST /api/projekte (bestehende Region) → projekt_angelegt am Lauf", async () => {
    const antwort = await projekte.POST(post({ regionId: STROM }));
    expect(antwort.status).toBe(201);
    expect(ereignis()).toMatchObject({ art: "projekt_angelegt", entitaet: "analyse_lauf", id: NEU, benutzerId: ERIC.id });
  });
  it("POST /api/projekte (neue Region) → region_angelegt UND projekt_angelegt", async () => {
    const antwort = await projekte.POST(post({ name: "Neu", bbox: [8.5, 49.0, 8.9, 49.3] }));
    expect(antwort.status).toBe(201);
    expect(protokolliere.mock.calls.map((c) => (c as unknown as [unknown, { art: string }])[1].art)).toEqual(["region_angelegt", "projekt_angelegt"]);
  });
  it("stromSpeichern (anlegen) → angelegt; (bearbeiten) → geaendert mit Begründung", async () => {
    const felder = { akteur_id: NEU, materialart_code: "stroh", menge_roh_fm: "100", ts_anteil_pct: "30", aschegehalt_pct: "5", zeitraum_von: "01/2026", lat: "49.1", lng: "8.7", begruendung: "" };
    const neu = await stromSpeichern("biomasse", null, {}, formular(felder));
    expect(neu).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "angelegt", entitaet: "biomassestrom", id: NEU, benutzerId: ERIC.id });
    protokolliere.mockClear();
    const alt = await stromSpeichern("biomasse", STROM, {}, formular({ ...felder, begruendung: "Menge korrigiert" }));
    expect(alt).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "geaendert", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id, text: "Menge korrigiert" });
    expect(protokolliere).toHaveBeenCalledTimes(1);
  });
  it("AP2.5 (E66/E23): Umhaengen eines Stroms schreibt akteur_geaendert am ALTEN Akteur — nur die ID im Text", async () => {
    const felder = { akteur_id: "00000000-0000-4000-8000-0000000000a9", materialart_code: "stroh", menge_roh_fm: "100", ts_anteil_pct: "30", aschegehalt_pct: "5", zeitraum_von: "01/2026", lat: "49.1", lng: "8.7", begruendung: "Anderer Akteur" };
    expect(await stromSpeichern("biomasse", STROM, {}, formular(felder))).toEqual({ ok: true });
    const arten = (protokolliere.mock.calls as unknown as unknown[][]).map((c) => c[1] as { art: string; entitaet: string; id: string; text?: string });
    const alt = arten.find((a) => a.art === "akteur_geaendert");
    expect(alt).toMatchObject({ entitaet: "akteur", id: NEU, text: `Strom ${STROM} umgehängt` });
    expect(arten.some((a) => a.art === "geaendert" && a.entitaet === "biomassestrom")).toBe(true);
  });
});
