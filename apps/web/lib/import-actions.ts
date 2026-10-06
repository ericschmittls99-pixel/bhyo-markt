"use server";

import { beleg, importLauf, importVorlage, importZeile } from "@bhyo/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getBelegeBucket, getEnvironment, withDb, type AppDb } from "@/lib/db";
import { sucheAehnlicheMenge } from "@/lib/dubletten";
import { dateiErlaubt, IMPORT_MAX_BYTES, ImportDateiFehler, parseImportDatei, sha256Hex, type ImportTabelle } from "@/lib/import-datei";
import { istPersonenSchluessel, pruefeImportLaufEingabe, type ImportLaufEingabe, type ImportLaufFehler } from "@/lib/import-modell";
import { ADRESSEN_JE_STAPEL, adressGruppen, adressText, sitzPatch, waehleSitz } from "@/lib/import-adressen";
import { AKTEURE_JE_STAPEL, akteurGruppen, entscheidungAusTreffer, offeneAkteurGruppen } from "@/lib/import-akteure";
import { PROBELAUF_JE_STAPEL } from "@/lib/import-konstanten";
import { importBelegKey, importRohKey, ladeImportLauf, ladeImportZeilen } from "@/lib/import-server";
import { bereinigteCsv, PERSON, pruefeVorlage, pruefeZuordnung, zeileZuFelder, zielfeld, type Zuordnung } from "@/lib/import-zuordnung";
import { PhotonNichtErreichbar, photonSuche } from "@/lib/photon-server";
import { stelleImportAbschlussZu } from "@/lib/inbox/zustellung";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";
import type { StromArt } from "@/lib/stroeme-modell";
import { akteurAnlegenInTx, AkteurFehlerAusnahme } from "@/lib/akteur-schreibweg";
import { erstelleBeleg, ValidierungsFehler, type BelegEingabe } from "@/lib/beleg-server";
import { heuteBerlin } from "@/lib/datum";
import { brauchtGueltigBis, istBelegTyp } from "@/lib/qualitaet";
import { FeldFehlerAusnahme, stromAnlegenInTx, stromEingabeAusFormData, type Handelnder, type Tx } from "@/lib/strom-schreibweg";

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
    // E67: Am Lauf-Beleg haengt die serverseitig bereinigte Kopie (ohne Personen-
    // und ignorierte Spalten) — sie entsteht hier, solange der Roh-Upload da ist.
    await bucket.put(importBelegKey(env, lauf.id), new TextEncoder().encode(bereinigteCsv(tabelle.spalten, tabelle.zeilen, zuordnung)).buffer as ArrayBuffer, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
    });
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
 * Akteure aufloesen (PR b, E67; Eric 06.10.2026): browser-gesteuert in
 * Stapeln von AKTEURE_JE_STAPEL eindeutigen Akteuren (Normname + PLZ), der
 * Matcher laeuft je Stapel als EINE mengenbasierte Abfrage. Identisch
 * uebernimmt, stark wartet auf Bestaetigung (Zeilen „aehnlich"), sonst
 * neuer Akteur. Fortsetzbar: erledigte Gruppen tragen akteur_gruppe. Nach
 * dem letzten Stapel wird der Lauf „aufgeloest"; Zeilen ohne Akteur-Namen
 * werden Fehler.
 */
export interface AufloesenErgebnis {
  ok?: boolean;
  fehler?: string;
  zaehler?: Record<string, number>;
  /** Gruppen in diesem Stapel, danach noch offen. */
  bearbeitet?: number;
  offen?: number;
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
  if (!NACHARBEIT_ZUSTAENDE.includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Akteure werden nach der Zuordnung aufgelöst.` };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = await ladeImportZeilen(tx, lauf.id);
        const alleGruppen = akteurGruppen(zeilen);
        const offene = offeneAkteurGruppen(zeilen);
        const stapel = offene.slice(0, AKTEURE_JE_STAPEL);
        const zaehler: Record<string, number> = { akteure_identisch: 0, akteure_vorschlag: 0, akteure_neu: 0, ...(lauf.zaehler ?? {}), akteure_gruppen: alleGruppen.length };
        if (offene.length === alleGruppen.length) {
          // Erster Stapel: Zaehler neu beginnen.
          zaehler.akteure_identisch = 0;
          zaehler.akteure_vorschlag = 0;
          zaehler.akteure_neu = 0;
        }
        // EINE Abfrage fuer den ganzen Stapel.
        const treffer = await sucheAehnlicheMenge(tx as unknown as AppDb, stapel.map((g) => ({ schluessel: g.schluessel, name: g.name, plz: g.plz || null })));
        for (const g of stapel) {
          const e = entscheidungAusTreffer(g.schluessel, treffer.get(g.schluessel) ?? []);
          zaehler[`akteure_${e.ergebnis === "vorschlag" ? "vorschlag" : e.ergebnis}`] += 1;
          await tx
            .update(importZeile)
            .set({
              felder: felderPatch(e.patch, ["akteur_id", "akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad", "akteur_neu"].filter((k) => !(k in e.patch))),
              status: sql`case when ${importZeile.status} in ('offen', 'aehnlich') then ${e.statusOffen} else ${importZeile.status} end`,
            })
            .where(inArray(importZeile.id, g.zeilenIds));
        }
        const offen = offene.length - stapel.length;
        const fertig = offen === 0;
        let ohneName = 0;
        if (fertig) {
          const ids = zeilen.filter((z) => !(z.felder.akteur_name ?? "").trim()).map((z) => z.id);
          ohneName = ids.length;
          if (ids.length > 0) {
            await tx
              .update(importZeile)
              .set({ status: "fehler", fehlergrund: sql`coalesce(${importZeile.fehlergrund}, 'Akteur-Name fehlt.')` })
              .where(inArray(importZeile.id, ids));
          }
        }
        zaehler.aehnlich = zaehler.akteure_vorschlag;
        // Nach Nacharbeit (Probelauf/ausgefuehrt) bleibt der Zustand des Laufs; nur aus der Zuordnung heraus wird er „aufgeloest".
        const statusNeu = fertig && (lauf.status === "zugeordnet" || lauf.status === "aufgeloest") ? { status: "aufgeloest" } : {};
        await tx
          .update(importLauf)
          .set({ zaehler, ...statusNeu, updatedAt: new Date() })
          .where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: fertig ? "status_gesetzt" : "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: fertig
            ? `Akteure aufgelöst: ${alleGruppen.length} Gruppen — ${zaehler.akteure_identisch} identisch, ${zaehler.akteure_vorschlag} Vorschlag, ${zaehler.akteure_neu} neu; ${ohneName} Zeile(n) ohne Akteur-Name`
            : `Akteure auflösen: Stapel mit ${stapel.length} Gruppen, ${offen} noch offen`,
          importLaufId: lauf.id,
        });
        return { ok: true, zaehler, bearbeitet: stapel.length, offen };
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
        if (err instanceof PhotonNichtErreichbar) return { fehler: `${err.message} Später fortsetzen, der Stand bleibt erhalten.` };
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

/**
 * Belegdaten des Laufs (PR b): Erhebungsdatum und — bei den oberen vier
 * Typen (E33) — Gueltig-bis fuer den Lauf-Beleg. E67 legt beides nicht
 * fest; abgefragt statt geraten. Pflicht vor dem Probelauf.
 */
export interface BelegDatenErgebnis {
  ok?: boolean;
  fehler?: string;
  feldFehler?: { erhebungsdatum?: string; gueltigBis?: string };
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

export async function importBelegDatenSetzen(laufId: string, erhebungsdatum: string, gueltigBis: string): Promise<BelegDatenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!["zugeordnet", "aufgeloest", "probelauf"].includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Belegdaten gelten für den Probelauf.` };
  const feldFehler: BelegDatenErgebnis["feldFehler"] = {};
  const e = erhebungsdatum.trim();
  const g = gueltigBis.trim();
  if (!DATUM.test(e)) feldFehler.erhebungsdatum = "Erhebungsdatum (JJJJ-MM-TT) ist Pflicht.";
  if (g && !DATUM.test(g)) feldFehler.gueltigBis = "Gültig bis als JJJJ-MM-TT.";
  if (!g && istBelegTyp(lauf.belegTyp) && brauchtGueltigBis(lauf.belegTyp)) feldFehler.gueltigBis = "Gültig bis ist bei diesem Belegtyp Pflicht (E33).";
  if (Object.keys(feldFehler).length > 0) return { feldFehler };
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await tx.update(importLauf).set({ belegErhebungsdatum: e, belegGueltigBis: g || null, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Belegdaten des Laufs gesetzt: Erhebungsdatum ${e}${g ? `, gültig bis ${g}` : ""}`,
          importLaufId: lauf.id,
        });
      }),
    );
    return { ok: true };
  } catch (err) {
    console.error("Belegdaten setzen fehlgeschlagen:", err);
    return { fehler: "Die Belegdaten konnten nicht gespeichert werden." };
  }
}

/** Beendet die Probelauf-Transaktion absichtlich — alles rollt zurueck, nichts wird angelegt. */
class ProbelaufEnde extends Error {}

export interface ProbelaufErgebnis {
  ok?: boolean;
  fehler?: string;
  bearbeitet?: number;
  okZeilen?: number;
  fehlerZeilen?: number;
  /** Naechste Zeilennummer oder null, wenn der Lauf durch ist. */
  naechste?: number | null;
}

/** Fachlicher Grund einer gescheiterten Zeile — technische Fehler werden geloggt und genannt. */
function zeilenGrund(e: unknown): string {
  if (e instanceof FeldFehlerAusnahme) return Object.entries(e.feldFehler).map(([k, v]) => `${k}: ${v}`).join(" · ");
  if (e instanceof ValidierungsFehler || e instanceof AkteurFehlerAusnahme) return e.message;
  console.error("Probelauf: technischer Fehler in einer Zeile:", e);
  return `Technischer Fehler: ${e instanceof Error ? e.message : String(e)}`;
}

/** FormData fuer den Formular-Baustein aus den Strom-Feldern der Zeile (akteur_* bleiben draussen, akteur_id kommt aufgeloest). */
function formDataAusZeile(felder: Record<string, string>, akteurId: string): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(felder)) {
    const def = zielfeld(k);
    if (def && def.gruppe === "strom") fd.set(k, v);
  }
  fd.set("akteur_id", akteurId);
  return fd;
}

/**
 * Probelauf (PR b, E67): hoechstens 100 Zeilen je Request, in EINER
 * Transaktion mit Savepoint je Beleg, Akteur und Zeile — am Ende wird die
 * Transaktion absichtlich zurueckgerollt, nichts bleibt. Jede Zeile geht
 * durch dieselben Bausteine wie das Formular (akteurAnlegenInTx,
 * erstelleBeleg, stromAnlegenInTx). Ergebnisse (ok | fehler mit Grund)
 * schreibt eine zweite Transaktion in die Zeilen; der Browser ruft mit der
 * naechsten Zeilennummer weiter, bis null zurueckkommt.
 */
export async function importProbelauf(laufId: string, abZeilennummer: number): Promise<ProbelaufErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!["aufgeloest", "probelauf", "ausgefuehrt"].includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — der Probelauf kommt nach dem Auflösen der Akteure.` };
  if (!lauf.belegErhebungsdatum) return { fehler: "Belegdaten fehlen: bitte Erhebungsdatum (und bei den oberen vier Belegtypen Gültig bis) setzen." };
  if (istBelegTyp(lauf.belegTyp) && brauchtGueltigBis(lauf.belegTyp) && !lauf.belegGueltigBis) return { fehler: "Gültig bis fehlt für den Belegtyp des Laufs (E33)." };

  const alle = await withDb((db) => ladeImportZeilen(db, lauf.id));
  if (alle.some((z) => z.status === "aehnlich")) return { fehler: "Es gibt noch offene Akteur-Vorschläge — erst übernehmen oder neu anlegen." };
  const stapel = alle.filter((z) => z.zeilennummer >= abZeilennummer && z.status !== "uebersprungen").slice(0, PROBELAUF_JE_STAPEL);
  const naechste = stapel.length === PROBELAUF_JE_STAPEL ? (alle.find((z) => z.zeilennummer > stapel[stapel.length - 1]!.zeilennummer && z.status !== "uebersprungen")?.zeilennummer ?? null) : null;
  const handelnder: Handelnder = { id: wache.zugang.id, email: wache.email, rolle: wache.zugang.rolle };
  const aktiveCodes = (await ladeSektoren()).filter((s) => s.aktiv).map((s) => s.code);
  const env = await getEnvironment();
  const heute = heuteBerlin();
  const art = lauf.art as StromArt;
  const ergebnisse = new Map<string, string | null>();

  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const belege = new Map<string, string>();
        const akteure = new Map<string, { id: string } | { fehler: string }>();
        const DATUM = /^\d{4}-\d{2}-\d{2}$/;
        // Ein geteilter Beleg je (Lauf, Belegtyp, Erhebungsdatum, Gueltig-bis): eine
        // zugeordnete Spalte geht dem Lauf-Wert je Zeile vor (Eric 06.10.2026).
        const belegFuer = async (f: Record<string, string>): Promise<string> => {
          const typ = f.beleg_typ || lauf.belegTyp;
          if (!istBelegTyp(typ)) throw new ValidierungsFehler(`Belegtyp „${typ}" ist unbekannt.`);
          const erhebungsdatum = f.beleg_erhebungsdatum || lauf.belegErhebungsdatum!;
          if (!DATUM.test(erhebungsdatum)) throw new ValidierungsFehler(`Erhebungsdatum „${erhebungsdatum}" ist kein Datum (JJJJ-MM-TT).`);
          const gueltigBis = brauchtGueltigBis(typ) ? f.beleg_gueltig_bis || lauf.belegGueltigBis || "" : "";
          if (brauchtGueltigBis(typ) && !gueltigBis) throw new ValidierungsFehler(`Gültig bis fehlt für Belegtyp „${typ}" (E33).`);
          if (gueltigBis && !DATUM.test(gueltigBis)) throw new ValidierungsFehler(`Gültig bis „${gueltigBis}" ist kein Datum (JJJJ-MM-TT).`);
          const schluessel = `${typ}|${erhebungsdatum}|${gueltigBis}`;
          const vorhanden = belege.get(schluessel);
          if (vorhanden) return vorhanden;
          const eingabe: BelegEingabe = {
            typ,
            // E67: Quelle = Dateiname + Lauf-ID; extern_nachvollziehbar = nein.
            quellenangabe: `${lauf.dateiname} · Import-Lauf ${lauf.id}`,
            erhebungsdatum,
            link: null,
            gueltigBis: gueltigBis || null,
            kernnotiz: null,
            externNachvollziehbar: false,
            datei: null,
            dateiKey: importBelegKey(env, lauf.id),
          };
          const id = await tx.transaction(async (sp) => (await erstelleBeleg(sp as unknown as Tx, eingabe))!.belegId);
          belege.set(schluessel, id);
          return id;
        };
        const akteurFuer = async (f: Record<string, string>): Promise<string> => {
          if (f.akteur_id) return f.akteur_id;
          if (f.akteur_neu !== "1") throw new ValidierungsFehler("Akteur ist nicht aufgelöst — erst „Akteure auflösen“.");
          const gruppe = f.akteur_gruppe ?? `${f.akteur_name}|${f.akteur_sitz_plz ?? ""}`;
          const bekannt = akteure.get(gruppe);
          if (bekannt) {
            if ("fehler" in bekannt) throw new AkteurFehlerAusnahme(bekannt.fehler);
            return bekannt.id;
          }
          if (f.akteur_sitz_offen) {
            akteure.set(gruppe, { fehler: `Sitz offen: ${f.akteur_sitz_offen}` });
            throw new AkteurFehlerAusnahme(`Sitz offen: ${f.akteur_sitz_offen}`);
          }
          try {
            const neu = await tx.transaction((sp) =>
              akteurAnlegenInTx(sp as unknown as Tx, handelnder, {
                eingabe: {
                  name: f.akteur_name,
                  sektor: f.akteur_sektor || lauf.standardSektor,
                  sitz_strasse: f.akteur_sitz_strasse,
                  sitz_hausnummer: f.akteur_sitz_hausnummer,
                  sitz_plz: f.akteur_sitz_plz,
                  sitz_ort: f.akteur_sitz_ort,
                  lat: f.akteur_sitz_lat,
                  lng: f.akteur_sitz_lng,
                },
                aktiveCodes,
                importLaufId: lauf.id,
              }),
            );
            akteure.set(gruppe, { id: neu.id });
            return neu.id;
          } catch (e) {
            if (e instanceof AkteurFehlerAusnahme) akteure.set(gruppe, { fehler: e.message });
            throw e;
          }
        };
        for (const z of stapel) {
          try {
            const belegId = await belegFuer(z.felder);
            const akteurId = await akteurFuer(z.felder);
            await tx.transaction(async (sp) => {
              const e = stromEingabeAusFormData(art, formDataAusZeile(z.felder, akteurId));
              await stromAnlegenInTx(sp as unknown as Tx, handelnder, { ...e, beleg: null, belegId }, heute);
            });
            ergebnisse.set(z.id, null);
          } catch (e) {
            ergebnisse.set(z.id, zeilenGrund(e));
          }
        }
        throw new ProbelaufEnde();
      }),
    );
  } catch (e) {
    if (!(e instanceof ProbelaufEnde)) {
      console.error("Probelauf abgebrochen:", e);
      return { fehler: "Der Probelauf ist technisch abgebrochen — nichts wurde angelegt." };
    }
  }

  const okZeilen = [...ergebnisse.values()].filter((g) => g === null).length;
  const fehlerZeilen = ergebnisse.size - okZeilen;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        for (const [id, grund] of ergebnisse) {
          await tx
            .update(importZeile)
            .set({
              status: grund ? "fehler" : "offen",
              fehlergrund: grund,
              felder: felderPatch({ probelauf: grund ? "fehler" : "ok" }),
            })
            .where(eq(importZeile.id, id));
        }
        const erster = stapel[0] && alle.find((z) => z.status !== "uebersprungen")?.zeilennummer === stapel[0].zeilennummer;
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        zaehler.probelauf_ok = (erster ? 0 : (zaehler.probelauf_ok ?? 0)) + okZeilen;
        zaehler.probelauf_fehler = (erster ? 0 : (zaehler.probelauf_fehler ?? 0)) + fehlerZeilen;
        const fertig = naechste === null;
        await tx
          .update(importLauf)
          .set({ zaehler, ...(fertig ? { status: "probelauf" } : {}), updatedAt: new Date() })
          .where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: fertig ? "status_gesetzt" : "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Probelauf${fertig ? " abgeschlossen" : ""}: ${stapel.length} Zeile(n), ${okZeilen} ok, ${fehlerZeilen} mit Fehler — nichts angelegt`,
          importLaufId: lauf.id,
        });
      }),
    );
  } catch (e) {
    console.error("Probelauf-Ergebnis speichern fehlgeschlagen:", e);
    return { fehler: "Das Ergebnis des Probelaufs konnte nicht gespeichert werden." };
  }
  return { ok: true, bearbeitet: stapel.length, okZeilen, fehlerZeilen, naechste };
}

/**
 * Ausfuehren (PR c, E67): wie der Probelauf, nur mit COMMIT — hoechstens
 * PROBELAUF_JE_STAPEL offene Zeilen je Request, Savepoint je Zeile, jede
 * Zeile durch dieselben Bausteine wie das Formular. Akteure entstehen je
 * Gruppe einmal (akteur_id wird in alle Zeilen der Gruppe zurueckgeschrieben,
 * damit Folge-Stapel ihn kennen), Belege je (Typ, Erhebungsdatum, Gueltig-bis)
 * einmal je Lauf (Wiederverwendung ueber die Quellenangabe). Fehlerhafte
 * Zeilen bleiben mit Grund stehen (Nacharbeit), importierte tragen die
 * Strom-ID. Nach dem letzten Stapel: Lauf „ausgefuehrt", abgeschlossen_am,
 * Ereignis kontaktdaten_uebersprungen je Akteur (einmal je Lauf, wenn die
 * Datei Personen-Spalten hatte), Inbox import_abgeschlossen gebuendelt an
 * alle aktiven Pruefer und Admins. Vorbedingung: ein Probelauf ist durch.
 */
export interface AusfuehrenErgebnis {
  ok?: boolean;
  fehler?: string;
  bearbeitet?: number;
  importiert?: number;
  fehlerZeilen?: number;
  naechste?: number | null;
}

export async function importAusfuehren(laufId: string, abZeilennummer: number): Promise<AusfuehrenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "probelauf") return { fehler: `Der Lauf ist „${lauf.status}" — ausgeführt wird nach einem durchgelaufenen Probelauf.` };
  if (!lauf.belegErhebungsdatum) return { fehler: "Belegdaten fehlen." };

  const alle = await withDb((db) => ladeImportZeilen(db, lauf.id));
  if (alle.some((z) => z.status === "aehnlich")) return { fehler: "Es gibt noch offene Akteur-Vorschläge — erst übernehmen oder neu anlegen." };
  const offen = alle.filter((z) => z.status === "offen");
  const stapel = offen.filter((z) => z.zeilennummer >= abZeilennummer).slice(0, PROBELAUF_JE_STAPEL);
  const naechste = stapel.length === PROBELAUF_JE_STAPEL ? (offen.find((z) => z.zeilennummer > stapel[stapel.length - 1]!.zeilennummer)?.zeilennummer ?? null) : null;
  const handelnder: Handelnder = { id: wache.zugang.id, email: wache.email, rolle: wache.zugang.rolle };
  const aktiveCodes = (await ladeSektoren()).filter((s) => s.aktiv).map((s) => s.code);
  const env = await getEnvironment();
  const heute = heuteBerlin();
  const art = lauf.art as StromArt;
  const quellenangabe = `${lauf.dateiname} · Import-Lauf ${lauf.id}`;
  const DATUM = /^\d{4}-\d{2}-\d{2}$/;
  const personenSpalten = (lauf.zaehler?.personen_spalten ?? 0) > 0;

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const belege = new Map<string, string>();
        const akteure = new Map<string, { id: string } | { fehler: string }>();
        const akteureMitEreignis = new Set<string>();
        let importiert = 0;
        let fehlerZeilen = 0;

        const belegFuer = async (f: Record<string, string>): Promise<string> => {
          const typ = f.beleg_typ || lauf.belegTyp;
          if (!istBelegTyp(typ)) throw new ValidierungsFehler(`Belegtyp „${typ}" ist unbekannt.`);
          const erhebungsdatum = f.beleg_erhebungsdatum || lauf.belegErhebungsdatum!;
          if (!DATUM.test(erhebungsdatum)) throw new ValidierungsFehler(`Erhebungsdatum „${erhebungsdatum}" ist kein Datum (JJJJ-MM-TT).`);
          const gueltigBis = brauchtGueltigBis(typ) ? f.beleg_gueltig_bis || lauf.belegGueltigBis || "" : "";
          if (brauchtGueltigBis(typ) && !gueltigBis) throw new ValidierungsFehler(`Gültig bis fehlt für Belegtyp „${typ}" (E33).`);
          if (gueltigBis && !DATUM.test(gueltigBis)) throw new ValidierungsFehler(`Gültig bis „${gueltigBis}" ist kein Datum (JJJJ-MM-TT).`);
          const schluessel = `${typ}|${erhebungsdatum}|${gueltigBis}`;
          const bekannt = belege.get(schluessel);
          if (bekannt) return bekannt;
          // Ein frueherer Stapel desselben Laufs hat den Beleg schon angelegt: wiederverwenden (E48, ein Beleg je Lauf und Typ).
          const [vorhanden] = await tx
            .select({ id: beleg.id })
            .from(beleg)
            .where(
              and(
                eq(beleg.typ, typ),
                sql`${beleg.metadata} ->> 'quellenangabe' = ${quellenangabe}`,
                sql`${beleg.erstelltAm} = ${new Date(erhebungsdatum)}`,
                gueltigBis ? eq(beleg.gueltigBis, gueltigBis) : sql`${beleg.gueltigBis} is null`,
              ),
            )
            .limit(1);
          if (vorhanden) {
            belege.set(schluessel, vorhanden.id);
            return vorhanden.id;
          }
          const eingabe: BelegEingabe = {
            typ,
            quellenangabe,
            erhebungsdatum,
            link: null,
            gueltigBis: gueltigBis || null,
            kernnotiz: null,
            externNachvollziehbar: false,
            datei: null,
            dateiKey: importBelegKey(env, lauf.id),
          };
          const id = await tx.transaction(async (sp) => (await erstelleBeleg(sp as unknown as Tx, eingabe))!.belegId);
          belege.set(schluessel, id);
          return id;
        };

        const kontaktdatenEreignis = async (akteurId: string) => {
          // E67 (DSGVO): je Akteur einmal je Lauf — die Datei hatte Personen-Spalten, deren Inhalte nie uebernommen wurden.
          if (!personenSpalten || akteureMitEreignis.has(akteurId)) return;
          akteureMitEreignis.add(akteurId);
          await protokolliere(tx, {
            art: "kontaktdaten_uebersprungen",
            entitaet: "akteur",
            id: akteurId,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Kontaktdaten aus der Importdatei nicht übernommen (${lauf.zaehler?.personen_spalten} Personen-Spalte(n)), Lauf ${lauf.id}`,
            importLaufId: lauf.id,
          });
        };

        const akteurFuer = async (f: Record<string, string>): Promise<string> => {
          if (f.akteur_id) return f.akteur_id;
          if (f.akteur_neu !== "1") throw new ValidierungsFehler("Akteur ist nicht aufgelöst — erst „Akteure auflösen“.");
          const gruppe = f.akteur_gruppe ?? `${f.akteur_name}|${f.akteur_sitz_plz ?? ""}`;
          const bekannt = akteure.get(gruppe);
          if (bekannt) {
            if ("fehler" in bekannt) throw new AkteurFehlerAusnahme(bekannt.fehler);
            return bekannt.id;
          }
          if (f.akteur_sitz_offen) {
            akteure.set(gruppe, { fehler: `Sitz offen: ${f.akteur_sitz_offen}` });
            throw new AkteurFehlerAusnahme(`Sitz offen: ${f.akteur_sitz_offen}`);
          }
          try {
            const neu = await tx.transaction((sp) =>
              akteurAnlegenInTx(sp as unknown as Tx, handelnder, {
                eingabe: {
                  name: f.akteur_name,
                  sektor: f.akteur_sektor || lauf.standardSektor,
                  sitz_strasse: f.akteur_sitz_strasse,
                  sitz_hausnummer: f.akteur_sitz_hausnummer,
                  sitz_plz: f.akteur_sitz_plz,
                  sitz_ort: f.akteur_sitz_ort,
                  lat: f.akteur_sitz_lat,
                  lng: f.akteur_sitz_lng,
                },
                aktiveCodes,
                importLaufId: lauf.id,
              }),
            );
            akteure.set(gruppe, { id: neu.id });
            // Folge-Stapel kennen den Akteur ueber die Zeilenfelder, nicht ueber den Speicher dieses Requests.
            const ids = alle.filter((z) => z.felder.akteur_gruppe === gruppe && !z.felder.akteur_id).map((z) => z.id);
            if (ids.length > 0) await tx.update(importZeile).set({ felder: felderPatch({ akteur_id: neu.id }, ["akteur_neu"]) }).where(inArray(importZeile.id, ids));
            return neu.id;
          } catch (e) {
            if (e instanceof AkteurFehlerAusnahme) akteure.set(gruppe, { fehler: e.message });
            throw e;
          }
        };

        for (const z of stapel) {
          try {
            const belegId = await belegFuer(z.felder);
            const akteurId = await akteurFuer(z.felder);
            const stromId = await tx.transaction(async (sp) => {
              const e = stromEingabeAusFormData(art, formDataAusZeile(z.felder, akteurId));
              return (await stromAnlegenInTx(sp as unknown as Tx, handelnder, { ...e, beleg: null, belegId, importLaufId: lauf.id }, heute)).id;
            });
            await kontaktdatenEreignis(akteurId);
            await tx
              .update(importZeile)
              .set({
                status: "importiert",
                fehlergrund: null,
                ...(art === "biomasse" ? { biomassestromId: stromId } : { outputBedarfId: stromId }),
                felder: felderPatch({ akteur_id: akteurId }, ["akteur_neu", "probelauf"]),
              })
              .where(eq(importZeile.id, z.id));
            importiert += 1;
          } catch (e) {
            fehlerZeilen += 1;
            await tx.update(importZeile).set({ status: "fehler", fehlergrund: zeilenGrund(e) }).where(eq(importZeile.id, z.id));
          }
        }

        const fertig = naechste === null;
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        const erster = stapel[0] && offen[0]?.zeilennummer === stapel[0].zeilennummer;
        zaehler.importiert = (erster ? 0 : (zaehler.importiert ?? 0)) + importiert;
        zaehler.fehler = alle.filter((z) => z.status === "fehler").length + fehlerZeilen;
        zaehler.offen = Math.max(0, offen.length - stapel.length);
        zaehler.uebersprungen = alle.filter((z) => z.status === "uebersprungen").length;
        zaehler.akteure_angelegt = (erster ? 0 : (zaehler.akteure_angelegt ?? 0)) + [...akteure.values()].filter((a) => "id" in a).length;
        await tx
          .update(importLauf)
          .set({ zaehler, ...(fertig ? { status: "ausgefuehrt", abgeschlossenAm: new Date() } : {}), updatedAt: new Date() })
          .where(eq(importLauf.id, lauf.id));
        const ereignis = await protokolliere(tx, {
          art: fertig ? "status_gesetzt" : "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: fertig
            ? `Import ausgeführt: ${zaehler.importiert} Ströme angelegt, ${zaehler.akteure_angelegt} neue Akteure, ${zaehler.fehler} Zeile(n) in der Nacharbeit, ${zaehler.uebersprungen} übersprungen`
            : `Import läuft: Stapel mit ${stapel.length} Zeile(n), ${importiert} angelegt, ${fehlerZeilen} Fehler, ${zaehler.offen} offen`,
          importLaufId: lauf.id,
        });
        if (fertig) await stelleImportAbschlussZu(tx, { importLaufId: lauf.id, ausloeserId: wache.zugang.id, ereignisId: ereignis.id, importiert: zaehler.importiert });
        return { ok: true, bearbeitet: stapel.length, importiert, fehlerZeilen, naechste };
      }),
    );
  } catch (e) {
    console.error("Import ausführen fehlgeschlagen:", e);
    // Interne Oberflaeche (Pruefer/Admin): der Grund gehoert in die Meldung, nicht nur ins Log.
    const grund = e instanceof Error ? e.message : String(e);
    return { fehler: `Das Ausführen ist technisch abgebrochen — der aktuelle Stapel wurde zurückgerollt, frühere Stapel bleiben. Grund: ${grund.slice(0, 300)}` };
  }
}

/**
 * Nacharbeit (PR c, E67): eine Zeile mit Fehler korrigieren — nur bekannte
 * Zielfelder, nie Personen-Schluessel; aendert sich der Akteur (Name oder
 * PLZ), faellt seine Aufloesung weg und „Akteure aufloesen" laeuft fuer die
 * Zeile erneut. Die Zeile wird wieder „offen" und geht durch Probelauf und
 * Ausfuehren. Ueberspringen setzt „uebersprungen" — die Zeile bleibt als
 * Beleg der Entscheidung stehen, nichts wird geloescht.
 */
export interface ZeileErgebnisAction {
  ok?: boolean;
  fehler?: string;
}

const AKTEUR_AUFLOESUNG = ["akteur_id", "akteur_neu", "akteur_gruppe", "akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad", "akteur_sitz_lat", "akteur_sitz_lng", "akteur_sitz_quelle", "akteur_sitz_offen"] as const;
const NACHARBEIT_ZUSTAENDE = ["zugeordnet", "aufgeloest", "probelauf", "ausgefuehrt"];

export async function importZeileBearbeiten(laufId: string, zeileId: string, eingabe: Record<string, string>): Promise<ZeileErgebnisAction> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId) || !/^[0-9a-f-]{36}$/.test(zeileId)) return { fehler: "Ungültige ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!NACHARBEIT_ZUSTAENDE.includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Nacharbeit gibt es nach der Zuordnung.` };
  const art = lauf.art as StromArt;
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(eingabe)) {
    if (istPersonenSchluessel(k)) return { fehler: `Feld „${k}": Personen-Daten werden nicht übernommen.` };
    const def = zielfeld(k);
    if (!def || !def.arten.includes(art) || def.typ === "einheit") return { fehler: `Feld „${k}" ist kein Zielfeld dieses Laufs.` };
    patch[k] = typeof v === "string" ? v.trim() : "";
  }
  if (Object.keys(patch).length === 0) return { fehler: "Keine Änderung." };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const [zeile] = await tx
          .select({ id: importZeile.id, zeilennummer: importZeile.zeilennummer, status: importZeile.status, felder: importZeile.felder })
          .from(importZeile)
          .where(and(eq(importZeile.id, zeileId), eq(importZeile.laufId, lauf.id)))
          .limit(1);
        if (!zeile) return { fehler: "Zeile nicht gefunden." };
        if (zeile.status !== "fehler" && zeile.status !== "offen") return { fehler: `Zeile ${zeile.zeilennummer} ist „${zeile.status}" — nur offene und fehlerhafte Zeilen lassen sich bearbeiten.` };
        const alt = zeile.felder as Record<string, string>;
        const akteurGeaendert = ("akteur_name" in patch && patch.akteur_name !== (alt.akteur_name ?? "")) || ("akteur_sitz_plz" in patch && patch.akteur_sitz_plz !== (alt.akteur_sitz_plz ?? ""));
        const entfernen: string[] = [...Object.keys(patch).filter((k) => patch[k] === ""), "probelauf", ...(akteurGeaendert ? AKTEUR_AUFLOESUNG : [])];
        const setzen = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== ""));
        await tx
          .update(importZeile)
          .set({ felder: felderPatch(setzen, entfernen), status: "offen", fehlergrund: null })
          .where(eq(importZeile.id, zeile.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          // E57: nur Feldnamen, keine Werte.
          text: `Nacharbeit Zeile ${zeile.zeilennummer}: Felder ${Object.keys(patch).join(", ")}${akteurGeaendert ? " — Akteur wird erneut aufgelöst" : ""}`,
          importLaufId: lauf.id,
        });
        return { ok: true };
      }),
    );
  } catch (e) {
    console.error("Nacharbeit speichern fehlgeschlagen:", e);
    return { fehler: "Die Zeile konnte nicht gespeichert werden." };
  }
}

export async function importZeileUeberspringen(laufId: string, zeileId: string): Promise<ZeileErgebnisAction> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId) || !/^[0-9a-f-]{36}$/.test(zeileId)) return { fehler: "Ungültige ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!NACHARBEIT_ZUSTAENDE.includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}".` };
  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const [zeile] = await tx
          .select({ id: importZeile.id, zeilennummer: importZeile.zeilennummer, status: importZeile.status })
          .from(importZeile)
          .where(and(eq(importZeile.id, zeileId), eq(importZeile.laufId, lauf.id)))
          .limit(1);
        if (!zeile) return { fehler: "Zeile nicht gefunden." };
        if (zeile.status === "importiert") return { fehler: `Zeile ${zeile.zeilennummer} ist schon importiert.` };
        await tx.update(importZeile).set({ status: "uebersprungen" }).where(eq(importZeile.id, zeile.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Nacharbeit Zeile ${zeile.zeilennummer}: übersprungen`,
          importLaufId: lauf.id,
        });
        return { ok: true };
      }),
    );
  } catch (e) {
    console.error("Überspringen fehlgeschlagen:", e);
    return { fehler: "Die Zeile konnte nicht übersprungen werden." };
  }
}
