/**
 * E77 R7: Die Profil-Aktionen werden AUFGERUFEN, nicht die Oberflaeche.
 *   1. Ohne Zugang (nicht angemeldet, unbekannt): Ablehnung, kein Schreiben, kein R2-Zugriff.
 *   2. Anzeigename: zu lang abgewiesen (kein Schreiben); gueltig → genau die EIGENE Zeile
 *      (where id = Zugang-ID) mit zusammengezogenem Namen, Protokoll „geaendert“ ohne fremde ID.
 *   3. Profilbild: falscher Typ (SVG mit behauptetem image/png) und > 1 MB abgewiesen — nichts in R2,
 *      nichts in der DB; gueltiges PNG → put unter profil/<umgebung>/<id>/…png mit Content-Type aus
 *      den Bytes, Zeile mit bild_key und bild_geaendert_am, Protokoll, altes Objekt geloescht,
 *      neue Bild-URL mit Version.
 *   4. Schlaegt das Umschreiben der Zeile fehl, wird das frische Objekt wieder geloescht.
 *   5. Entfernen: Zeile auf NULL, Protokoll, Objekt geloescht; ohne Bild kein Schreiben.
 *   6. Eric 14.10.2026, Profilbild = Personendatum: der Bucket ist eine echte Ablage (Map) —
 *      Entfernen → Objekt WEG; Ersetzen → altes Objekt weg, neues da; Auslieferung des alten
 *      Schluessels ueber die Route → 404. Schlaegt das Loeschen fehl: Zeile zurueckgerollt,
 *      Fehler statt Erfolg, beim Ersetzen das frische Objekt wieder weg.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Rolle } from "./rechte/rollen";

let angemeldet: string | null = null;
let eintrag: { id: string; rolle: Rolle; aktiv: boolean; name: string | null } | null = null;
let bildKeyVorher: string | null = null;
let updateWirft: unknown = null;
let schreibvorgaenge: { art: string; werte: unknown; where?: unknown }[] = [];
let r2: { op: string; key: string; typ?: string; bytes?: number }[] = [];
/** Echte Ablage: was put schreibt, liest get; delete entfernt. */
let ablage = new Map<string, { bytes: ArrayBuffer; typ?: string }>();
/** Schluessel, dessen Loeschen fehlschlaegt (R2-Stoerung fuer genau dieses Objekt). */
let loeschenWirftFuer: string | null = null;
const ICH = "00000000-0000-4000-8000-0000000000e1";

function fakeDb() {
  const db: Record<string, unknown> = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (eintrag ? [{ ...eintrag, bildKey: bildKeyVorher }] : []),
        }),
      }),
    }),
    update: () => ({
      set: (werte: unknown) => ({
        where: async (where: unknown) => {
          if (updateWirft) throw updateWirft;
          schreibvorgaenge.push({ art: "update", werte, where });
        },
      }),
    }),
    insert: () => ({
      // Das Protokoll (lib/protokoll) wartet auf .returning(); die Zustellung kennt die Entitaet benutzer nicht (0 Empfaenger).
      values: (werte: unknown) => {
        schreibvorgaenge.push({ art: "insert", werte });
        return Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: "a-1" }] });
      },
    }),
    // Rollback-Attrappe: wirft fn, verschwinden die Schreibvorgaenge der Transaktion wieder.
    transaction: async (fn: (tx: unknown) => unknown) => {
      const stand = schreibvorgaenge.length;
      try {
        return await fn(db);
      } catch (e) {
        schreibvorgaenge.length = stand;
        throw e;
      }
    },
  };
  return db;
}

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => angemeldet,
  withDb: async (fn: (db: unknown) => unknown) => fn(fakeDb()),
  getEnvironment: async () => "testumgebung",
  getBelegeBucket: async () => ({
    put: async (key: string, value: ArrayBuffer, o: { httpMetadata?: { contentType?: string } }) => {
      r2.push({ op: "put", key, typ: o.httpMetadata?.contentType, bytes: value.byteLength });
      ablage.set(key, { bytes: value, typ: o.httpMetadata?.contentType });
    },
    delete: async (key: string) => {
      if (key === loeschenWirftFuer) throw new Error("r2 weg");
      r2.push({ op: "delete", key });
      ablage.delete(key);
    },
    get: async (key: string) => {
      const o = ablage.get(key);
      return o ? { body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength, httpMetadata: { contentType: o.typ } } : null;
    },
    list: async () => ({ objects: [], truncated: false }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { anzeigenameSetzen, profilBildSetzen, profilBildEntfernen } = await import("./profil-actions");
const { GET: bildRoute } = await import("@/app/api/profil/bild/[id]/route");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
function formMit(bytes: Uint8Array, typ: string, name = "bild.png"): FormData {
  const fd = new FormData();
  fd.set("bild", new File([bytes.slice().buffer as ArrayBuffer], name, { type: typ }));
  return fd;
}
function updates() {
  return schreibvorgaenge.filter((s) => s.art === "update");
}
function protokolle() {
  return schreibvorgaenge.filter((s) => s.art === "insert").map((s) => s.werte as { art: string; benutzerId: string; entitaetId?: string; text: string });
}

beforeEach(() => {
  angemeldet = "eric.schmitt@bhyo.de";
  eintrag = { id: ICH, rolle: "betrachter", aktiv: true, name: "Eric Schmitt" };
  bildKeyVorher = null;
  updateWirft = null;
  schreibvorgaenge = [];
  r2 = [];
  ablage = new Map();
  loeschenWirftFuer = null;
});

/** Legt ein altes Bild in die Ablage und in die Zeile. */
function altesBild(key = "profil/testumgebung/" + ICH + "/alt.webp"): string {
  ablage.set(key, { bytes: new Uint8Array([1, 2, 3]).buffer, typ: "image/webp" });
  bildKeyVorher = key;
  return key;
}
async function routeStatus(): Promise<number> {
  const res = await bildRoute(new Request("http://test/api/profil/bild/" + ICH), { params: Promise.resolve({ id: ICH }) });
  return res.status;
}

describe("ohne Zugang", () => {
  it("nicht angemeldet: Ablehnung, kein Schreiben, kein R2", async () => {
    angemeldet = null;
    expect((await anzeigenameSetzen("X")).ok).toBe(false);
    expect((await profilBildSetzen(formMit(PNG, "image/png"))).ok).toBe(false);
    expect((await profilBildEntfernen()).ok).toBe(false);
    expect(schreibvorgaenge).toEqual([]);
    expect(r2).toEqual([]);
  });
  it("unbekannte Adresse: Ablehnung, kein Schreiben", async () => {
    eintrag = null;
    expect((await anzeigenameSetzen("X")).ok).toBe(false);
    expect(schreibvorgaenge).toEqual([]);
  });
});

describe("anzeigenameSetzen", () => {
  it("zu lang: abgewiesen, nichts geschrieben", async () => {
    const erg = await anzeigenameSetzen("x".repeat(81));
    expect(erg).toEqual({ ok: false, fehler: expect.stringContaining("80") });
    expect(schreibvorgaenge).toEqual([]);
  });
  it("gueltig: eigene Zeile mit bereinigtem Namen, Protokoll geaendert fuer die eigene ID", async () => {
    const erg = await anzeigenameSetzen("  Eric   S. ");
    expect(erg).toEqual({ ok: true });
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.werte).toMatchObject({ name: "Eric S." });
    const p = protokolle();
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ art: "geaendert", benutzerId: ICH, entitaetId: ICH });
    expect(p[0]!.text).toContain("Eric S.");
  });
  it("leer: Name wird null (E-Mail gilt)", async () => {
    await anzeigenameSetzen("   ");
    expect(updates()[0]!.werte).toMatchObject({ name: null });
  });
});

describe("profilBildSetzen", () => {
  it("SVG mit behauptetem image/png: abgewiesen an den Bytes, nichts in R2, nichts in der DB", async () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const erg = await profilBildSetzen(formMit(svg, "image/png", "bild.png"));
    expect(erg).toEqual({ ok: false, fehler: "Nur JPG, PNG oder WebP sind erlaubt." });
    expect(r2).toEqual([]);
    expect(schreibvorgaenge).toEqual([]);
  });
  it("groesser als 1 MB: abgewiesen", async () => {
    const gross = new Uint8Array(1024 * 1024 + 1);
    gross.set(PNG);
    const erg = await profilBildSetzen(formMit(gross, "image/png"));
    expect(erg.ok).toBe(false);
    expect(r2).toEqual([]);
    expect(schreibvorgaenge).toEqual([]);
  });
  it("ohne Datei: abgewiesen", async () => {
    expect((await profilBildSetzen(new FormData())).ok).toBe(false);
    expect(r2).toEqual([]);
  });
  it("gueltiges PNG: put unter profil/<umgebung>/<id>/, Zeile und Protokoll, altes Objekt geloescht, URL mit Version", async () => {
    bildKeyVorher = "profil/testumgebung/" + ICH + "/alt.jpg";
    const erg = await profilBildSetzen(formMit(PNG, "image/png"));
    expect(erg.ok).toBe(true);
    expect(erg.bildUrl).toMatch(new RegExp(`^/api/profil/bild/${ICH}\\?v=\\d+$`));
    const put = r2.find((o) => o.op === "put")!;
    expect(put.key).toMatch(new RegExp(`^profil/testumgebung/${ICH}/[0-9a-f-]{36}\\.png$`));
    expect(put.typ).toBe("image/png");
    expect(put.bytes).toBe(PNG.byteLength);
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.werte).toMatchObject({ bildKey: put.key });
    expect((updates()[0]!.werte as { bildGeaendertAm: Date }).bildGeaendertAm).toBeInstanceOf(Date);
    expect(protokolle()[0]).toMatchObject({ art: "geaendert", benutzerId: ICH, entitaetId: ICH, text: expect.stringContaining("Profilbild ersetzt") });
    expect(r2.filter((o) => o.op === "delete").map((o) => o.key)).toEqual([bildKeyVorher]);
  });
  it("erstes Bild: Protokoll „gesetzt“, nichts geloescht", async () => {
    await profilBildSetzen(formMit(PNG, "image/png"));
    expect(protokolle()[0]!.text).toContain("Profilbild gesetzt");
    expect(r2.filter((o) => o.op === "delete")).toEqual([]);
  });
  it("Zeile nicht umschreibbar: frisches Objekt wird wieder geloescht, Fehler kommt durch", async () => {
    updateWirft = new Error("db weg");
    await expect(profilBildSetzen(formMit(PNG, "image/png"))).rejects.toThrow("db weg");
    const put = r2.find((o) => o.op === "put")!;
    expect(r2.filter((o) => o.op === "delete").map((o) => o.key)).toEqual([put.key]);
  });
});

describe("profilBildEntfernen", () => {
  it("mit Bild: Zeile auf NULL, Protokoll, Objekt geloescht", async () => {
    bildKeyVorher = "profil/testumgebung/" + ICH + "/alt.webp";
    const erg = await profilBildEntfernen();
    expect(erg).toEqual({ ok: true, bildUrl: null });
    expect(updates()[0]!.werte).toMatchObject({ bildKey: null, bildGeaendertAm: null });
    expect(protokolle()[0]).toMatchObject({ art: "geaendert", benutzerId: ICH, entitaetId: ICH, text: expect.stringContaining("Profilbild entfernt") });
    expect(r2).toEqual([{ op: "delete", key: bildKeyVorher }]);
  });
  it("ohne Bild: nichts zu tun, kein Schreiben", async () => {
    const erg = await profilBildEntfernen();
    expect(erg.ok).toBe(true);
    expect(schreibvorgaenge).toEqual([]);
    expect(r2).toEqual([]);
  });
});

describe("Profilbild als Personendatum (Eric 14.10.2026)", () => {
  it("Entfernen: das R2-Objekt ist weg; der alte Schluessel liefert ueber die Route 404", async () => {
    const alt = altesBild();
    expect(await routeStatus()).toBe(200);
    expect((await profilBildEntfernen()).ok).toBe(true);
    expect(ablage.has(alt)).toBe(false);
    // Zeile auf NULL → 404 ohne R2; und selbst eine veraltete Zeile mit dem alten Schluessel → 404 (Objekt fehlt).
    bildKeyVorher = null;
    expect(await routeStatus()).toBe(404);
    bildKeyVorher = alt;
    expect(await routeStatus()).toBe(404);
  });
  it("Ersetzen: altes Objekt weg, neues da, alter Schluessel 404", async () => {
    const alt = altesBild("profil/testumgebung/" + ICH + "/alt.jpg");
    const erg = await profilBildSetzen(formMit(PNG, "image/png"));
    expect(erg.ok).toBe(true);
    const neu = (updates()[0]!.werte as { bildKey: string }).bildKey;
    expect(ablage.has(alt)).toBe(false);
    expect(ablage.has(neu)).toBe(true);
    expect(new Uint8Array(ablage.get(neu)!.bytes)).toEqual(PNG);
    bildKeyVorher = alt;
    expect(await routeStatus()).toBe(404);
    bildKeyVorher = neu;
    expect(await routeStatus()).toBe(200);
  });
  it("Loeschen schlaegt fehl beim Entfernen: Fehler, Zeile zurueckgerollt, Objekt bleibt", async () => {
    const alt = altesBild();
    loeschenWirftFuer = alt;
    const erg = await profilBildEntfernen();
    expect(erg).toEqual({ ok: false, fehler: expect.stringContaining("nicht gelöscht") });
    expect(schreibvorgaenge).toEqual([]);
    expect(ablage.has(alt)).toBe(true);
  });
  it("Loeschen schlaegt fehl beim Ersetzen: Fehler, Zeile zurueckgerollt, altes bleibt, frisches weg", async () => {
    const alt = altesBild("profil/testumgebung/" + ICH + "/alt.jpg");
    loeschenWirftFuer = alt;
    const erg = await profilBildSetzen(formMit(PNG, "image/png"));
    expect(erg).toEqual({ ok: false, fehler: expect.stringContaining("nicht gelöscht") });
    expect(schreibvorgaenge).toEqual([]);
    expect(ablage.has(alt)).toBe(true);
    const put = r2.find((o) => o.op === "put")!;
    expect(ablage.has(put.key)).toBe(false);
  });
});
