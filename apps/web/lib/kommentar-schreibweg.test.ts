/**
 * AP2.6 PR a (E71): Der Kommentar-Baustein — Rechte (Rollenstufe und Objekt-
 * regel Autor), Textregel, Erwaehnungen aus Markern (nur erwaehnbare Nutzer),
 * weiches Loeschen und das Protokoll ohne Kommentartext. Datenbank und
 * Protokoll sind Attrappen; die Matrix ist echt.
 */
import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const protokolle: Record<string, unknown>[] = [];
vi.mock("@/lib/protokoll", () => ({
  protokolliere: async (_tx: unknown, e: Record<string, unknown>) => {
    protokolle.push(e);
    return { id: "ereignis-1" };
  },
}));

const { KEIN_RECHT, NICHT_ERWAEHNBAR, kommentarBearbeitenInTx, kommentarErstellenInTx, kommentarLoeschenInTx } = await import("./kommentar-schreibweg");
const { erwaehnungsMarker } = await import("./kommentar-marker");

const ICH = "00000000-0000-4000-8000-000000000001";
const ANDERE = "00000000-0000-4000-8000-000000000002";
const BETRACHTERIN = "00000000-0000-4000-8000-000000000003";
const INAKTIV = "00000000-0000-4000-8000-000000000004";
const FREMD = "00000000-0000-4000-8000-0000000000ff";
const STROM = "00000000-0000-4000-8000-0000000000aa";
const AKTEUR = "00000000-0000-4000-8000-0000000000bb";
const KOMMENTAR = "00000000-0000-4000-8000-0000000000cc";

const BENUTZER = [
  { id: ICH, rolle: "bearbeiter", aktiv: true },
  { id: ANDERE, rolle: "pruefer", aktiv: true },
  { id: BETRACHTERIN, rolle: "betrachter", aktiv: true },
  { id: INAKTIV, rolle: "bearbeiter", aktiv: false },
];
const handelnd = (id: string, rolle: "betrachter" | "bearbeiter" | "pruefer" | "admin") => ({ id, email: `${rolle}@bhyo.de`, rolle });

interface Szenario {
  kommentar?: { id: string; autorId: string; text: string | null; geloeschtAm: Date | null; biomassestromId: string | null; outputBedarfId: string | null; akteurId: string | null };
  erwaehnungen?: string[];
}

/** Fake-Transaktion: liefert je Tabelle die Szenario-Zeilen, merkt Inserts und Updates. */
function fakeTx(sz: Szenario) {
  const inserts: { tabelle: string; werte: Record<string, unknown> | Record<string, unknown>[] }[] = [];
  const updates: { tabelle: string; werte: Record<string, unknown> }[] = [];
  const zeilen = (tabelle: string): unknown[] => {
    if (tabelle === "benutzer") return BENUTZER;
    if (tabelle === "kommentar") return sz.kommentar ? [sz.kommentar] : [];
    if (tabelle === "kommentar_erwaehnung") return (sz.erwaehnungen ?? []).map((nutzerId) => ({ nutzerId }));
    throw new Error(`unerwartete Tabelle ${tabelle}`);
  };
  const kette = (rows: unknown[]) => {
    const k: Record<string, unknown> = {};
    for (const m of ["where", "for", "limit"]) k[m] = () => k;
    k.then = (res: (v: unknown) => void) => res(rows);
    return k;
  };
  const tx = {
    select: () => ({ from: (t: unknown) => kette(zeilen(getTableName(t as never))) }),
    insert: (t: unknown) => ({
      values: (werte: Record<string, unknown> | Record<string, unknown>[]) => {
        inserts.push({ tabelle: getTableName(t as never), werte });
        return { returning: async () => [{ id: "k-neu" }], then: (res: (v: unknown) => void) => res([]) };
      },
    }),
    update: (t: unknown) => ({
      set: (werte: Record<string, unknown>) => {
        updates.push({ tabelle: getTableName(t as never), werte });
        return kette([]);
      },
    }),
  };
  return { tx: tx as never, inserts, updates };
}

const eigener = (text: string, erwaehnungen: string[] = []): Szenario => ({
  kommentar: { id: KOMMENTAR, autorId: ICH, text, geloeschtAm: null, biomassestromId: STROM, outputBedarfId: null, akteurId: null },
  erwaehnungen,
});
const fremder = (text = "Fremder Text"): Szenario => ({
  kommentar: { id: KOMMENTAR, autorId: ANDERE, text, geloeschtAm: null, biomassestromId: null, outputBedarfId: null, akteurId: AKTEUR },
});

beforeEach(() => {
  protokolle.length = 0;
});

describe("E71 erstellen", () => {
  it("Betrachter: abgewiesen, nichts geschrieben, kein Ereignis", async () => {
    const { tx, inserts } = fakeTx({});
    await expect(kommentarErstellenInTx(tx, handelnd(BETRACHTERIN, "betrachter"), { art: "biomasse", id: STROM }, "Hallo")).rejects.toThrow(KEIN_RECHT);
    expect(inserts).toEqual([]);
    expect(protokolle).toEqual([]);
  });
  it("Bearbeiter am Strom: Kommentar mit genau einem Bezug, Erwaehnung aus dem Marker, Protokoll ohne Text", async () => {
    const { tx, inserts } = fakeTx({});
    const text = `Bitte ${erwaehnungsMarker(ANDERE)} prüfen — GEHEIMER TEXT`;
    const r = await kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "biomasse", id: STROM }, text);
    expect(r).toEqual({ id: "k-neu", bezug: { art: "biomasse", id: STROM }, erwaehnte: [ANDERE] });
    expect(inserts.map((i) => i.tabelle)).toEqual(["kommentar", "kommentar_erwaehnung"]);
    expect(inserts[0]!.werte).toEqual({ biomassestromId: STROM, outputBedarfId: null, akteurId: null, autorId: ICH, text });
    expect(inserts[1]!.werte).toEqual([{ kommentarId: "k-neu", nutzerId: ANDERE }]);
    expect(protokolle).toHaveLength(1);
    expect(protokolle[0]).toMatchObject({ art: "kommentar_erstellt", entitaet: "kommentar", id: "k-neu", benutzerId: ICH, text: `Strom ${STROM}; 1 Erwähnung(en)` });
    expect(JSON.stringify(protokolle)).not.toContain("GEHEIMER TEXT");
  });
  it("Akteur-Bezug setzt akteur_id; Bedarf setzt output_bedarf_id", async () => {
    const a = fakeTx({});
    await kommentarErstellenInTx(a.tx, handelnd(ICH, "bearbeiter"), { art: "akteur", id: AKTEUR }, "Notiz");
    expect(a.inserts[0]!.werte).toMatchObject({ biomassestromId: null, outputBedarfId: null, akteurId: AKTEUR });
    const o = fakeTx({});
    await kommentarErstellenInTx(o.tx, handelnd(ICH, "bearbeiter"), { art: "output", id: STROM }, "Notiz");
    expect(o.inserts[0]!.werte).toMatchObject({ biomassestromId: null, outputBedarfId: STROM, akteurId: null });
    expect(protokolle.map((p) => p.text)).toEqual([`Akteur ${AKTEUR}; 0 Erwähnung(en)`, `Bedarf ${STROM}; 0 Erwähnung(en)`]);
  });
  it("ungueltiger Bezug und leerer Text werden abgewiesen", async () => {
    const { tx, inserts } = fakeTx({});
    await expect(kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "beleg", id: STROM } as never, "x")).rejects.toThrow("Ungültiger Bezug.");
    await expect(kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "akteur", id: "kein-uuid" }, "x")).rejects.toThrow("Ungültiger Bezug.");
    await expect(kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "akteur", id: AKTEUR }, "   ")).rejects.toThrow("Der Kommentar ist leer.");
    expect(inserts).toEqual([]);
  });
  it("Marker auf fremde UUID, Betrachterin oder deaktivierten Nutzer: Kommentar abgewiesen (fail closed)", async () => {
    for (const ziel of [FREMD, BETRACHTERIN, INAKTIV]) {
      const { tx, inserts } = fakeTx({});
      await expect(kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "akteur", id: AKTEUR }, `Hallo ${erwaehnungsMarker(ziel)}`)).rejects.toThrow(NICHT_ERWAEHNBAR);
      expect(inserts).toEqual([]);
    }
    expect(protokolle).toEqual([]);
  });
  it("doppelte Erwaehnung ergibt eine Zeile; Marker im Fliesstext zaehlen", async () => {
    const { tx, inserts } = fakeTx({});
    await kommentarErstellenInTx(tx, handelnd(ICH, "bearbeiter"), { art: "akteur", id: AKTEUR }, `${erwaehnungsMarker(ANDERE)},${erwaehnungsMarker(ANDERE)} und ${erwaehnungsMarker(ICH)}.`);
    expect(inserts[1]!.werte).toEqual([
      { kommentarId: "k-neu", nutzerId: ANDERE },
      { kommentarId: "k-neu", nutzerId: ICH },
    ]);
  });
});

describe("E71 bearbeiten", () => {
  it("nur der Autor — Pruefer und admin werden am fremden Kommentar abgewiesen", async () => {
    for (const h of [handelnd(ICH, "pruefer"), handelnd(ICH, "admin")]) {
      const { tx, updates } = fakeTx(fremder());
      await expect(kommentarBearbeitenInTx(tx, h, KOMMENTAR, "Neu")).rejects.toThrow(KEIN_RECHT);
      expect(updates).toEqual([]);
    }
    expect(protokolle).toEqual([]);
  });
  it("eigener Kommentar: Text und bearbeitet_am, nur NEUE Erwaehnungen werden geschrieben, entfernte bleiben", async () => {
    const { tx, inserts, updates } = fakeTx(eigener(`alt ${erwaehnungsMarker(ANDERE)}`, [ANDERE]));
    const neu = `neu ${erwaehnungsMarker(ICH)}`; // ANDERE entfernt, ICH neu
    const r = await kommentarBearbeitenInTx(tx, handelnd(ICH, "bearbeiter"), KOMMENTAR, neu);
    expect(r).toEqual({ bezug: { art: "biomasse", id: STROM }, neueErwaehnte: [ICH] });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.werte).toMatchObject({ text: neu });
    expect(updates[0]!.werte.bearbeitetAm).toBeInstanceOf(Date);
    expect(inserts).toEqual([{ tabelle: "kommentar_erwaehnung", werte: [{ kommentarId: KOMMENTAR, nutzerId: ICH }] }]);
    expect(protokolle[0]).toMatchObject({ art: "kommentar_bearbeitet", entitaet: "kommentar", id: KOMMENTAR, text: `Strom ${STROM}; 1 neue Erwähnung(en)` });
    expect(JSON.stringify(protokolle)).not.toContain("neu ");
  });
  it("bereits erwaehnte Nutzer werden nicht noch einmal eingetragen; unveraenderter Text ist keine Aenderung", async () => {
    const text = `gleich ${erwaehnungsMarker(ANDERE)}`;
    const { tx, inserts, updates } = fakeTx(eigener(text, [ANDERE]));
    await expect(kommentarBearbeitenInTx(tx, handelnd(ICH, "bearbeiter"), KOMMENTAR, text)).rejects.toThrow("Keine Änderung.");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
    const b = fakeTx(eigener(text, [ANDERE]));
    await kommentarBearbeitenInTx(b.tx, handelnd(ICH, "bearbeiter"), KOMMENTAR, `${text} ergänzt`);
    expect(b.inserts).toEqual([]);
    expect(protokolle.at(-1)).toMatchObject({ text: `Strom ${STROM}; 0 neue Erwähnung(en)` });
  });
  it("geloeschter oder fehlender Kommentar wird nicht bearbeitet", async () => {
    const g = eigener("x");
    g.kommentar!.geloeschtAm = new Date();
    g.kommentar!.text = null;
    await expect(kommentarBearbeitenInTx(fakeTx(g).tx, handelnd(ICH, "bearbeiter"), KOMMENTAR, "y")).rejects.toThrow("bereits gelöscht");
    await expect(kommentarBearbeitenInTx(fakeTx({}).tx, handelnd(ICH, "bearbeiter"), KOMMENTAR, "y")).rejects.toThrow("Kommentar nicht gefunden.");
  });
});

describe("E71 loeschen (weich)", () => {
  it("Autor loescht: text NULL und geloescht_am gesetzt, Ereignis ohne Text, kein echtes DELETE", async () => {
    const { tx, updates } = fakeTx(eigener("GEHEIM"));
    const r = await kommentarLoeschenInTx(tx, handelnd(ICH, "bearbeiter"), KOMMENTAR);
    expect(r).toEqual({ bezug: { art: "biomasse", id: STROM } });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.werte).toMatchObject({ text: null });
    expect(updates[0]!.werte.geloeschtAm).toBeInstanceOf(Date);
    expect(protokolle).toEqual([expect.objectContaining({ art: "kommentar_geloescht", entitaet: "kommentar", id: KOMMENTAR, text: `Strom ${STROM}` })]);
    expect(JSON.stringify(protokolle)).not.toContain("GEHEIM");
  });
  it("fremden Kommentar loescht nur admin — bearbeiter und pruefer nicht", async () => {
    for (const h of [handelnd(ICH, "bearbeiter"), handelnd(ICH, "pruefer")]) {
      const { tx, updates } = fakeTx(fremder());
      await expect(kommentarLoeschenInTx(tx, h, KOMMENTAR)).rejects.toThrow(KEIN_RECHT);
      expect(updates).toEqual([]);
    }
    const a = fakeTx(fremder());
    await kommentarLoeschenInTx(a.tx, handelnd(ICH, "admin"), KOMMENTAR);
    expect(a.updates[0]!.werte).toMatchObject({ text: null });
    expect(protokolle).toEqual([expect.objectContaining({ art: "kommentar_geloescht", text: `Akteur ${AKTEUR}` })]);
  });
  it("ein geloeschter Kommentar wird nicht erneut geloescht", async () => {
    const g = eigener("x");
    g.kommentar!.geloeschtAm = new Date();
    g.kommentar!.text = null;
    await expect(kommentarLoeschenInTx(fakeTx(g).tx, handelnd(ICH, "admin"), KOMMENTAR)).rejects.toThrow("bereits gelöscht");
  });
});
