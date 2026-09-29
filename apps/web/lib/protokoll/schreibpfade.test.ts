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
  { ...ERIC, code: "landwirtschaft", status: "entwurf", belegId: null, reserviertSeit: null, letzte_nummer: 0 },
  { ...BERND, code: "kommune", status: "entwurf", belegId: null, reserviertSeit: null, letzte_nummer: 0 },
];
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
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => ERIC.email,
  withDb: async (fn: (db: unknown) => unknown) => fn(kette(ZEILEN)),
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

const { statusSetzen, stromVerwerfen } = await import("@/lib/stroeme-actions");
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

beforeEach(() => protokolliere.mockClear());

describe("jeder Schreibpfad protokolliert — Art, Urheber, Objektbezug", () => {
  it("statusSetzen → status_gesetzt am Strom", async () => {
    expect(await statusSetzen("biomasse", STROM, "in_pruefung")).toEqual({ ok: true });
    expect(ereignis()).toMatchObject({ art: "status_gesetzt", entitaet: "biomassestrom", id: STROM, benutzerId: ERIC.id });
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
  it("POST /api/akteure → akteur_angelegt", async () => {
    const antwort = await akteure.POST(post({ name: "Hof Müller", sektor: "landwirtschaft" }));
    expect(antwort.status).toBe(201);
    expect(ereignis()).toMatchObject({ art: "akteur_angelegt", entitaet: "akteur", id: NEU, benutzerId: ERIC.id });
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
  });
});
