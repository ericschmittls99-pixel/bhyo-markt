"use server";

import { importLauf, importVorlage, importZeile } from "@bhyo/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

import { getBelegeBucket, getEnvironment, withDb, type AppDb } from "@/lib/db";
import { sucheAehnliche } from "@/lib/dubletten";
import { dateiErlaubt, IMPORT_MAX_BYTES, ImportDateiFehler, parseImportDatei, sha256Hex, type ImportTabelle } from "@/lib/import-datei";
import { pruefeImportLaufEingabe, type ImportLaufEingabe, type ImportLaufFehler } from "@/lib/import-modell";
import { ADRESSEN_JE_STAPEL, adressGruppen, adressText, sitzPatch, waehleSitz } from "@/lib/import-adressen";
import { akteurGruppen, entscheidungAusTreffer } from "@/lib/import-akteure";
import { importRohKey, ladeImportLauf, ladeImportZeilen } from "@/lib/import-server";
import { PERSON, pruefeVorlage, pruefeZuordnung, zeileZuFelder, type Zuordnung } from "@/lib/import-zuordnung";
import { PhotonNichtErreichbar, photonSuche } from "@/lib/photon-server";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { StromArt } from "@/lib/stroeme-modell";

/**
 * AP2.7 PR a/b (E67): die Schreibpfade des Imports bis zum Lauf. Nur Pruefer
 * und Admin (import.ausfuehren); die Wache sitzt vor jeder Wirkung. Jedes
 * Ereignis traegt die Lauf-ID (aenderung.import_lauf_id). Zuordnen und
 * Probelauf folgen in diesem PR, Ausfuehren in PR c.
 */
export interface ImportLaufErgebnis {
  ok?: boolean;
  id?: string;
  feldFehler?: ImportLaufFehler;
  fehler?: string;
  /** Gleicher Datei-Hash wie ein frueherer Lauf (E67: Warnung vor dem Start). */
  gleicheDatei?: { laufId: string; dateiname: string; createdAt: string }[];
}

type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Lauf-Zeile plus Ereignis — eine Stelle fuer beide Actions. */
async function laufAnlegenInTx(
  tx: Tx,
  handelnder: { id: string; email: string },
  eingabe: ImportLaufEingabe,
  extra: { id?: string; zaehler?: Record<string, number> },
): Promise<{ id: string; gleiche: { laufId: string; dateiname: string; createdAt: string }[] }> {
  const gleiche = await tx
    .select({ laufId: importLauf.id, dateiname: importLauf.dateiname, createdAt: importLauf.createdAt })
    .from(importLauf)
    .where(eq(importLauf.dateiHash, eingabe.dateiHash));
  const [row] = await tx
    .insert(importLauf)
    .values({
      ...(extra.id ? { id: extra.id } : {}),
      art: eingabe.art,
      dateiname: eingabe.dateiname.trim(),
      dateiHash: eingabe.dateiHash,
      belegTyp: eingabe.belegTyp as typeof importLauf.$inferInsert.belegTyp,
      standardSektor: eingabe.standardSektor,
      vorlageId: eingabe.vorlageId ?? null,
      erstellerId: handelnder.id,
      status: "angelegt",
      zaehler: extra.zaehler ?? null,
    })
    .returning({ id: importLauf.id });
  const zeilen = extra.zaehler?.zeilen;
  await protokolliere(tx, {
    art: "angelegt",
    entitaet: "import_lauf",
    id: row!.id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: `Import-Lauf angelegt: ${eingabe.dateiname.trim()} (${eingabe.art}${zeilen != null ? `, ${zeilen} Zeilen` : ""})`,
    importLaufId: row!.id,
  });
  return { id: row!.id, gleiche: gleiche.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() })) };
}

export async function importLaufAnlegen(eingabe: ImportLaufEingabe): Promise<ImportLaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  const feldFehler = pruefeImportLaufEingabe(eingabe);
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const { id, gleiche } = await laufAnlegenInTx(tx, { id: wache.zugang.id, email: wache.email }, eingabe, {});
        return { ok: true, id, gleicheDatei: gleiche };
      }),
    );
  } catch (e) {
    console.error("Import-Lauf anlegen fehlgeschlagen:", e);
    return { fehler: "Import-Lauf konnte nicht angelegt werden." };
  }
}

/**
 * Upload (PR b): Datei pruefen und lesen, Hash bilden, Roh-Upload nach R2
 * (eigener Praefix import/, Loeschung nach der Zuordnung bzw. durch den
 * Job), dann Lauf und Ereignis in einer Transaktion. Reihenfolge bewusst:
 * erst R2, dann DB — ein verwaistes R2-Objekt raeumt der Job auf, ein Lauf
 * ohne Datei waere eine Leiche in der Oberflaeche. Zeilen werden hier noch
 * nicht gespeichert: Welche Spalten uebernommen werden, entscheidet die
 * Zuordnung (E67, Personen-Spalten nie).
 */
export async function importDateiHochladen(_prev: ImportLaufErgebnis, formData: FormData): Promise<ImportLaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };

  const datei = formData.get("datei");
  if (!(datei instanceof File) || datei.size === 0) return { feldFehler: { dateiname: "Bitte eine CSV- oder Excel-Datei auswählen." } };
  if (!dateiErlaubt(datei.name)) return { feldFehler: { dateiname: "Dateityp nicht unterstützt: erlaubt sind .xlsx, .xlsm, .xls, .csv." } };
  if (datei.size > IMPORT_MAX_BYTES) return { feldFehler: { dateiname: `Datei ist größer als ${IMPORT_MAX_BYTES / 1024 / 1024} MB.` } };

  const text = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const daten = await datei.arrayBuffer();
  const eingabe: ImportLaufEingabe = {
    art: text("art"),
    dateiname: datei.name,
    dateiHash: await sha256Hex(daten),
    belegTyp: text("beleg_typ"),
    standardSektor: text("standard_sektor"),
  };
  const feldFehler = pruefeImportLaufEingabe(eingabe);
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  let zaehler: Record<string, number>;
  try {
    const tabelle = parseImportDatei(daten, datei.name);
    zaehler = { zeilen: tabelle.zeilen.length, spalten: tabelle.spalten.length };
  } catch (e) {
    if (e instanceof ImportDateiFehler) return { feldFehler: { dateiname: e.message } };
    throw e;
  }

  const laufId = crypto.randomUUID();
  try {
    const env = await getEnvironment();
    const bucket = await getBelegeBucket();
    await bucket.put(importRohKey(env, laufId, datei.name), daten, {
      httpMetadata: { contentType: datei.type || "application/octet-stream" },
    });
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const { id, gleiche } = await laufAnlegenInTx(tx, { id: wache.zugang.id, email: wache.email }, eingabe, { id: laufId, zaehler });
        return { ok: true, id, gleicheDatei: gleiche };
      }),
    );
  } catch (e) {
    console.error("Import-Upload fehlgeschlagen:", e);
    return { fehler: "Die Datei konnte nicht übernommen werden." };
  }
}

/**
 * Zuordnung speichern (PR b): Roh-Upload aus R2 lesen, mit der Zuordnung
 * jede Zeile in Zielfelder uebersetzen (Personen-Spalten nie), Zeilen als
 * import_zeile speichern (offen | fehler), Lauf auf „zugeordnet", Ereignis
 * mit Zaehlern — und den Roh-Upload loeschen (E67: nach der Zuordnung).
 * Nur im Zustand „angelegt": Die Zuordnung ist ein Schritt, kein Editor.
 */
export interface ZuordnungErgebnis {
  ok?: boolean;
  fehler?: string;
  /** Meldungen von pruefeZuordnung — nichts gespeichert. */
  fehlerListe?: string[];
  zaehler?: Record<string, number>;
}

export async function importZuordnungSpeichern(laufId: string, zuordnung: Zuordnung): Promise<ZuordnungErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };

  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "angelegt") return { fehler: `Der Lauf ist schon „${lauf.status}" — die Zuordnung ist abgeschlossen.` };
  const art = lauf.art as StromArt;

  const env = await getEnvironment();
  const bucket = await getBelegeBucket();
  const key = importRohKey(env, lauf.id, lauf.dateiname);
  const roh = await bucket.get(key);
  if (!roh) return { fehler: "Der Roh-Upload liegt nicht mehr vor (gelöscht nach 24 h) — bitte die Datei neu hochladen." };
  let tabelle: ImportTabelle;
  try {
    tabelle = parseImportDatei(await new Response(roh.body).arrayBuffer(), lauf.dateiname);
  } catch (e) {
    if (e instanceof ImportDateiFehler) return { fehler: e.message };
    throw e;
  }

  const fehlerListe = pruefeZuordnung(art, tabelle.spalten, zuordnung);
  if (fehlerListe.length > 0) return { fehlerListe };

  const zeilen = tabelle.zeilen.map((z, i) => {
    const r = zeileZuFelder(tabelle.spalten, z, zuordnung);
    return {
      laufId: lauf.id,
      // Zeilennummer wie in der Datei (Kopfzeile ist 1), damit Nacharbeit und Datei zusammenpassen.
      zeilennummer: i + 2,
      felder: r.felder,
      status: r.fehlergrund ? "fehler" : "offen",
      fehlergrund: r.fehlergrund,
    };
  });
  const personenSpalten = tabelle.spalten.filter((sp) => zuordnung.spalten[sp] === PERSON).length;
  const zaehler: Record<string, number> = {
    ...(lauf.zaehler ?? {}),
    zeilen: zeilen.length,
    offen: zeilen.filter((z) => z.status === "offen").length,
    fehler: zeilen.filter((z) => z.status === "fehler").length,
    personen_spalten: personenSpalten,
  };

  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        for (let i = 0; i < zeilen.length; i += 500) {
          await tx.insert(importZeile).values(zeilen.slice(i, i + 500));
        }
        await tx.update(importLauf).set({ status: "zugeordnet", zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "status_gesetzt",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Zuordnung gespeichert: ${zaehler.zeilen} Zeilen (${zaehler.offen} offen, ${zaehler.fehler} mit Fehler), ${personenSpalten} Personen-Spalte(n) nicht übernommen`,
          importLaufId: lauf.id,
        });
      }),
    );
  } catch (e) {
    console.error("Zuordnung speichern fehlgeschlagen:", e);
    return { fehler: "Die Zuordnung konnte nicht gespeichert werden." };
  }
  // E67: Der Roh-Upload (mit Personen-Spalten) geht nach der Zuordnung weg.
  // Scheitert das Loeschen, raeumt der Job nach 24 h auf — der Lauf bleibt gueltig.
  await bucket.delete(key).catch((e) => console.error("Roh-Upload nicht gelöscht:", key, e));
  return { ok: true, zaehler };
}

/**
 * Vorlage speichern (PR b): die Spalten- und Werte-Zuordnung unter einem
 * Namen fuer alle mit Import-Recht; gleicher Name ersetzt die Vorlage. Das
 * Ereignis haengt an der Vorlage und traegt die Lauf-ID, aus dem sie kommt.
 */
export interface VorlageErgebnis {
  ok?: boolean;
  id?: string;
  fehler?: string;
}

export async function importVorlageSpeichern(laufId: string, name: string, quelle: string, zuordnung: Zuordnung): Promise<VorlageErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  const n = name.trim();
  if (n.length === 0 || n.length > 120) return { fehler: "Name der Vorlage: 1 bis 120 Zeichen." };
  const fehler = pruefeVorlage(zuordnung);
  if (fehler.length > 0) return { fehler: fehler.join(" ") };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const [alt] = await tx.select({ id: importVorlage.id }).from(importVorlage).where(eq(importVorlage.name, n)).limit(1);
        const werte = { quelle: quelle.trim() || null, spalten: zuordnung.spalten, werte: zuordnung.werte };
        let id: string;
        if (alt) {
          await tx.update(importVorlage).set({ ...werte, updatedAt: new Date() }).where(eq(importVorlage.id, alt.id));
          id = alt.id;
        } else {
          const [neu] = await tx.insert(importVorlage).values({ name: n, ...werte, erstellerId: wache.zugang.id }).returning({ id: importVorlage.id });
          id = neu!.id;
        }
        await protokolliere(tx, {
          art: alt ? "geaendert" : "angelegt",
          entitaet: "import_vorlage",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Import-Vorlage ${alt ? "ersetzt" : "angelegt"} (${Object.keys(zuordnung.spalten).length} Spalten) aus Lauf ${laufId}`,
          importLaufId: laufId,
        });
        return { ok: true, id };
      }),
    );
  } catch (e) {
    console.error("Import-Vorlage speichern fehlgeschlagen:", e);
    return { fehler: "Die Vorlage konnte nicht gespeichert werden." };
  }
}

/**
 * Akteure aufloesen (PR b, E67): je Gruppe (Normname + PLZ) EIN Aufruf des
 * Matchers — identisch uebernimmt, stark wartet auf Bestaetigung (Zeilen
 * „aehnlich"), sonst neuer Akteur. Zeilen ohne Akteur-Namen werden Fehler.
 * Lauf wird „aufgeloest", Zaehler und Ereignis mit Lauf-ID.
 */
export interface AufloesenErgebnis {
  ok?: boolean;
  fehler?: string;
  zaehler?: Record<string, number>;
}

function felderPatch(patch: Record<string, string>, entfernen: readonly string[] = []) {
  let ausdruck = sql`${importZeile.felder} || ${JSON.stringify(patch)}::jsonb`;
  for (const k of entfernen) ausdruck = sql`${ausdruck} - ${k}`;
  return ausdruck;
}

export async function importAkteureAufloesen(laufId: string): Promise<AufloesenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "zugeordnet" && lauf.status !== "aufgeloest") return { fehler: `Der Lauf ist „${lauf.status}" — Akteure werden nach der Zuordnung aufgelöst.` };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = await ladeImportZeilen(tx, lauf.id);
        const gruppen = akteurGruppen(zeilen);
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}), akteure_gruppen: gruppen.length, akteure_identisch: 0, akteure_vorschlag: 0, akteure_neu: 0 };
        for (const g of gruppen) {
          const treffer = await sucheAehnliche(tx as unknown as AppDb, g.name, g.plz || null, null);
          const e = entscheidungAusTreffer(g.schluessel, treffer);
          zaehler[`akteure_${e.ergebnis === "vorschlag" ? "vorschlag" : e.ergebnis}`] += 1;
          await tx
            .update(importZeile)
            .set({
              felder: felderPatch(e.patch, ["akteur_id", "akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad", "akteur_neu"].filter((k) => !(k in e.patch))),
              status: sql`case when ${importZeile.status} in ('offen', 'aehnlich') then ${e.statusOffen} else ${importZeile.status} end`,
            })
            .where(inArray(importZeile.id, g.zeilenIds));
        }
        const ohneName = zeilen.filter((z) => !(z.felder.akteur_name ?? "").trim()).map((z) => z.id);
        if (ohneName.length > 0) {
          await tx
            .update(importZeile)
            .set({ status: "fehler", fehlergrund: sql`coalesce(${importZeile.fehlergrund}, 'Akteur-Name fehlt.')` })
            .where(inArray(importZeile.id, ohneName));
        }
        zaehler.aehnlich = zaehler.akteure_vorschlag;
        await tx.update(importLauf).set({ status: "aufgeloest", zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "status_gesetzt",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Akteure aufgelöst: ${gruppen.length} Gruppen — ${zaehler.akteure_identisch} identisch, ${zaehler.akteure_vorschlag} Vorschlag, ${zaehler.akteure_neu} neu; ${ohneName.length} Zeile(n) ohne Akteur-Name`,
          importLaufId: lauf.id,
        });
        return { ok: true, zaehler };
      }),
    );
  } catch (e) {
    console.error("Akteure auflösen fehlgeschlagen:", e);
    return { fehler: "Akteure konnten nicht aufgelöst werden." };
  }
}

/**
 * Vorschlag entscheiden (PR b): „vorhanden" uebernimmt den vorgeschlagenen
 * Akteur, „neu" legt beim Ausfuehren neu an. gruppe = null entscheidet alle
 * offenen Vorschlaege gesammelt (E67: „auch gesammelt").
 */
export async function importAkteurEntscheiden(laufId: string, gruppe: string | null, entscheidung: "vorhanden" | "neu"): Promise<AufloesenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "aufgeloest") return { fehler: `Der Lauf ist „${lauf.status}" — Vorschläge gibt es nach dem Auflösen.` };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = (await ladeImportZeilen(tx, lauf.id)).filter((z) => z.felder.akteur_vorschlag_id && (gruppe === null || z.felder.akteur_gruppe === gruppe));
        if (zeilen.length === 0) return { fehler: "Kein offener Vorschlag für diese Auswahl." };
        const nachVorschlag = new Map<string, string[]>();
        for (const z of zeilen) {
          const k = z.felder.akteur_vorschlag_id!;
          nachVorschlag.set(k, [...(nachVorschlag.get(k) ?? []), z.id]);
        }
        for (const [vorschlagId, ids] of nachVorschlag) {
          const patch: Record<string, string> = entscheidung === "vorhanden" ? { akteur_id: vorschlagId } : { akteur_neu: "1" };
          await tx
            .update(importZeile)
            .set({
              felder: felderPatch(patch, ["akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad"]),
              status: sql`case when ${importZeile.status} = 'aehnlich' then 'offen' else ${importZeile.status} end`,
            })
            .where(inArray(importZeile.id, ids));
        }
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        zaehler.akteure_vorschlag = Math.max(0, (zaehler.akteure_vorschlag ?? 0) - nachVorschlag.size);
        zaehler.aehnlich = zaehler.akteure_vorschlag;
        zaehler[entscheidung === "vorhanden" ? "akteure_identisch" : "akteure_neu"] = (zaehler[entscheidung === "vorhanden" ? "akteure_identisch" : "akteure_neu"] ?? 0) + nachVorschlag.size;
        await tx.update(importLauf).set({ zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          // E57: Gruppen-Schluessel sind Betriebsnamen in Normalform, keine Personen.
          text: `Akteur-Vorschlag ${entscheidung === "vorhanden" ? "übernommen" : "verworfen (neu anlegen)"}: ${gruppe === null ? "alle offenen Vorschläge" : `Gruppe ${gruppe}`}, ${zeilen.length} Zeile(n)`,
          importLaufId: lauf.id,
        });
        return { ok: true, zaehler };
      }),
    );
  } catch (e) {
    console.error("Akteur-Vorschlag entscheiden fehlgeschlagen:", e);
    return { fehler: "Die Entscheidung konnte nicht gespeichert werden." };
  }
}

/**
 * Adressen aufloesen (PR b, E67): Sitz neuer Akteure per Adresssuche, je
 * eindeutiger Adresse ein Aufruf, hoechstens ADRESSEN_JE_STAPEL je Request
 * (Photon 0,5–1,3 s je Anfrage) — der Browser ruft so lange, bis nichts mehr
 * offen ist. Zwischenspeicher sind die Zeilenfelder, dadurch fortsetzbar.
 * Ist der Dienst nicht erreichbar, bleibt alles wie es war und der Fehler
 * wird genannt.
 */
export interface AdressenErgebnis {
  ok?: boolean;
  fehler?: string;
  /** In diesem Stapel bearbeitet, danach noch offen, davon in diesem Stapel ohne Treffer. */
  bearbeitet?: number;
  offen?: number;
  ohneTreffer?: number;
}

export async function importAdressenAufloesen(laufId: string): Promise<AdressenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "aufgeloest") return { fehler: `Der Lauf ist „${lauf.status}" — Adressen werden nach dem Auflösen der Akteure gesucht.` };

  const zeilen = await withDb((db) => ladeImportZeilen(db, lauf.id));
  const gruppen = adressGruppen(zeilen);
  const stapel = gruppen.slice(0, ADRESSEN_JE_STAPEL);
  if (stapel.length === 0) return { ok: true, bearbeitet: 0, offen: 0, ohneTreffer: 0 };

  // Erst alle Netzaufrufe des Stapels, dann eine Transaktion — ein Netzfehler laesst die DB unberuehrt.
  const ergebnisse: { gruppe: (typeof stapel)[number]; patch: Record<string, string>; offen: boolean }[] = [];
  for (const g of stapel) {
    const text = adressText(g);
    let e: ReturnType<typeof waehleSitz>;
    if (!text) e = waehleSitz(g, []);
    else {
      try {
        e = waehleSitz(g, await photonSuche(text));
      } catch (err) {
        if (err instanceof PhotonNichtErreichbar) return { fehler: "Adresssuche nicht erreichbar — später fortsetzen, der Stand bleibt erhalten." };
        throw err;
      }
    }
    ergebnisse.push({ gruppe: g, patch: sitzPatch(e), offen: "offen" in e });
  }

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        for (const r of ergebnisse) {
          await tx.update(importZeile).set({ felder: felderPatch(r.patch) }).where(inArray(importZeile.id, r.gruppe.zeilenIds));
        }
        const ohneTreffer = ergebnisse.filter((r) => r.offen).length;
        const offen = gruppen.length - stapel.length;
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        zaehler.adressen_gefunden = (zaehler.adressen_gefunden ?? 0) + (stapel.length - ohneTreffer);
        zaehler.adressen_offen = (zaehler.adressen_offen ?? 0) + ohneTreffer;
        await tx.update(importLauf).set({ zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Adressen aufgelöst: ${stapel.length} Adresse(n), ${ohneTreffer} ohne eindeutigen Treffer, ${offen} noch offen`,
          importLaufId: lauf.id,
        });
        return { ok: true, bearbeitet: stapel.length, offen, ohneTreffer };
      }),
    );
  } catch (e) {
    console.error("Adressen auflösen fehlgeschlagen:", e);
    return { fehler: "Die Adressen konnten nicht gespeichert werden." };
  }
}
