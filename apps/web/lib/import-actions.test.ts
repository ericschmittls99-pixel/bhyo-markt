/**
 * AP2.7 PR a (E67): Rot zeigen — ein Bearbeiter startet einen Import und wird
 * abgewiesen, bevor irgendetwas geschrieben wird. Die Action wird echt
 * aufgerufen, Infrastruktur ist gemockt (Muster stroeme-actions.beleg.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle = "bearbeiter";
let schreibversuche = 0;
const protokolle: unknown[] = [];
const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const deletes: string[] = [];
const uploads: { key: string; bytes: number; contentType?: string }[] = [];
const uploadInhalte: string[] = [];
const geloescht: string[] = [];
/** Antworten auf db.select(...) in Aufrufreihenfolge; leer → der Benutzer (Zugangspruefung). */
const dbSelects: unknown[][] = [];
const txSelects: unknown[][] = [];
const aehnlichAufrufe: { name: string; plz: string | null }[] = [];
let aehnlichAntwort: (name: string) => { id: string; name: string; grad: string }[] = () => [];
let r2Inhalt: ArrayBuffer | null = null;

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "petra@bhyo.de",
  getEnvironment: async () => "test",
  getBelegeBucket: async () => ({
    put: async (key: string, daten: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => {
      uploads.push({ key, bytes: daten.byteLength, contentType: o?.httpMetadata?.contentType });
      uploadInhalte.push(new TextDecoder().decode(daten));
    },
    get: async () => (r2Inhalt ? { body: new Blob([r2Inhalt]).stream(), size: r2Inhalt.byteLength } : null),
    delete: async (key: string) => void geloescht.push(key),
    list: async () => ({ objects: [], truncated: false }),
  }),
  withDb: async (fn: (db: unknown) => unknown) => {
    // tx.select(...).from(...).where(...)[.orderBy()][.limit()] → naechste Antwort aus txSelects, sonst leer
    // (kein gleicher Hash, keine Vorlage gleichen Namens).
    const txKette = (): Record<string, unknown> => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy", "limit"]) p[m] = () => txKette();
      p.then = (res: (v: unknown) => void) => res(txSelects.shift() ?? []);
      return p;
    };
    const tx = {
      select: () => txKette(),
      insert: () => ({
        values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
          const p = {
            returning: async () => {
              schreibversuche += 1;
              inserts.push(...(Array.isArray(v) ? v : [v]));
              return [{ id: ((Array.isArray(v) ? v[0] : v)?.id as string | undefined) ?? "lauf-1" }];
            },
            then: (res: (x: unknown) => void) => {
              schreibversuche += 1;
              inserts.push(...(Array.isArray(v) ? v : [v]));
              res(undefined);
            },
          };
          return p;
        },
      }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void updates.push(v) }) }),
      // PR d: Loeschungen je Tabelle protokollieren; .returning() liefert leer (keine Interessen/Kontaktpersonen in der Attrappe).
      delete: (t: unknown) => ({
        where: () => ({
          returning: async () => {
            deletes.push(getTableName(t as never));
            return [];
          },
          then: (res: (v: unknown) => void) => {
            deletes.push(getTableName(t as never));
            res(undefined);
          },
        }),
      }),
      // Savepoint: dieselbe Attrappe, kein echtes Rollback — geprueft wird der Ablauf, nicht die DB.
      transaction: async (f: (t: unknown) => unknown) => f(tx),
    };
    // Die Zugangspruefung liest benutzer ohne Join; die Lauf-Lader joinen
    // benutzer an import_lauf (leftJoin) — daran erkennt die Attrappe, welche
    // Antwort faellig ist.
    const kette = (join = false): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit"]) p[m] = () => kette(join);
      // leftJoin (Lauf-Lader) und orderBy (Zeilen-Lader) markieren fachliche Abfragen.
      p.leftJoin = () => kette(true);
      p.orderBy = () => kette(true);
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res(join ? (dbSelects.shift() ?? []) : [{ id: "u1", rolle, aktiv: true, name: "Petra" }]);
      return p;
    };
    return fn({ select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
const photonAufrufe: string[] = [];
let photonAntwort: (q: string) => unknown[] = () => [];
let photonWeg = false;
vi.mock("@/lib/photon-server", async (orig) => {
  const echt = await orig<typeof import("./photon-server")>();
  return {
    ...echt,
    photonSuche: async (q: string) => {
      photonAufrufe.push(q);
      if (photonWeg) throw new echt.PhotonNichtErreichbar({ ursache: "netz", status: null, dauerMs: 1, antwort: "weg" });
      return photonAntwort(q);
    },
  };
});
// E68 PR 3: lokale Zuordnung (Stapel) und genaue Pins (Dienst) als Attrappen.
let plzAntwort: (plz: string, ort: string) => { plzBekannt: boolean; ortPasst: boolean; orte: string[]; pin: { lng: number; lat: number } | null } = () => ({ plzBekannt: true, ortPasst: true, orte: ["Speyer"], pin: { lng: 8.43, lat: 49.32 } });
const plzStapel: number[] = [];
// E72: PLZ-Kandidaten je Ort (eine Abfrage je Aufruf).
let ortAntwort: (ort: string) => { plz: string; ort: string; ars: string; kreis: string | null; land: string | null }[] = () => [];
const ortStapel: string[][] = [];
vi.mock("@/lib/plz-server", () => ({
  pruefePlzOrtStapel: async (_db: unknown, e: { plz: string; ort: string }[]) => {
    plzStapel.push(e.length);
    return e.map((x) => plzAntwort(x.plz, x.ort));
  },
  plzFuerOrtStapel: async (_db: unknown, orte: string[]) => {
    ortStapel.push(orte);
    return orte.map((o) => ortAntwort(o));
  },
}));
let pruefAntwort: (plz: string) => unknown = () => ({ ergebnis: { status: "plz_gebiet" }, kreise: null, dauerMs: 1 });
const pruefAufrufe: string[] = [];
vi.mock("@/lib/adresse-pruefung-server", () => ({
  pruefeAdresse: async (_db: unknown, e: { strasse: string; hausnummer: string; plz: string; ort: string }) => {
    pruefAufrufe.push(`${e.strasse} ${e.hausnummer}, ${e.plz} ${e.ort}`.trim());
    return pruefAntwort(e.plz);
  },
}));
const bausteinAufrufe: string[] = [];
const preisBezuege: string[] = [];
const belegDaten: { typ: string; erhebungsdatum: string | null; gueltigBis: string | null }[] = [];
let stromFehltAb: Set<string> = new Set();
vi.mock("@/lib/strom-schreibweg", async (orig) => {
  const echt = await orig<typeof import("./strom-schreibweg")>();
  return {
    ...echt,
    stromAnlegenInTx: async (_tx: unknown, _h: unknown, e: { eingaben: { akteurId: string; materialartCode: string }; belegId?: string | null }) => {
      bausteinAufrufe.push(`strom:${e.eingaben.materialartCode}:${e.eingaben.akteurId}:${e.belegId ?? "-"}`);
      preisBezuege.push((e.eingaben as { preisBezug?: string }).preisBezug ?? "");
      if (stromFehltAb.has(e.eingaben.materialartCode)) throw new echt.FeldFehlerAusnahme({ menge_roh_fm: "Pflichtfeld" });
      return { id: "strom-neu" };
    },
  };
});
vi.mock("@/lib/akteur-schreibweg", async (orig) => {
  const echt = await orig<typeof import("./akteur-schreibweg")>();
  return {
    ...echt,
    akteurAnlegenInTx: async (_tx: unknown, _h: unknown, a: { eingabe: Record<string, string> }) => {
      bausteinAufrufe.push(`akteur:${a.eingabe.name}:${a.eingabe.sektor}`);
      if (!a.eingabe.lat) throw new echt.AkteurFehlerAusnahme("Der Ort ist nicht bestimmbar (Test).");
      return { id: `akteur-${a.eingabe.name}`, name: a.eingabe.name, sektor: a.eingabe.sektor };
    },
  };
});
vi.mock("@/lib/beleg-server", async (orig) => {
  const echt = await orig<typeof import("./beleg-server")>();
  return {
    ...echt,
    erstelleBeleg: async (_tx: unknown, e: { typ: string; dateiKey?: string | null; quellenangabe: string | null; erhebungsdatum: string | null; gueltigBis: string | null }) => {
      bausteinAufrufe.push(`beleg:${e.typ}:${e.dateiKey}:${e.quellenangabe}`);
      belegDaten.push({ typ: e.typ, erhebungsdatum: e.erhebungsdatum, gueltigBis: e.gueltigBis });
      return { belegId: `beleg-${e.typ}-${e.erhebungsdatum}` };
    },
  };
});
vi.mock("@/lib/register", () => ({ ladeSektoren: async () => [{ code: "landwirtschaft", label: "Landwirtschaft", aktiv: true }, { code: "ohne_sektor", label: "ohne Sektor", aktiv: true }] }));
const mengenAufrufe: { schluessel: string; name: string; plz: string | null }[][] = [];
const inboxZustellungen: Record<string, unknown>[] = [];
vi.mock("@/lib/inbox/zustellung", () => ({
  stelleImportAbschlussZu: async (_tx: unknown, e: Record<string, unknown>) => {
    inboxZustellungen.push(e);
    return 2;
  },
}));
vi.mock("@/lib/dubletten", () => ({
  // Mengenbasiert: EIN Aufruf je Stapel mit allen Eingaben; Antwort je Schluessel.
  sucheAehnlicheMenge: async (_db: unknown, eingaben: { schluessel: string; name: string; plz: string | null }[]) => {
    mengenAufrufe.push(eingaben);
    for (const e of eingaben) aehnlichAufrufe.push({ name: e.name, plz: e.plz });
    return new Map(eingaben.map((e) => [e.schluessel, aehnlichAntwort(e.name)]));
  },
}));
vi.mock("@/lib/protokoll", () => ({ protokolliere: async (_tx: unknown, e: unknown) => { protokolle.push(e); return { id: "e1" }; } }));

const { importAdressenAufloesen, importAkteurEntscheiden, importAkteureAufloesen, importAusfuehren, importZeileBearbeiten, importZeileUeberspringen, importZuruecknehmen, importPinsErmitteln, importBelegDatenSetzen, importDateiHochladen, importProbelauf, importLaufAnlegen, importVorlageSpeichern, importZuordnungSpeichern, importAkteurSektorWaehlen, importDoppelzeileEntscheiden, importLaufVerwerfen } = await import("./import-actions");
const { vorschlagZuordnung } = await import("./import-zuordnung");

const BEISPIELE = join(__dirname, "..", "..", "..", "docs", "beispiele");
function upload(felder: Record<string, string>, datei: File | null): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) fd.set(k, v);
  if (datei) fd.set("datei", datei);
  return fd;
}
const csvDatei = () => new File([readFileSync(join(BEISPIELE, "import-biomasse.csv"))], "import-biomasse.csv", { type: "text/csv" });
const laufFelder = { art: "biomasse", beleg_typ: "betriebsdaten", standard_sektor: "ohne_sektor" };

const eingabe = { art: "biomasse", dateiname: "stroeme-2026.xlsx", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor" };

beforeEach(() => { schreibversuche = 0; protokolle.length = 0; inserts.length = 0; updates.length = 0; deletes.length = 0; plzStapel.length = 0; pruefAufrufe.length = 0; uploads.length = 0; uploadInhalte.length = 0; geloescht.length = 0; dbSelects.length = 0; txSelects.length = 0; aehnlichAufrufe.length = 0; mengenAufrufe.length = 0; aehnlichAntwort = () => []; ortStapel.length = 0; ortAntwort = () => []; photonAufrufe.length = 0; photonAntwort = () => []; photonWeg = false; bausteinAufrufe.length = 0; belegDaten.length = 0; inboxZustellungen.length = 0; stromFehltAb = new Set(); r2Inhalt = null; preisBezuege.length = 0; });

describe("importLaufAnlegen (import.ausfuehren)", () => {
  it("Rot: ein Bearbeiter wird abgewiesen, nichts wird geschrieben", async () => {
    rolle = "bearbeiter";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg.ok).toBeUndefined();
    expect(erg.fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("ein Pruefer legt den Lauf an; das Ereignis traegt die Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg).toMatchObject({ ok: true, id: "lauf-1" });
    expect(schreibversuche).toBe(1);
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_lauf", id: "lauf-1", importLaufId: "lauf-1" });
  });

  it("unvollstaendige Eingabe wird vor jeder Wirkung abgewiesen", async () => {
    rolle = "admin";
    const erg = await importLaufAnlegen({ ...eingabe, dateiHash: "kein-hash", belegTyp: "" });
    expect(erg.feldFehler).toMatchObject({ dateiHash: expect.any(String), belegTyp: expect.any(String) });
    expect(schreibversuche).toBe(0);
  });
});

describe("importDateiHochladen (PR b: Upload, Hash, Roh-Upload, Lauf)", () => {
  it("Rot: ein Bearbeiter wird abgewiesen — kein Upload, kein Schreibversuch", async () => {
    rolle = "bearbeiter";
    const erg = await importDateiHochladen({}, upload(laufFelder, csvDatei()));
    expect(erg.fehler).toMatch(/recht/i);
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("ohne Datei, falscher Typ oder zu gross: Feldfehler, nichts hochgeladen, nichts geschrieben", async () => {
    rolle = "pruefer";
    expect((await importDateiHochladen({}, upload(laufFelder, null))).feldFehler?.dateiname).toMatch(/auswählen/);
    expect((await importDateiHochladen({}, upload(laufFelder, new File(["x"], "liste.pdf")))).feldFehler?.dateiname).toMatch(/nicht unterstützt/);
    const gross = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "gross.csv");
    expect((await importDateiHochladen({}, upload(laufFelder, gross))).feldFehler?.dateiname).toMatch(/5 MB/);
    expect((await importDateiHochladen({}, upload(laufFelder, new File(["Nur;Kopf\n"], "nurkopf.csv")))).feldFehler?.dateiname).toMatch(/keine Datenzeile/);
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
  });

  it("fehlender Belegtyp oder Sektor: Feldfehler vor dem Upload", async () => {
    rolle = "admin";
    const erg = await importDateiHochladen({}, upload({ ...laufFelder, beleg_typ: "", standard_sektor: "" }, csvDatei()));
    expect(erg.feldFehler).toMatchObject({ belegTyp: expect.any(String), standardSektor: expect.any(String) });
    expect(uploads).toHaveLength(0);
    expect(schreibversuche).toBe(0);
  });

  it("ein Pruefer laedt die Beispiel-CSV hoch: Roh-Upload unter import/<env>/<lauf>/roh.csv, Lauf mit Hash und Zaehlern, Ereignis mit Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importDateiHochladen({}, upload(laufFelder, csvDatei()));
    expect(erg.ok).toBe(true);
    expect(erg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploads).toEqual([{ key: `import/test/${erg.id}/roh.csv`, bytes: 526, contentType: "text/csv" }]);
    expect(schreibversuche).toBe(1);
    expect(inserts[0]).toMatchObject({
      id: erg.id,
      art: "biomasse",
      dateiname: "import-biomasse.csv",
      dateiHash: "9e03cf9b31e8720138b4b743151f7d967e1a0181c205b3e2cc996c734a71e8fa",
      belegTyp: "betriebsdaten",
      standardSektor: "ohne_sektor",
      status: "angelegt",
      zaehler: { zeilen: 3, spalten: 14 },
    });
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_lauf", id: erg.id, importLaufId: erg.id, text: "Import-Lauf angelegt: import-biomasse.csv (biomasse, 3 Zeilen)" });
    // Personen-Inhalte landen nirgends: weder im Insert noch im Ereignis.
    expect(JSON.stringify([inserts, protokolle])).not.toMatch(/Mustermann|example\.invalid/);
  });
});

describe("importZuordnungSpeichern (PR b: Zeilen uebernehmen, Roh-Upload loeschen)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (status = "angelegt") => ({ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 3, spalten: 14 }, erstellerEmail: "petra@bhyo.de", createdAt: new Date(), updatedAt: new Date() });
  const csvBytes = () => { const b = readFileSync(join(BEISPIELE, "import-biomasse.csv")); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  const SPALTEN = ["Betrieb", "Sektor", "Straße", "Hausnummer", "PLZ", "Ort", "Ansprechpartner", "E-Mail", "Materialart", "Menge", "Einheit", "TS-Anteil %", "Zeitraum von", "Zeitraum bis"];
  const vollstaendig = () => ({
    spalten: { ...vorschlagZuordnung("biomasse", SPALTEN), Hausnummer: "aschegehalt_pct" },
    werte: { materialart_code: { Rindergülle: "guelle_rind", Maissilage: "maissilage" }, akteur_sektor: { Landwirtschaft: "landwirtschaft" } },
  });

  it("Rot: ein Bearbeiter wird abgewiesen — nichts gelesen, nichts geschrieben", async () => {
    rolle = "bearbeiter";
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
    expect(geloescht).toHaveLength(0);
  });

  it("ein schon zugeordneter Lauf wird nicht noch einmal zugeordnet", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.fehler).toMatch(/schon „zugeordnet"/);
    expect(schreibversuche).toBe(0);
  });

  it("fehlende Pflichtfelder: Meldungen, nichts gespeichert, Roh-Upload bleibt", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile()]);
    r2Inhalt = csvBytes();
    const z = vollstaendig();
    z.spalten.Hausnummer = "akteur_sitz_hausnummer";
    // PR e: Aschegehalt ist keine Pflicht mehr (unbekannt erlaubt) — die Materialart bleibt es.
    const sp = z.spalten as Record<string, string>;
    for (const k of Object.keys(sp)) if (sp[k] === "materialart_code") sp[k] = "ignorieren";
    const erg = await importZuordnungSpeichern(LAUF, z);
    expect(erg.fehlerListe).toEqual([expect.stringMatching(/Pflichtfelder ohne Spalte: Materialart/)]);
    expect(schreibversuche).toBe(0);
    expect(updates).toHaveLength(0);
    expect(geloescht).toHaveLength(0);
  });

  it("ein Pruefer speichert die Zuordnung: 3 Zeilen (2 offen, 1 Fehler), Lauf zugeordnet, Ereignis mit Zaehlern, Roh-Upload geloescht, kein Personen-Inhalt", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile()]);
    r2Inhalt = csvBytes();
    const erg = await importZuordnungSpeichern(LAUF, vollstaendig());
    expect(erg.ok).toBe(true);
    expect(erg.zaehler).toMatchObject({ zeilen: 3, offen: 2, fehler: 1, personen_spalten: 2, spalten: 14 });
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({ laufId: LAUF, zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof Mustermann", materialart_code: "guelle_rind", menge_roh_fm: "1235", hinweis_menge_roh_fm: expect.stringMatching(/gerundet/), zeitraum_von: "2026-01" } });
    expect(inserts[2]).toMatchObject({ zeilennummer: 4, status: "fehler", fehlergrund: expect.stringMatching(/Festmist/) });
    expect(updates[0]).toMatchObject({ status: "zugeordnet", zaehler: expect.objectContaining({ offen: 2 }) });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", id: LAUF, importLaufId: LAUF, text: expect.stringMatching(/Kopfzeile 1, 3 Zeilen \(2 offen, 1 mit Fehler, 0 Doppelzeile\(n\)\), übersprungen 0 über der Kopfzeile \/ 0 leer \/ 0 Summe \/ 0 Fußzeile\(n\), 2 Personen-Spalte/) });
    expect(geloescht).toEqual([`import/test/${LAUF}/roh.csv`]);
    // „Hof Mustermann" ist der Betrieb (Akteur) und darf stehen; die Person „Max Mustermann", E-Mails und die Spaltennamen nicht.
    expect(JSON.stringify([inserts, updates, protokolle])).not.toMatch(/Max Mustermann|Erika|example\.invalid|Ansprech|E-Mail/);
    // Bereinigte Kopie als Datei des Lauf-Belegs: unter belege/, ohne Personen-Spalten.
    expect(uploads).toEqual([{ key: `belege/test/import/${LAUF}/bereinigt.csv`, bytes: expect.any(Number), contentType: "text/csv; charset=utf-8" }]);
    // TextDecoder der Attrappe entfernt das BOM; das BOM selbst prueft import-zuordnung.test.ts.
    expect(uploadInhalte[0]).toMatch(/^Betrieb;Sektor;/);
    expect(uploadInhalte[0]).not.toMatch(/Max Mustermann|example\.invalid|Ansprech|E-Mail/);
  });
});

describe("importVorlageSpeichern (PR b)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const zuordnung = { spalten: { Betrieb: "akteur_name", "E-Mail": "person" }, werte: { materialart_code: { Gülle: "guelle_rind" } } };

  it("Rot: Bearbeiter abgewiesen, nichts geschrieben", async () => {
    rolle = "bearbeiter";
    expect((await importVorlageSpeichern(LAUF, "Kammer", "", zuordnung)).fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
  });

  it("Personen-Ziel oder leerer Name: abgewiesen vor jeder Wirkung", async () => {
    rolle = "admin";
    expect((await importVorlageSpeichern(LAUF, "Kammer", "", { spalten: { Mail: "email" }, werte: {} })).fehler).toMatch(/Personen-Daten/);
    expect((await importVorlageSpeichern(LAUF, "   ", "", zuordnung)).fehler).toMatch(/1 bis 120/);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("neue Vorlage: Insert mit Zuordnung, Ereignis angelegt an import_vorlage mit Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importVorlageSpeichern(LAUF, " Kammer Jahresmeldung ", "LWK", zuordnung);
    expect(erg.ok).toBe(true);
    expect(inserts[0]).toMatchObject({ name: "Kammer Jahresmeldung", quelle: "LWK", spalten: zuordnung.spalten, werte: zuordnung.werte, erstellerId: "u1" });
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_vorlage", importLaufId: LAUF, text: expect.stringMatching(/2 Spalten/) });
  });
});

describe("importAkteureAufloesen / importAkteurEntscheiden (PR b)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (status: string) => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 4 }, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const zeilen = () => [
    { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof Mustermann", akteur_sitz_plz: "67346" } },
    { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { akteur_name: "Biogas Kraichgau GmbH", akteur_sitz_plz: "76646" } },
    { id: "z3", zeilennummer: 4, status: "fehler", fehlergrund: "Materialart fehlt", felder: { akteur_name: "HOF Mustermann", akteur_sitz_plz: "67346" } },
    { id: "z4", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { materialart_code: "x" } },
  ];

  it("Rot: Bearbeiter abgewiesen, Matcher nicht gefragt", async () => {
    rolle = "bearbeiter";
    expect((await importAkteureAufloesen(LAUF)).fehler).toMatch(/recht/i);
    expect(aehnlichAufrufe).toHaveLength(0);
  });

  it("vor der Zuordnung gibt es nichts aufzuloesen", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("angelegt")]);
    expect((await importAkteureAufloesen(LAUF)).fehler).toMatch(/nach der Zuordnung/);
    expect(aehnlichAufrufe).toHaveLength(0);
  });

  it("ein Matcher-Aufruf fuer den ganzen Stapel (je Gruppe eine Eingabe, nicht je Zeile): identisch uebernommen, stark als Vorschlag, Zeile ohne Name wird Fehler", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push(zeilen());
    aehnlichAntwort = (name) =>
      name === "Hof Mustermann"
        ? [{ id: "a1", name: "Hof Mustermann", grad: "identisch" }, { id: "a9", name: "Hof Musterfrau", grad: "stark" }]
        : [{ id: "a2", name: "Biogas Kraichgau", grad: "stark" }];
    const erg = await importAkteureAufloesen(LAUF);
    expect(erg).toMatchObject({ ok: true, bearbeitet: 2, offen: 0 });
    // EIN Aufruf mit zwei Eingaben; die dritte Zeile derselben Gruppe ist keine eigene Eingabe; z4 hat keinen Namen.
    expect(mengenAufrufe).toHaveLength(1);
    expect(aehnlichAufrufe).toEqual([{ name: "Hof Mustermann", plz: "67346" }, { name: "Biogas Kraichgau GmbH", plz: "76646" }]);
    expect(erg.zaehler).toMatchObject({ akteure_gruppen: 2, akteure_identisch: 1, akteure_vorschlag: 1, akteure_neu: 0, aehnlich: 1 });
    // zwei Gruppen-Updates, ein Update fuer die Zeile ohne Name, ein Lauf-Update
    expect(updates).toHaveLength(4);
    expect(updates[2]).toMatchObject({ status: "fehler" });
    expect(updates[3]).toMatchObject({ status: "aufgeloest" });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", importLaufId: LAUF, text: "Akteure aufgelöst: 2 Gruppen — 1 identisch, 1 Vorschlag, 0 neu; 1 Zeile(n) ohne Akteur-Name" });
  });

  it("E72: Zeile ohne PLZ, Ort eindeutig -> PLZ ergaenzt, Hinweis, Matcher sieht die PLZ (Zeile 18 Mosbach); nicht eindeutig -> Befund am Feld Sitz-PLZ, Zeile Fehler, Matcher ohne PLZ (Zeile 21 Freiburg)", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([
      { id: "z1", zeilennummer: 18, status: "offen", fehlergrund: null, felder: { akteur_name: "Hofgut Kirchberg", akteur_sitz_ort: "Mosbach" } },
      { id: "z2", zeilennummer: 21, status: "offen", fehlergrund: null, felder: { akteur_name: "Kompostwerk Breisgau", akteur_sitz_ort: "Freiburg" } },
      { id: "z3", zeilennummer: 22, status: "offen", fehlergrund: null, felder: { akteur_name: "Biohof", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
    ]);
    ortAntwort = (ort) =>
      ort === "Mosbach"
        ? [{ plz: "74821", ort: "Mosbach", ars: "081255002045", kreis: "Neckar-Odenwald-Kreis", land: "Baden-Württemberg" }]
        : [
            { plz: "21729", ort: "Freiburg (Elbe)", ars: "033590014014", kreis: "Landkreis Stade", land: "Niedersachsen" },
            { plz: "79098", ort: "Freiburg im Breisgau", ars: "083110000000", kreis: "Stadtkreis Freiburg im Breisgau", land: "Baden-Württemberg" },
          ];
    aehnlichAntwort = () => [];
    const erg = await importAkteureAufloesen(LAUF);
    expect(erg).toMatchObject({ ok: true, bearbeitet: 3, offen: 0 });
    // EINE Kandidaten-Abfrage mit beiden Orten (z3 hat eine PLZ).
    expect(ortStapel).toEqual([["Mosbach", "Freiburg"]]);
    // Der Matcher bekommt die ergaenzte PLZ fuer Mosbach, keine fuer Freiburg.
    expect(aehnlichAufrufe).toEqual([{ name: "Hofgut Kirchberg", plz: "74821" }, { name: "Kompostwerk Breisgau", plz: null }, { name: "Biohof", plz: "67346" }]);
    // Zeilen-Updates: PLZ+Hinweis (z1), Befund+Fehlerstatus (z2), dann drei Gruppen, Lauf.
    expect(updates).toHaveLength(6);
    expect(updates[1]).toMatchObject({ status: "fehler", fehlergrund: expect.stringMatching(/^Akteur · Sitz PLZ: Ort „Freiburg" ist ohne PLZ nicht eindeutig \(mehrere Orte dieses Namens\) — Kandidaten: Freiburg \(Elbe\), Landkreis Stade, Niedersachsen: 21729; Freiburg im Breisgau, Stadtkreis Freiburg im Breisgau, Baden-Württemberg: 79098 — PLZ in der Zeile ergänzen\.$/) });
    expect(updates[0]).not.toHaveProperty("status");
    expect(erg.zaehler).toMatchObject({ plz_aus_ort: 1, plz_aus_ort_offen: 1, akteure_gruppen: 3 });
    expect(protokolle[0]).toMatchObject({ text: expect.stringMatching(/; PLZ aus Ort: 1 ergänzt, 1 Zeile\(n\) in der Nacharbeit$/) });
  });

  it("E72: Zeilen mit PLZ, Gruppe oder eigenem Befund fragen keine Kandidaten ab (keine Endlosschleife ueber Stapel)", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([
      { id: "z1", zeilennummer: 2, status: "fehler", fehlergrund: "x", felder: { akteur_name: "A", akteur_sitz_ort: "Freiburg", fehler_akteur_sitz_plz: "Ort „Freiburg\" ist nicht bekannt — PLZ in der Zeile ergänzen." } },
      { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { akteur_name: "B", akteur_sitz_ort: "Mosbach", akteur_gruppe: "b|", akteur_neu: "1" } },
    ]);
    aehnlichAntwort = () => [];
    await importAkteureAufloesen(LAUF);
    expect(ortStapel).toHaveLength(0);
  });

  it("Stapel: 250 Gruppen → erster Request 200 (Lauf bleibt zugeordnet), zweiter die restlichen 50 (Lauf aufgeloest)", async () => {
    rolle = "pruefer";
    const viele = Array.from({ length: 250 }, (_, i) => ({ id: `z${i}`, zeilennummer: i + 2, status: "offen", fehlergrund: null, felder: { akteur_name: `Betrieb ${i}`, akteur_sitz_plz: "10000" } }));
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push(viele);
    const erg1 = await importAkteureAufloesen(LAUF);
    expect(erg1).toMatchObject({ ok: true, bearbeitet: 200, offen: 50 });
    expect(mengenAufrufe).toHaveLength(1);
    expect(mengenAufrufe[0]).toHaveLength(200);
    expect(updates[updates.length - 1]).not.toHaveProperty("status");
    expect(protokolle[0]).toMatchObject({ art: "geaendert", text: "Akteure auflösen: Stapel mit 200 Gruppen, 50 noch offen" });
    // Zweiter Request: die ersten 200 tragen jetzt akteur_gruppe.
    const rest = viele.map((z, i) => (i < 200 ? { ...z, felder: { ...z.felder, akteur_gruppe: `betrieb ${i}|10000`, akteur_neu: "1" } } : z));
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push(rest);
    const erg2 = await importAkteureAufloesen(LAUF);
    expect(erg2).toMatchObject({ ok: true, bearbeitet: 50, offen: 0 });
    expect(mengenAufrufe[1]).toHaveLength(50);
    expect(updates[updates.length - 1]).toMatchObject({ status: "aufgeloest" });
  });

  it("Vorschlag uebernehmen: nur Zeilen mit Vorschlag der Gruppe, Zaehler wandern, Ereignis", async () => {
    rolle = "admin";
    dbSelects.push([{ ...laufZeile("aufgeloest"), zaehler: { akteure_vorschlag: 1, akteure_identisch: 1, aehnlich: 1 } }]);
    txSelects.push([
      { id: "z2", zeilennummer: 3, status: "aehnlich", fehlergrund: null, felder: { akteur_name: "Biogas Kraichgau GmbH", akteur_gruppe: "biogas kraichgau gmbh|76646", akteur_vorschlag_id: "a2", akteur_vorschlag_name: "Biogas Kraichgau" } },
      { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof Mustermann", akteur_gruppe: "hof mustermann|67346", akteur_id: "a1" } },
    ]);
    const erg = await importAkteurEntscheiden(LAUF, "biogas kraichgau gmbh|76646", "vorhanden");
    expect(erg.ok).toBe(true);
    expect(erg.zaehler).toMatchObject({ akteure_vorschlag: 0, akteure_identisch: 2, aehnlich: 0 });
    expect(updates).toHaveLength(2);
    expect(protokolle[0]).toMatchObject({ art: "geaendert", text: expect.stringMatching(/übernommen: Gruppe biogas kraichgau gmbh\|76646, 1 Zeile/) });
  });

  it("ohne offenen Vorschlag: Meldung, nichts geschrieben", async () => {
    rolle = "admin";
    dbSelects.push([laufZeile("aufgeloest")]);
    txSelects.push([{ id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "A", akteur_id: "a1" } }]);
    expect((await importAkteurEntscheiden(LAUF, null, "neu")).fehler).toMatch(/Kein offener Vorschlag/);
    expect(updates).toHaveLength(0);
  });
});

describe("importAdressenAufloesen (E68 PR 3: lokal, eine Abfrage, kein Netz)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (status: string) => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 4 }, belegErhebungsdatum: null, belegGueltigBis: null, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const zeilen = () => [
    { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof A", akteur_neu: "1", akteur_sitz_strasse: "Dorfstraße", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
    { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof A", akteur_neu: "1", akteur_sitz_strasse: "Dorfstraße", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
    { id: "z3", zeilennummer: 4, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof B", akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Brusal" } },
    { id: "z4", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { akteur_name: "Vorhanden", akteur_id: "a1", akteur_sitz_plz: "11111", akteur_sitz_ort: "X" } },
    { id: "z5", zeilennummer: 6, status: "offen", fehlergrund: null, felder: { akteur_name: "Hof C", akteur_neu: "1", akteur_sitz_plz: "00000", akteur_sitz_ort: "Nirgends" } },
  ];

  it("Rot: Bearbeiter abgewiesen, keine Abfrage", async () => {
    rolle = "bearbeiter";
    expect((await importAdressenAufloesen(LAUF)).fehler).toMatch(/recht/i);
    expect(plzStapel).toHaveLength(0);
  });

  it("nur nach dem Aufloesen der Akteure", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    expect((await importAdressenAufloesen(LAUF)).fehler).toMatch(/nach dem Auflösen/);
    expect(plzStapel).toHaveLength(0);
  });

  it("alle Adressen in EINER Abfrage; Rot: unbekannte PLZ und Ort passt nicht bleiben mit „Meinten Sie …?“ stehen", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("aufgeloest")], [...zeilen()]);
    plzAntwort = (plz, ort) =>
      plz === "00000"
        ? { plzBekannt: false, ortPasst: false, orte: [], pin: null }
        : plz === "76646"
          ? { plzBekannt: true, ortPasst: ort === "Bruchsal", orte: ["Bruchsal", "Forst", "Karlsdorf-Neuthard"], pin: { lng: 8.59, lat: 49.12 } }
          : { plzBekannt: true, ortPasst: true, orte: ["Speyer"], pin: { lng: 8.43, lat: 49.32 } };
    const erg = await importAdressenAufloesen(LAUF);
    expect(erg).toEqual({ ok: true, bearbeitet: 3, offen: 0, ohneTreffer: 2 });
    expect(plzStapel).toEqual([3]); // drei eindeutige Adressen neuer Akteure, z4 ist vorhanden
    expect(updates).toHaveLength(4); // drei Gruppen, ein Lauf-Update
    expect(updates[3]).toMatchObject({ zaehler: expect.objectContaining({ adressen_gefunden: 1, adressen_offen: 2 }) });
    expect(protokolle[0]).toMatchObject({ art: "geaendert", importLaufId: LAUF, text: expect.stringMatching(/^Adressen lokal zugeordnet: 3 Adresse\(n\), 2 offen \(PLZ\/Ort\), \d+ ms$/) });
  });

  it("nichts mehr offen: ok ohne Abfrage", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("aufgeloest")], [{ id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_neu: "1", akteur_sitz_lat: "49", akteur_sitz_lng: "8" } }]);
    expect(await importAdressenAufloesen(LAUF)).toEqual({ ok: true, bearbeitet: 0, offen: 0, ohneTreffer: 0 });
    expect(plzStapel).toHaveLength(0);
  });
});

describe("importPinsErmitteln (E68 PR 3: optional, eine Anfrage je Sekunde, fortsetzbar)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = () => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: {}, belegErhebungsdatum: null, belegGueltigBis: null, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const ungefaehr = (id: string, plz: string, versucht = false) => ({ id, zeilennummer: 2, status: "offen", fehlergrund: null, felder: { akteur_neu: "1", akteur_sitz_strasse: "Dorfstraße", akteur_sitz_hausnummer: "3", akteur_sitz_plz: plz, akteur_sitz_ort: "Speyer", akteur_sitz_lat: "49.3", akteur_sitz_lng: "8.4", akteur_sitz_quelle: "plz_gebiet", akteur_sitz_genauigkeit: "plz_gebiet", ...(versucht ? { akteur_sitz_genau_versucht: "1" } : {}) } });

  it("Treffer hebt die Genauigkeit, kein Treffer markiert nur „versucht“; schon versuchte Adressen werden nicht erneut gefragt", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rolle = "pruefer";
    dbSelects.push([laufZeile()], [ungefaehr("z1", "67346"), ungefaehr("z2", "67347"), ungefaehr("z3", "67348", true)]);
    pruefAntwort = (plz) =>
      plz === "67346"
        ? { ergebnis: { status: "treffer", genauigkeit: "hausnummer", adresse: { lng: 8.431, lat: 49.321 } }, kreise: null, dauerMs: 5 }
        : { ergebnis: { status: "plz_gebiet" }, kreise: 1, dauerMs: 5 };
    const erg = await importPinsErmitteln(LAUF);
    vi.useRealTimers();
    expect(erg).toEqual({ ok: true, bearbeitet: 2, verbessert: 1, offen: 0 });
    expect(pruefAufrufe).toEqual(["Dorfstraße 3, 67346 Speyer", "Dorfstraße 3, 67347 Speyer"]);
    expect(updates[0]).toMatchObject({});
    expect(protokolle[0]).toMatchObject({ text: "Genaue Pins ermittelt: 2 Adresse(n), 1 verbessert, 0 noch offen" });
  });

  it("Rot: Bearbeiter abgewiesen", async () => {
    rolle = "bearbeiter";
    expect((await importPinsErmitteln(LAUF)).fehler).toMatch(/recht/i);
    expect(pruefAufrufe).toHaveLength(0);
  });
});

describe("importBelegDatenSetzen (PR b, Migration 0044)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (belegTyp: string) => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp, standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: {}, belegErhebungsdatum: null, belegGueltigBis: null, zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });

  it("Gueltig-bis ist bei den oberen vier Typen Pflicht (E33), Erhebungsdatum immer; falsches Format wird genannt", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("betriebsdaten")]);
    expect((await importBelegDatenSetzen(LAUF, "2026-10-06", "")).feldFehler).toEqual({ gueltigBis: "Gültig bis ist bei diesem Belegtyp Pflicht (E33)." });
    dbSelects.push([laufZeile("gespraech")]);
    expect((await importBelegDatenSetzen(LAUF, "6.10.2026", "")).feldFehler).toEqual({ erhebungsdatum: "Erhebungsdatum (JJJJ-MM-TT) ist Pflicht." });
    expect(updates).toHaveLength(0);
  });

  it("speichert Erhebungsdatum und Gueltig-bis mit Ereignis", async () => {
    rolle = "admin";
    dbSelects.push([laufZeile("betriebsdaten")]);
    expect(await importBelegDatenSetzen(LAUF, "2026-10-06", "2027-10-06")).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: null, zeitraumBis: null });
    expect(protokolle[0]).toMatchObject({ art: "geaendert", importLaufId: LAUF, text: "Belegdaten des Laufs gesetzt: Erhebungsdatum 2026-10-06, gültig bis 2027-10-06" });
  });
});

describe("importBelegDatenSetzen — Zeitraum des Laufs (PR e)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = () => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "gespraech", standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: {}, belegErhebungsdatum: null, belegGueltigBis: null, zeitraumVon: null, zeitraumBis: null, blatt: null, kopfzeile: null, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const ohneZeitraum = [{ id: "z1", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { akteur_name: "A", materialart_code: "x" } }];

  it("Rot: Zeilen ohne eigenen Zeitraum, kein Lauf-Zeitraum → Feldfehler, nichts gespeichert", async () => {
    rolle = "admin";
    dbSelects.push([lauf()], ohneZeitraum);
    const erg = await importBelegDatenSetzen(LAUF, "2026-10-06", "");
    expect(erg.feldFehler).toMatchObject({ zeitraumVon: expect.stringMatching(/Pflicht: 1 Zeile/), zeitraumBis: expect.stringMatching(/kein „unbefristet/) });
    expect(updates).toHaveLength(0);
  });

  it("MM/JJJJ wird als Datum gespeichert, bis vor von ist ein Fehler", async () => {
    rolle = "admin";
    dbSelects.push([lauf()], ohneZeitraum);
    expect((await importBelegDatenSetzen(LAUF, "2026-10-06", "", "12/2026", "01/2026")).feldFehler).toMatchObject({ zeitraumBis: expect.stringMatching(/vor Zeitraum von/) });
    dbSelects.push([lauf()], ohneZeitraum);
    expect(await importBelegDatenSetzen(LAUF, "2026-10-06", "", "01/2026", "12/2026")).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31" });
    expect(protokolle[0]).toMatchObject({ text: expect.stringMatching(/Zeitraum 01\/2026–12\/2026/) });
  });
});

describe("importProbelauf (PR b: Stapel, Savepoints, Rollback, Ergebnisse)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (teil: Record<string, unknown> = {}) => ({ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: { zeilen: 4 }, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date(), ...teil });
  const strom = (code: string) => ({ materialart_code: code, menge_roh_fm: "100", ts_anteil_pct: "8", aschegehalt_pct: "1", zeitraum_von: "2026-01", zeitraum_bis: "2026-12" });
  const zeilen = () => [
    { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "Hof A", akteur_neu: "1", akteur_gruppe: "hof a|67346", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43" } },
    { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { ...strom("maissilage"), akteur_name: "Hof A", akteur_neu: "1", akteur_gruppe: "hof a|67346", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43", beleg_typ: "gespraech" } },
    { id: "z3", zeilennummer: 4, status: "fehler", fehlergrund: "alt", felder: { ...strom("festmist"), akteur_name: "Vorhanden", akteur_id: "a1" } },
    { id: "z4", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "Hof B", akteur_neu: "1", akteur_gruppe: "hof b|76646", akteur_sitz_plz: "76646", akteur_sitz_offen: "Kein Treffer der Adresssuche." } },
  ];

  it("Rot: Bearbeiter abgewiesen, kein Baustein gerufen", async () => {
    rolle = "bearbeiter";
    expect((await importProbelauf(LAUF, 2)).fehler).toMatch(/recht/i);
    expect(bausteinAufrufe).toHaveLength(0);
  });

  it("ohne Belegdaten oder mit offenen Vorschlaegen startet nichts", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf({ belegErhebungsdatum: null })]);
    expect((await importProbelauf(LAUF, 2)).fehler).toMatch(/Belegdaten fehlen/);
    dbSelects.push([lauf()], [{ id: "z9", zeilennummer: 2, status: "aehnlich", fehlergrund: null, felder: {} }]);
    expect((await importProbelauf(LAUF, 2)).fehler).toMatch(/offene Akteur-Vorschläge/);
    expect(bausteinAufrufe).toHaveLength(0);
  });

  it("prueft jede Zeile durch die Bausteine: ein Beleg je Typ, ein neuer Akteur je Gruppe, Zeilenfehler mit Grund, Lauf wird „probelauf“", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()], zeilen());
    stromFehltAb = new Set(["festmist"]);
    const erg = await importProbelauf(LAUF, 2);
    expect(erg).toEqual({ ok: true, bearbeitet: 4, okZeilen: 2, fehlerZeilen: 2, naechste: null });
    expect(bausteinAufrufe).toEqual([
      `beleg:betriebsdaten:belege/test/import/${LAUF}/bereinigt.csv:import-biomasse.csv · Import-Lauf ${LAUF}`,
      "akteur:Hof A:ohne_sektor",
      "strom:guelle_rind:akteur-Hof A:beleg-betriebsdaten-2026-10-06",
      `beleg:gespraech:belege/test/import/${LAUF}/bereinigt.csv:import-biomasse.csv · Import-Lauf ${LAUF}`,
      "strom:maissilage:akteur-Hof A:beleg-gespraech-2026-10-06",
      "strom:festmist:a1:beleg-betriebsdaten-2026-10-06",
    ]);
    // Ergebnisse: z1, z2 ok; z3 Feldfehler; z4 Sitz offen (Akteur nie versucht). Danach Lauf-Update.
    expect(updates.slice(0, 4).map((u) => [u.status, u.fehlergrund])).toEqual([
      ["offen", null],
      ["offen", null],
      ["fehler", "menge_roh_fm: Pflichtfeld"],
      ["fehler", "Sitz offen: Kein Treffer der Adresssuche."],
    ]);
    expect(updates[4]).toMatchObject({ status: "probelauf", zaehler: expect.objectContaining({ probelauf_ok: 2, probelauf_fehler: 2 }) });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", importLaufId: LAUF, text: "Probelauf abgeschlossen: 4 Zeile(n), 2 ok, 2 mit Fehler — nichts angelegt" });
  });

  it("zugeordnete Datumsspalten gehen dem Lauf-Wert je Zeile vor: eigener geteilter Beleg je (Typ, Erhebungsdatum, Gueltig-bis)", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()], [
      { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1" } },
      { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1", beleg_erhebungsdatum: "2026-03-15", beleg_gueltig_bis: "2027-03-15" } },
      { id: "z3", zeilennummer: 4, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1", beleg_erhebungsdatum: "2026-03-15", beleg_gueltig_bis: "2027-03-15" } },
      { id: "z4", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1", beleg_erhebungsdatum: "irgendwann" } },
    ]);
    const erg = await importProbelauf(LAUF, 2);
    expect(erg).toMatchObject({ ok: true, okZeilen: 3, fehlerZeilen: 1 });
    // Lauf-Werte fuer z1, Zeilenwerte fuer z2+z3 (ein Beleg fuer beide), z4 scheitert am Datum.
    expect(belegDaten).toEqual([
      { typ: "betriebsdaten", erhebungsdatum: "2026-10-06", gueltigBis: "2027-10-06" },
      { typ: "betriebsdaten", erhebungsdatum: "2026-03-15", gueltigBis: "2027-03-15" },
    ]);
    expect(updates[3]).toMatchObject({ status: "fehler", fehlergrund: "Erhebungsdatum „irgendwann\" ist kein Datum (JJJJ-MM-TT)." });
  });

  it("Gueltig-bis fehlt fuer einen oberen Belegtyp je Zeile → Zeilenfehler, nicht Abbruch", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf({ belegTyp: "gespraech", belegGueltigBis: null, zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31" })], [{ id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1", beleg_typ: "vertrag" } }]);
    const erg = await importProbelauf(LAUF, 2);
    expect(erg).toMatchObject({ ok: true, okZeilen: 0, fehlerZeilen: 1 });
    expect(updates[0]).toMatchObject({ status: "fehler", fehlergrund: "Gültig bis fehlt für Belegtyp „vertrag\" (E33)." });
  });
});

describe("importAusfuehren (PR c: COMMIT, Savepoint je Zeile, Akteur je Gruppe, Abschluss)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (teil: Record<string, unknown> = {}) => ({ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "probelauf", zaehler: { zeilen: 4, personen_spalten: 2 }, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date(), ...teil });
  const strom = (code: string) => ({ materialart_code: code, menge_roh_fm: "100", ts_anteil_pct: "8", aschegehalt_pct: "1", zeitraum_von: "2026-01", zeitraum_bis: "2026-12" });
  const zeilen = () => [
    { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "Hof A", akteur_neu: "1", akteur_gruppe: "hof a|67346", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43", probelauf: "ok" } },
    { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: { ...strom("maissilage"), akteur_name: "Hof A", akteur_neu: "1", akteur_gruppe: "hof a|67346", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43" } },
    { id: "z3", zeilennummer: 4, status: "fehler", fehlergrund: "Materialart fehlt", felder: { akteur_name: "Hof B", akteur_neu: "1" } },
    { id: "z4", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { ...strom("festmist"), akteur_name: "Vorhanden", akteur_id: "a1" } },
  ];

  it("Rot: Bearbeiter abgewiesen; ohne durchgelaufenen Probelauf startet nichts", async () => {
    rolle = "bearbeiter";
    expect((await importAusfuehren(LAUF, 2)).fehler).toMatch(/recht/i);
    rolle = "admin";
    dbSelects.push([lauf({ status: "aufgeloest" })]);
    expect((await importAusfuehren(LAUF, 2)).fehler).toMatch(/nach einem durchgelaufenen Probelauf/);
    expect(bausteinAufrufe).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("legt nur offene Zeilen an: Beleg einmal, Akteur einmal je Gruppe (zurueckgeschrieben), Zeile importiert mit Strom-ID, Fehlerzeile bleibt, Abschluss mit Ereignissen und Inbox", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()], zeilen());
    stromFehltAb = new Set(["festmist"]);
    const erg = await importAusfuehren(LAUF, 2);
    expect(erg).toEqual({ ok: true, bearbeitet: 3, importiert: 2, fehlerZeilen: 1, naechste: null });
    expect(bausteinAufrufe).toEqual([
      `beleg:betriebsdaten:belege/test/import/${LAUF}/bereinigt.csv:import-biomasse.csv · Import-Lauf ${LAUF}`,
      "akteur:Hof A:ohne_sektor",
      "strom:guelle_rind:akteur-Hof A:beleg-betriebsdaten-2026-10-06",
      "strom:maissilage:akteur-Hof A:beleg-betriebsdaten-2026-10-06",
      "strom:festmist:a1:beleg-betriebsdaten-2026-10-06",
    ]);
    // Updates: Rueckschreiben akteur_id fuer die Gruppe (z1, z2), z1 importiert, z2 importiert, z4 fehler, Lauf.
    expect(updates.map((u) => u.status ?? "(felder)")).toEqual(["(felder)", "importiert", "importiert", "fehler", "ausgefuehrt"]);
    expect(updates[1]).toMatchObject({ status: "importiert", fehlergrund: null, biomassestromId: "strom-neu" });
    expect(updates[3]).toMatchObject({ status: "fehler", fehlergrund: "menge_roh_fm: Pflichtfeld" });
    expect(updates[4]).toMatchObject({ status: "ausgefuehrt", abgeschlossenAm: expect.any(Date), zaehler: expect.objectContaining({ importiert: 2, fehler: 2, offen: 0, akteure_angelegt: 1 }) });
    // Ereignisse: kontaktdaten_uebersprungen je Akteur einmal (Hof A, dann a1), Abschluss am Lauf.
    expect(protokolle.filter((p) => (p as { art: string }).art === "kontaktdaten_uebersprungen").map((p) => (p as { id: string }).id)).toEqual(["akteur-Hof A"]);
    expect(protokolle[protokolle.length - 1]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", importLaufId: LAUF, text: "Import ausgeführt: 2 Ströme angelegt, 1 neue Akteure, 2 Zeile(n) in der Nacharbeit, 0 übersprungen" });
    expect(inboxZustellungen).toEqual([{ importLaufId: LAUF, ausloeserId: "u1", ereignisId: "e1", importiert: 2 }]);
  });

  it("ohne Personen-Spalten kein kontaktdaten_uebersprungen; Stapelgrenze liefert naechste Zeile und laesst den Lauf im Probelauf-Zustand", async () => {
    rolle = "pruefer";
    const viele = Array.from({ length: 101 }, (_, i) => ({ id: `z${i}`, zeilennummer: i + 2, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1" } }));
    dbSelects.push([lauf({ zaehler: { zeilen: 101 } })], viele);
    const erg = await importAusfuehren(LAUF, 2);
    expect(erg).toMatchObject({ ok: true, bearbeitet: 100, importiert: 100, naechste: 102 });
    expect(protokolle.some((p) => (p as { art: string }).art === "kontaktdaten_uebersprungen")).toBe(false);
    expect(updates[updates.length - 1]).not.toHaveProperty("status");
    expect(inboxZustellungen).toHaveLength(0);
  });
});

describe("Nacharbeit (PR c): importZeileBearbeiten / importZeileUeberspringen", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const ZEILE = "22222222-2222-4222-8222-222222222222";
  const lauf = (status = "ausgefuehrt") => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: {}, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const zeile = (teil: Record<string, unknown> = {}) => ({ id: ZEILE, zeilennummer: 7, status: "fehler", felder: { akteur_name: "Hof A", akteur_sitz_plz: "67346", akteur_id: "a1", akteur_gruppe: "hof a|67346", materialart_code: "", menge_roh_fm: "100" }, ...teil });

  it("Rot: Bearbeiter abgewiesen; Personen-Schluessel und fremde Felder vor jeder Wirkung abgewiesen", async () => {
    rolle = "bearbeiter";
    expect((await importZeileBearbeiten(LAUF, ZEILE, { menge_roh_fm: "5" })).fehler).toMatch(/recht/i);
    rolle = "pruefer";
    dbSelects.push([lauf()]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, { email: "x@example.invalid" })).fehler).toMatch(/Personen-Daten/);
    dbSelects.push([lauf()]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, { produkt_code: "x" })).fehler).toMatch(/kein Zielfeld dieses Laufs/);
    dbSelects.push([lauf()]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, {})).fehler).toMatch(/Keine Änderung/);
    expect(updates).toHaveLength(0);
    expect(protokolle).toHaveLength(0);
  });

  it("korrigiert Felder, setzt die Zeile offen; Akteur-Aenderung loescht die Aufloesung; Ereignis nennt nur Feldnamen", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()]);
    txSelects.push([zeile()]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { materialart_code: "guelle", menge_roh_fm: "", akteur_name: "Hof A neu" })).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ status: "offen", fehlergrund: null });
    // Der Feld-Patch ist ein SQL-Ausdruck (jsonb || … - 'schluessel'); seine Texte genuegen als Beleg.
    const texte = (o: unknown, seen = new Set<object>()): string[] => {
      if (!o || typeof o !== "object" || seen.has(o)) return [];
      seen.add(o);
      return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : texte(v, seen)));
    };
    const sqlText = texte(updates[0]!.felder).join(" ");
    expect(sqlText).toContain("guelle");
    expect(sqlText).toContain("akteur_id");
    expect(sqlText).toContain("akteur_gruppe");
    expect(sqlText).toContain("probelauf");
    expect(protokolle[0]).toMatchObject({ art: "geaendert", importLaufId: LAUF, text: "Nacharbeit Zeile 7: Felder materialart_code, menge_roh_fm, akteur_name — Akteur wird erneut aufgelöst" });
    expect(JSON.stringify(protokolle)).not.toContain("Hof A");
  });

  it("E72: Ort-Aenderung bei leerer PLZ loescht Aufloesung, eigenen PLZ-aus-Ort-Befund und Hinweis — ein Formatfehler bleibt; mit PLZ zaehlt nur die PLZ", async () => {
    rolle = "pruefer";
    const texte = (o: unknown, seen = new Set<object>()): string[] => {
      if (!o || typeof o !== "object" || seen.has(o)) return [];
      seen.add(o);
      return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : texte(v, seen)));
    };
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ felder: { akteur_name: "Kompostwerk Breisgau", akteur_sitz_ort: "Freiburg", akteur_gruppe: "kompostwerk breisgau|", akteur_neu: "1", fehler_akteur_sitz_plz: "Ort „Freiburg\" ist nicht bekannt — PLZ in der Zeile ergänzen.", materialart_code: "x", menge_roh_fm: "1" } })]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { akteur_sitz_ort: "Freiburg im Breisgau" })).toEqual({ ok: true });
    let sqlText = texte(updates[0]!.felder).join(" ");
    expect(sqlText).toContain("akteur_gruppe");
    expect(sqlText).toContain("fehler_akteur_sitz_plz");
    expect(sqlText).toContain("hinweis_akteur_sitz_plz");
    expect(updates[0]).toMatchObject({ status: "offen", fehlergrund: null });
    expect(protokolle[0]).toMatchObject({ text: "Nacharbeit Zeile 7: Felder akteur_sitz_ort — Akteur wird erneut aufgelöst" });
    // Rot: ein Formatfehler am Feld Sitz-PLZ ist kein eigener Befund und bleibt stehen.
    updates.length = 0;
    protokolle.length = 0;
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ felder: { akteur_name: "X", akteur_sitz_ort: "Freiburg", akteur_gruppe: "x|", akteur_neu: "1", fehler_akteur_sitz_plz: "muss fünfstellig sein", materialart_code: "x", menge_roh_fm: "1" } })]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { akteur_sitz_ort: "Freiburg (Elbe)" })).toEqual({ ok: true });
    sqlText = texte(updates[0]!.felder).join(" ");
    expect(sqlText).toContain("akteur_gruppe");
    expect(sqlText).not.toContain("fehler_akteur_sitz_plz");
    expect(updates[0]).toMatchObject({ status: "fehler", fehlergrund: "Akteur · Sitz PLZ: muss fünfstellig sein" });
    // Mit PLZ: eine Ort-Aenderung allein loest keine neue Aufloesung aus (Gruppe ist Name + PLZ).
    updates.length = 0;
    protokolle.length = 0;
    dbSelects.push([lauf()]);
    txSelects.push([zeile()]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { akteur_sitz_ort: "Speyer" })).toEqual({ ok: true });
    expect(texte(updates[0]!.felder).join(" ")).not.toContain("akteur_gruppe");
    expect(protokolle[0]).toMatchObject({ text: "Nacharbeit Zeile 7: Felder akteur_sitz_ort" });
  });

  it("importierte Zeilen lassen sich nicht bearbeiten oder ueberspringen; Ueberspringen setzt uebersprungen", async () => {
    rolle = "admin";
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ status: "importiert" })]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, { menge_roh_fm: "5" })).fehler).toMatch(/nur offene und fehlerhafte/);
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ status: "importiert" })]);
    expect((await importZeileUeberspringen(LAUF, ZEILE)).fehler).toMatch(/schon importiert/);
    dbSelects.push([lauf("probelauf")]);
    txSelects.push([zeile()]);
    expect(await importZeileUeberspringen(LAUF, ZEILE)).toEqual({ ok: true });
    expect(updates[updates.length - 1]).toEqual({ status: "uebersprungen" });
    expect(protokolle[protokolle.length - 1]).toMatchObject({ text: "Nacharbeit Zeile 7: übersprungen" });
  });
});

describe("importZuruecknehmen (PR d: nur Admin, nur unbearbeitet, alles protokolliert)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (status = "ausgefuehrt") => ({ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { importiert: 2 }, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const zeilen = () => [
    { id: "z1", zeilennummer: 2, status: "importiert", fehlergrund: null, biomassestromId: "s1", outputBedarfId: null, felder: { akteur_id: "a-neu" } },
    { id: "z2", zeilennummer: 3, status: "importiert", fehlergrund: null, biomassestromId: "s2", outputBedarfId: null, felder: { akteur_id: "a1" } },
    { id: "z3", zeilennummer: 4, status: "fehler", fehlergrund: "x", biomassestromId: null, outputBedarfId: null, felder: {} },
  ];

  it("Rot: Pruefer und Bearbeiter werden abgewiesen (nur Admin), nichts geloescht", async () => {
    for (const r of ["pruefer", "bearbeiter"]) {
      rolle = r;
      expect((await importZuruecknehmen(LAUF)).fehler).toMatch(/Admins vorbehalten|recht/i);
    }
    expect(deletes).toHaveLength(0);
  });

  it("nur ein ausgefuehrter Lauf laesst sich zuruecknehmen", async () => {
    rolle = "admin";
    dbSelects.push([lauf("probelauf")]);
    expect((await importZuruecknehmen(LAUF)).fehler).toMatch(/nur ein ausgeführter Lauf/);
    expect(deletes).toHaveLength(0);
  });

  it("Rot: ein Strom des Laufs wurde danach bearbeitet → abgewiesen mit Zeilennummer, nichts geloescht, kein Ereignis", async () => {
    rolle = "admin";
    dbSelects.push([lauf()]);
    // tx-Abfragen in Reihenfolge: Zeilen, Stroeme aus dem Protokoll, fremde Ereignisse.
    txSelects.push(zeilen(), [{ id: "s1" }, { id: "s2" }], [{ id: "s2", art: "geprueft" }]);
    const erg = await importZuruecknehmen(LAUF);
    expect(erg.fehler).toMatch(/Rücknahme abgewiesen: 1 Strom\/Ströme wurden nach dem Import bearbeitet \(geprueft\)\. Zeilen: 3\./);
    expect(erg.bearbeitet).toEqual([3]);
    expect(deletes).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(protokolle).toHaveLength(0);
  });

  it("nimmt den Lauf zurueck: Abhaengiges, Stroeme, Lauf-Beleg, neuer verwaister Akteur — in dieser Reihenfolge, alles protokolliert", async () => {
    rolle = "admin";
    dbSelects.push([lauf()]);
    txSelects.push(
      zeilen(),
      [{ id: "s1" }, { id: "s2" }],
      [], // keine fremden Ereignisse
      [{ id: "s1", belegId: "b1", akteurId: "a-neu" }, { id: "s2", belegId: "b1", akteurId: "a1" }],
      [{ id: "b1", nutzer: 0 }], // Lauf-Beleg, nach dem Loeschen der Stroeme ungenutzt
      [{ id: "a-neu" }], // im Lauf angelegte Akteure
      [{ id: "a-neu", stroeme: 0 }], // jetzt verwaist
    );
    const erg = await importZuruecknehmen(LAUF);
    expect(erg).toEqual({ ok: true, stroeme: 2, belege: 1, akteure: 1 });
    expect(deletes).toEqual(["strom_zuweisung", "vergabe_zeitraum", "inbox_eintrag", "biomassestrom", "beleg", "akteur_interesse", "kontaktperson", "akteur"]);
    expect(updates[0]).toMatchObject({ biomassestromId: null, status: "offen" });
    expect(updates[updates.length - 1]).toMatchObject({ status: "zurueckgenommen", zurueckgenommenAm: expect.any(Date), zaehler: expect.objectContaining({ importiert: 0, offen: 2, zurueckgenommen_stroeme: 2, zurueckgenommen_belege: 1, zurueckgenommen_akteure: 1 }) });
    expect(protokolle.map((p) => `${(p as { art: string }).art}:${(p as { entitaet: string }).entitaet}`)).toEqual(["verworfen:biomassestrom", "verworfen:biomassestrom", "akteur_geloescht:akteur", "status_gesetzt:import_lauf"]);
    expect(protokolle.every((p) => (p as { importLaufId?: string }).importLaufId === LAUF)).toBe(true);
    expect(protokolle[3]).toMatchObject({ text: "Import zurückgenommen: 2 Ströme, 1 Beleg(e), 1 Akteur(e) gelöscht" });
  });
});

/** SQL-Texte eines Feld-Patches (jsonb || … - 'schluessel') als Beleg. */
const sqlTexte = (o: unknown, seen = new Set<object>()): string[] => {
  if (!o || typeof o !== "object" || seen.has(o)) return [];
  seen.add(o);
  return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : sqlTexte(v, seen)));
};

describe("PR f — B3: Zuordnungsfehler bleiben an der Zeile, Probelauf und Ausfuehren setzen nie ok", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (teil: Record<string, unknown> = {}) => ({ id: LAUF, art: "biomasse", dateiname: "t.xlsx", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: { zeilen: 2 }, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date(), ...teil });
  const strom = (code: string) => ({ materialart_code: code, menge_roh_fm: "2400", zeitraum_von: "2026-01", zeitraum_bis: "2026-12" });
  // z2: Einheit m³/a — der Zuordnungsfehler haengt am Mengenfeld, der Rohwert 2400 steht zur Korrektur da.
  const zeilen = () => [
    { id: "z1", zeilennummer: 5, status: "offen", fehlergrund: null, felder: { ...strom("guelle_rind"), akteur_name: "V", akteur_id: "a1" } },
    { id: "z2", zeilennummer: 16, status: "fehler", fehlergrund: "Menge (t FM/a): Einheit „m³/a\" ist nicht umrechenbar", felder: { ...strom("klaerschlamm"), akteur_name: "V", akteur_id: "a1", fehler_menge_roh_fm: "Einheit „m³/a\" ist nicht umrechenbar — erlaubt sind t oder kg je Jahr oder Monat." } },
  ];

  it("Rot (Probelauf): Zeile 16 mit Einheitenfehler bleibt Fehler mit dem Zuordnungsgrund — kein Baustein fuer sie, Zeile 5 ist ok", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()], zeilen());
    const erg = await importProbelauf(LAUF, 5);
    expect(erg).toMatchObject({ ok: true, okZeilen: 1, fehlerZeilen: 1 });
    expect(bausteinAufrufe.filter((b) => b.startsWith("strom:"))).toEqual(["strom:guelle_rind:a1:beleg-betriebsdaten-2026-10-06"]);
    expect(updates.slice(0, 2).map((u) => [u.status, u.fehlergrund])).toEqual([
      ["offen", null],
      ["fehler", "Menge (t FM/a): Einheit „m³/a\" ist nicht umrechenbar — erlaubt sind t oder kg je Jahr oder Monat."],
    ]);
  });

  it("Rot (Ausfuehren): eine offene Zeile mit Zuordnungsfehler wird nicht angelegt, sondern Fehler", async () => {
    rolle = "pruefer";
    const z = zeilen();
    z[1]!.status = "offen";
    dbSelects.push([lauf({ status: "probelauf" })], z);
    const erg = await importAusfuehren(LAUF, 5);
    expect(erg).toMatchObject({ ok: true, importiert: 1, fehlerZeilen: 1 });
    expect(bausteinAufrufe.filter((b) => b.startsWith("strom:"))).toHaveLength(1);
    expect(updates.map((u) => u.status)).toEqual(["importiert", "fehler", "ausgefuehrt"]);
    expect(updates[1]).toMatchObject({ status: "fehler", fehlergrund: expect.stringMatching(/^Menge \(t FM\/a\): Einheit „m³\/a"/) });
  });

  it("Sektor-Konflikt (Weggabelung 6) blockiert Probelauf und Ausfuehren, bis je Akteur entschieden ist", async () => {
    rolle = "pruefer";
    const konflikt = [
      { id: "z1", zeilennummer: 8, status: "offen", fehlergrund: null, felder: { ...strom("gruenschnitt"), akteur_name: "Stadtwerke Speyer", akteur_sitz_plz: "67346", akteur_sektor: "energie", akteur_neu: "1", akteur_gruppe: "stadtwerke speyer|67346", akteur_sitz_lat: "1", akteur_sitz_lng: "1" } },
      { id: "z2", zeilennummer: 9, status: "offen", fehlergrund: null, felder: { ...strom("laub"), akteur_name: "SW Speyer", akteur_sitz_plz: "67346", akteur_sektor: "kommune", akteur_neu: "1", akteur_gruppe: "stadtwerke speyer|67346", akteur_sitz_lat: "1", akteur_sitz_lng: "1" } },
    ];
    dbSelects.push([lauf()], konflikt);
    expect((await importProbelauf(LAUF, 8)).fehler).toMatch(/Sektor-Konflikt bei 1 Akteur/);
    dbSelects.push([lauf({ status: "probelauf" })], konflikt);
    expect((await importAusfuehren(LAUF, 8)).fehler).toMatch(/Sektor-Konflikt/);
    expect(bausteinAufrufe).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("importAkteurSektorWaehlen: nur aktive Sektoren; setzt den Sektor in allen Zeilen der Gruppe, Ereignis ohne Personen", async () => {
    rolle = "bearbeiter";
    expect((await importAkteurSektorWaehlen(LAUF, "stadtwerke speyer|67346", "landwirtschaft")).fehler).toMatch(/recht/i);
    rolle = "pruefer";
    dbSelects.push([lauf()]);
    expect((await importAkteurSektorWaehlen(LAUF, "stadtwerke speyer|67346", "gastronomie")).fehler).toMatch(/kein aktiver Sektor/);
    dbSelects.push([lauf()]);
    txSelects.push([
      { id: "z1", zeilennummer: 8, status: "offen", fehlergrund: null, felder: { akteur_name: "Stadtwerke Speyer", akteur_sitz_plz: "67346", akteur_sektor: "energie" } },
      { id: "z2", zeilennummer: 9, status: "fehler", fehlergrund: "Akteur · Sektor: Wert „Kommune\" ist keinem Code zugeordnet.", felder: { akteur_name: "SW Speyer", akteur_sitz_plz: "67346", akteur_sektor: "", fehler_akteur_sektor: "Wert „Kommune\" ist keinem Code zugeordnet." } },
      { id: "z3", zeilennummer: 10, status: "offen", fehlergrund: null, felder: { akteur_name: "Anderer", akteur_sitz_plz: "1", akteur_sektor: "forst" } },
    ]);
    expect(await importAkteurSektorWaehlen(LAUF, "stadtwerke speyer|67346", "landwirtschaft")).toEqual({ ok: true, zeilen: 2 });
    // z1 bekommt den Sektor; z2 dazu: der Sektor-Fehler faellt weg, die Zeile wird wieder offen.
    expect(updates).toHaveLength(2);
    expect(sqlTexte(updates[0]!.felder).join(" ")).toContain("landwirtschaft");
    expect(updates[1]).toMatchObject({ status: "offen", fehlergrund: null });
    expect(sqlTexte(updates[1]!.felder).join(" ")).toContain("fehler_akteur_sektor");
    expect(protokolle[0]).toMatchObject({ art: "geaendert", importLaufId: LAUF, text: "Sektor-Konflikt entschieden: Gruppe stadtwerke speyer|67346 → landwirtschaft, 2 Zeile(n)" });
  });
});

describe("PR f — Doppelzeilen (Weggabelung 7): aehnlich, voreingestellt ueberspringen", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const laufZeile = (status = "angelegt") => ({ id: LAUF, art: "biomasse", dateiname: "doppel.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 3, spalten: 6 }, belegErhebungsdatum: null, belegGueltigBis: null, zeitraumVon: null, zeitraumBis: null, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const SPALTEN = ["Betrieb", "PLZ", "Ort", "Materialart", "Menge", "Einheit"];
  const csv = ["Betrieb;PLZ;Ort;Materialart;Menge;Einheit", "Hof A;67346;Speyer;Rindergülle;4500;t/a", "Hof B;67346;Speyer;Maissilage;100;t/a", "Hof A;67346;Speyer;Rindergülle;4500;t/a"].join("\r\n");

  it("Zuordnung speichern: die dritte Zeile ist die Doppelzeile der ersten → aehnlich mit doppel_von, Zaehler und Ereignis nennen sie", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile()]);
    r2Inhalt = new TextEncoder().encode(csv).buffer as ArrayBuffer;
    const erg = await importZuordnungSpeichern(LAUF, { spalten: vorschlagZuordnung("biomasse", SPALTEN), werte: { materialart_code: { Rindergülle: "guelle_rind", Maissilage: "maissilage" } } });
    expect(erg.ok).toBe(true);
    expect(erg.zaehler).toMatchObject({ zeilen: 3, offen: 2, fehler: 0, doppelzeilen: 1 });
    expect(inserts.map((i) => [i.zeilennummer, i.status])).toEqual([[2, "offen"], [3, "offen"], [4, "aehnlich"]]);
    expect(inserts[2]).toMatchObject({ felder: expect.objectContaining({ doppel_von: "2" }) });
    expect((protokolle[0] as { text: string }).text).toMatch(/1 Doppelzeile\(n\)/);
  });

  it("Entscheiden: ueberspringen setzt uebersprungen mit Grund; importieren setzt offen (oder Fehler, wenn Zuordnungsfehler da sind)", async () => {
    rolle = "pruefer";
    const z = (teil: Record<string, string> = {}) => ({ id: "z3", zeilennummer: 4, status: "aehnlich", fehlergrund: null, felder: { akteur_name: "Hof A", doppel_von: "2", ...teil } });
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([z()]);
    expect(await importDoppelzeileEntscheiden(LAUF, null, "ueberspringen")).toEqual({ ok: true, zeilen: 1 });
    expect(updates[0]).toMatchObject({ status: "uebersprungen", fehlergrund: "Doppelzeile von Zeile 2 — übersprungen." });
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([z()]);
    expect(await importDoppelzeileEntscheiden(LAUF, "z3", "importieren")).toEqual({ ok: true, zeilen: 1 });
    expect(updates[1]).toMatchObject({ status: "offen", fehlergrund: null });
    expect(sqlTexte(updates[1]!.felder).join(" ")).toMatch(/hinweis_doppelzeile.*Doppelzeile von Zeile 2, bewusst importiert/);
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([z({ fehler_menge_roh_fm: "x" })]);
    expect(await importDoppelzeileEntscheiden(LAUF, "z3", "importieren")).toEqual({ ok: true, zeilen: 1 });
    expect(updates[2]).toMatchObject({ status: "fehler", fehlergrund: "Menge (t FM/a): x" });
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([]);
    expect((await importDoppelzeileEntscheiden(LAUF, null, "ueberspringen")).fehler).toMatch(/Keine offene Doppelzeile/);
    expect(protokolle).toHaveLength(3);
    expect(JSON.stringify(protokolle)).not.toContain("Hof A");
  });

  it("Akteure aufloesen laesst eine Doppelzeile aehnlich (Status-CASE prueft doppel_von)", async () => {
    rolle = "pruefer";
    dbSelects.push([laufZeile("zugeordnet")]);
    txSelects.push([{ id: "z1", status: "offen", fehlergrund: null, zeilennummer: 2, felder: { akteur_name: "Hof A", akteur_sitz_plz: "67346" } }, { id: "z3", status: "aehnlich", fehlergrund: null, zeilennummer: 4, felder: { akteur_name: "Hof A", akteur_sitz_plz: "67346", doppel_von: "2" } }]);
    expect((await importAkteureAufloesen(LAUF)).ok).toBe(true);
    expect(sqlTexte(updates[0]!.status).join(" ")).toContain("doppel_von");
  });
});

describe("PR f — Nacharbeit prueft die Werte wie die Zuordnung (B5, B8)", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const ZEILE = "22222222-2222-4222-8222-222222222222";
  const lauf = () => ({ id: LAUF, art: "biomasse", dateiname: "x.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "probelauf", zaehler: {}, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const zeile = (felder: Record<string, string>) => ({ id: ZEILE, zeilennummer: 27, status: "fehler", felder });

  it("Kontaktdaten und unlesbare Zahlen werden abgewiesen, nichts geschrieben", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, { bezeichnung: "Rückruf musterfrau@example.com" })).fehler).toMatch(/Bezeichnung: enthält Kontaktdaten, bitte entfernen/);
    dbSelects.push([lauf()]);
    expect((await importZeileBearbeiten(LAUF, ZEILE, { menge_roh_fm: "ca. 3000" })).fehler).toMatch(/keine Zahl/);
    expect(updates).toHaveLength(0);
  });

  it("korrigierte Menge wird deutsch gelesen und gerundet (Hinweis), der Fehler des Felds faellt weg; andere Fehler halten die Zeile im Fehler", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ akteur_name: "V", akteur_id: "a1", menge_roh_fm: "2400", fehler_menge_roh_fm: "Einheit m³", akteur_sektor: "", fehler_akteur_sektor: "Wert „Gastronomie\" ist keinem Code zugeordnet." })]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { menge_roh_fm: "1.200,5" })).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ status: "fehler", fehlergrund: "Akteur · Sektor: Wert „Gastronomie\" ist keinem Code zugeordnet." });
    const t = sqlTexte(updates[0]!.felder).join(" ");
    expect(t).toContain("1201");
    expect(t).toContain("fehler_menge_roh_fm");
    expect(t).toMatch(/hinweis_menge_roh_fm/);
    dbSelects.push([lauf()]);
    txSelects.push([zeile({ akteur_name: "V", akteur_id: "a1", menge_roh_fm: "1201", akteur_sektor: "", fehler_akteur_sektor: "x" })]);
    expect(await importZeileBearbeiten(LAUF, ZEILE, { akteur_sektor: "landwirtschaft" })).toEqual({ ok: true });
    expect(updates[1]).toMatchObject({ status: "offen", fehlergrund: null });
  });
});

describe("PR g — importLaufVerwerfen: nie ausgefuehrte Laeufe beenden", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (status: string) => ({ id: LAUF, art: "biomasse", dateiname: "liegt.xlsx", dateiHash: "a".repeat(64), belegTyp: "gespraech", standardSektor: "ohne_sektor", status, zaehler: { zeilen: 36 }, belegErhebungsdatum: null, belegGueltigBis: null, zeitraumVon: null, zeitraumBis: null, preisBezugStandard: "fm", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });

  it("Rot: Bearbeiter abgewiesen; ein ausgefuehrter Lauf wird nicht verworfen", async () => {
    rolle = "bearbeiter";
    expect((await importLaufVerwerfen(LAUF)).fehler).toMatch(/recht/i);
    rolle = "pruefer";
    dbSelects.push([lauf("ausgefuehrt")]);
    expect((await importLaufVerwerfen(LAUF)).fehler).toMatch(/nie ausgeführt/);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("Pruefer verwirft einen zugeordneten Lauf: Zeilen geloescht, Status verworfen mit Zeitpunkt, Ereignis, Roh-Upload und Beleg-Kopie in R2 geloescht", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf("zugeordnet")]);
    txSelects.push([{ zaehler: { zeilen: 36 } }]);
    const erg = await importLaufVerwerfen(LAUF);
    expect(erg).toEqual({ ok: true, zeilen: 0 });
    expect(deletes).toEqual(["import_zeile"]);
    expect(updates[0]).toMatchObject({ status: "verworfen", verworfenAm: expect.any(Date), zaehler: expect.objectContaining({ zeilen: 36, verworfen_zeilen: 0 }) });
    expect(protokolle[0]).toMatchObject({ art: "status_gesetzt", entitaet: "import_lauf", id: LAUF, importLaufId: LAUF, text: expect.stringMatching(/verworfen \(nie ausgeführt, von Hand verworfen\)/) });
    expect(geloescht).toEqual([`import/test/${LAUF}/roh.xlsx`, `belege/test/import/${LAUF}/bereinigt.csv`]);
  });
});

describe("PR g — E69 im Probelauf: Preis-Bezug aus der Zeile oder als Lauf-Standard", () => {
  const LAUF = "11111111-1111-4111-8111-111111111111";
  const lauf = (preisBezugStandard: string) => ({ id: LAUF, art: "biomasse", dateiname: "t.xlsx", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "aufgeloest", zaehler: { zeilen: 3 }, belegErhebungsdatum: "2026-10-06", belegGueltigBis: "2027-10-06", zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31", preisBezugStandard, erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() });
  const strom = (teil: Record<string, string>) => ({ materialart_code: "guelle_rind", menge_roh_fm: "100", zeitraum_von: "2026-01", zeitraum_bis: "2026-12", akteur_name: "V", akteur_id: "a1", ...teil });
  it("Zeile mit Preis ohne Bezug bekommt den Lauf-Standard (atro), Zeile mit eigener Spalte behaelt ihren Bezug, Zeile ohne Preis bekommt keinen", async () => {
    rolle = "pruefer";
    dbSelects.push([lauf("atro")], [
      { id: "z1", zeilennummer: 2, status: "offen", fehlergrund: null, felder: strom({ preis_mittel: "85" }) },
      { id: "z2", zeilennummer: 3, status: "offen", fehlergrund: null, felder: strom({ preis_mittel: "85", preis_bezug: "fm" }) },
      { id: "z3", zeilennummer: 4, status: "offen", fehlergrund: null, felder: strom({}) },
    ]);
    const erg = await importProbelauf(LAUF, 2);
    expect(erg).toMatchObject({ ok: true, okZeilen: 3 });
    expect(preisBezuege).toEqual(["atro", "fm", ""]);
  });
  it("Zuordnung speichern uebernimmt den gewaehlten Lauf-Standard", async () => {
    rolle = "pruefer";
    const SPALTEN = ["Betrieb", "Sektor", "Straße", "Hausnummer", "PLZ", "Ort", "Ansprechpartner", "E-Mail", "Materialart", "Menge", "Einheit", "TS-Anteil %", "Zeitraum von", "Zeitraum bis"];
    dbSelects.push([{ id: LAUF, art: "biomasse", dateiname: "import-biomasse.csv", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor", status: "angelegt", zaehler: { zeilen: 3, spalten: 14 }, preisBezugStandard: "fm", erstellerEmail: null, createdAt: new Date(), updatedAt: new Date() }]);
    const b = readFileSync(join(BEISPIELE, "import-biomasse.csv"));
    r2Inhalt = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    const erg = await importZuordnungSpeichern(LAUF, { spalten: { ...vorschlagZuordnung("biomasse", SPALTEN), Hausnummer: "aschegehalt_pct" }, werte: { materialart_code: { Rindergülle: "guelle_rind", Maissilage: "maissilage", Festmist: "festmist" }, akteur_sektor: { Landwirtschaft: "landwirtschaft" } } }, { preisBezug: "atro" });
    expect(erg.ok).toBe(true);
    expect(updates[0]).toMatchObject({ status: "zugeordnet", preisBezugStandard: "atro" });
  });
});
