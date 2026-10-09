"use server";

import { monatAusDatum, zeilenOhneZeitraum } from "@/lib/import-zeitraum";
import { monatZuBis, monatZuVon } from "@/lib/formular-modell";
import { aenderung, akteur, akteurInteresse, beleg, biomassestrom, importLauf, importVorlage, importZeile, inboxEintrag, kontaktperson, outputBedarf, stromZuweisung, vergabeZeitraum } from "@bhyo/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getBelegeBucket, getEnvironment, withDb, type AppDb } from "@/lib/db";
import { sucheAehnlicheMenge } from "@/lib/dubletten";
import { dateiErlaubt, IMPORT_MAX_BYTES, ImportDateiFehler, parseImportDatei, sha256Hex, type ImportTabelle } from "@/lib/import-datei";
import { IMPORT_LAUF_VERWERFBAR, type ImportLaufEingabe, type ImportLaufFehler, istPersonenSchluessel, pruefeImportLaufEingabe } from "@/lib/import-modell";
import { ADRESSEN_JE_STAPEL, adressGruppen, adressText, gruppenFuerGenauePins, istPlzAusOrtBefund, istStandortBefund, ortGruppen, plzAusOrt, sitzAusLokal, sitzPatch, standortBefund, standortGruppen, waehleSitz } from "@/lib/import-adressen";
import { AKTEURE_JE_STAPEL, akteurGruppen, entscheidungAusTreffer, gruppenSchluessel, offeneAkteurGruppen, sektorKonflikte } from "@/lib/import-akteure";
import { PROBELAUF_JE_STAPEL } from "@/lib/import-konstanten";
import { verwirfLauf } from "@/lib/jobs/import-aufraeumen";
import { importBelegKey, importRohKey, ladeImportLauf, ladeImportZeilen } from "@/lib/import-server";
import { formDataAusZeile } from "@/lib/import-zeile-formdata";
import { bereinigteCsv, DOPPEL_VON, FEHLER_PREFIX, feldWert, findeDoppelzeilen, HINWEIS_PREFIX, PERSON, pruefeVorlage, pruefeZuordnung, zeileZuFelder, zielfeld, type Zuordnung, zuordnungsFehler } from "@/lib/import-zuordnung";
import { pruefeAdresse } from "@/lib/adresse-pruefung-server";
import { plzFuerOrtStapel, pruefePlzOrtStapel } from "@/lib/plz-server";
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

/** Blatt und Kopfzeile der Zuordnung (PR e); fehlt die Wahl, erkennt der Parser beides. */
export interface BlattWahl {
  blatt?: string;
  kopfzeile?: number;
  /** E69: Preis-Bezug des Laufs (fm | atro) fuer Zeilen ohne eigene Spalte — nur Feedstock. */
  preisBezug?: "fm" | "atro";
}

export async function importZuordnungSpeichern(laufId: string, zuordnung: Zuordnung, wahl: BlattWahl = {}): Promise<ZuordnungErgebnis> {
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
    tabelle = parseImportDatei(await new Response(roh.body).arrayBuffer(), lauf.dateiname, {
      blatt: wahl.blatt || undefined,
      kopfzeile: wahl.kopfzeile && Number.isInteger(wahl.kopfzeile) && wahl.kopfzeile > 0 ? wahl.kopfzeile : undefined,
    });
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
      // Zeilennummer wie in der Datei (PR e: echte Excel-Zeile, Kopfzeile kann Zeile n sein).
      zeilennummer: tabelle.zeilennummern[i]!,
      felder: r.felder,
      status: r.fehlergrund ? "fehler" : "offen",
      fehlergrund: r.fehlergrund,
    };
  });
  // PR f (Weggabelung 7): exakte Doppelzeilen derselben Datei werden „aehnlich" — Voreinstellung ueberspringen, Entscheidung je Zeile oder gesammelt.
  for (const [i, von] of findeDoppelzeilen(zeilen)) {
    zeilen[i]!.status = "aehnlich";
    zeilen[i]!.felder[DOPPEL_VON] = String(von);
  }
  const personenSpalten = tabelle.spalten.filter((sp) => zuordnung.spalten[sp] === PERSON).length;
  const zaehler: Record<string, number> = {
    ...(lauf.zaehler ?? {}),
    zeilen: zeilen.length,
    offen: zeilen.filter((z) => z.status === "offen").length,
    fehler: zeilen.filter((z) => z.status === "fehler").length,
    doppelzeilen: zeilen.filter((z) => z.status === "aehnlich").length,
    personen_spalten: personenSpalten,
    uebersprungen_oben: tabelle.uebersprungen.oben,
    uebersprungen_leer: tabelle.uebersprungen.leer,
    uebersprungen_summe: tabelle.uebersprungen.summe,
    uebersprungen_fuss: tabelle.uebersprungen.fuss,
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
        await tx
          .update(importLauf)
          .set({ status: "zugeordnet", blatt: tabelle.blatt, kopfzeile: tabelle.kopfzeile, zaehler, ...(wahl.preisBezug === "fm" || wahl.preisBezug === "atro" ? { preisBezugStandard: wahl.preisBezug } : {}), updatedAt: new Date() })
          .where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "status_gesetzt",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Zuordnung gespeichert: Blatt „${tabelle.blatt}", Kopfzeile ${tabelle.kopfzeile}, ${zaehler.zeilen} Zeilen (${zaehler.offen} offen, ${zaehler.fehler} mit Fehler, ${zaehler.doppelzeilen} Doppelzeile(n)), übersprungen ${tabelle.uebersprungen.oben} über der Kopfzeile / ${tabelle.uebersprungen.leer} leer / ${tabelle.uebersprungen.summe} Summe / ${tabelle.uebersprungen.fuss} Fußzeile(n), ${personenSpalten} Personen-Spalte(n) nicht übernommen`,
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
  // Klammern sind Pflicht: in Postgres bindet `-` staerker als `||`, ohne sie
  // wuerde `felder || ('{}'::jsonb - 'k')` den Schluessel nie entfernen
  // (Befund 07.10.2026: „Probelauf ok" blieb nach der Ruecknahme stehen).
  let ausdruck = sql`(${importZeile.felder} || ${JSON.stringify(patch)}::jsonb)`;
  for (const k of entfernen) ausdruck = sql`(${ausdruck} - ${k})`;
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
        // E72 (2.7h): PLZ aus Ort VOR dem Abgleich — die Gruppe ist Name + PLZ,
        // der Matcher sieht die ergaenzte PLZ. Eindeutig -> PLZ und Hinweis an
        // die Zeile; sonst Befund am Feld Sitz-PLZ, Zeile in die Nacharbeit.
        // Alle Orte in EINER Abfrage; nur Zeilen ohne Gruppe und ohne Befund.
        const orte = ortGruppen(zeilen);
        let plzErgaenzt = 0;
        let plzOffen = 0;
        if (orte.length > 0) {
          const kandidaten = await plzFuerOrtStapel(tx, orte.map((g) => g.ort));
          const jeZeile = new Map(zeilen.map((z) => [z.id, z]));
          for (let i = 0; i < orte.length; i++) {
            const e = plzAusOrt(orte[i]!.ort, kandidaten[i]!);
            for (const zeileId of orte[i]!.zeilenIds) {
              const z = jeZeile.get(zeileId)!;
              if ("plz" in e) {
                plzErgaenzt += 1;
                z.felder = { ...z.felder, akteur_sitz_plz: e.plz, [`${HINWEIS_PREFIX}akteur_sitz_plz`]: e.hinweis };
                await tx.update(importZeile).set({ felder: felderPatch({ akteur_sitz_plz: e.plz, [`${HINWEIS_PREFIX}akteur_sitz_plz`]: e.hinweis }) }).where(eq(importZeile.id, zeileId));
              } else {
                plzOffen += 1;
                z.felder = { ...z.felder, [`${FEHLER_PREFIX}akteur_sitz_plz`]: e.befund };
                await tx
                  .update(importZeile)
                  .set({ felder: felderPatch({ [`${FEHLER_PREFIX}akteur_sitz_plz`]: e.befund }), ...zustandNachKorrektur(z.felder, z.status) })
                  .where(eq(importZeile.id, zeileId));
              }
            }
          }
        }
        const alleGruppen = akteurGruppen(zeilen);
        const offene = offeneAkteurGruppen(zeilen);
        const stapel = offene.slice(0, AKTEURE_JE_STAPEL);
        const zaehler: Record<string, number> = { akteure_identisch: 0, akteure_vorschlag: 0, akteure_neu: 0, ...(lauf.zaehler ?? {}), akteure_gruppen: alleGruppen.length };
        if (offene.length === alleGruppen.length) {
          // Erster Stapel: Zaehler neu beginnen.
          zaehler.akteure_identisch = 0;
          zaehler.akteure_vorschlag = 0;
          zaehler.akteure_neu = 0;
          zaehler.plz_aus_ort = 0;
          zaehler.plz_aus_ort_offen = 0;
        }
        zaehler.plz_aus_ort = (zaehler.plz_aus_ort ?? 0) + plzErgaenzt;
        zaehler.plz_aus_ort_offen = (zaehler.plz_aus_ort_offen ?? 0) + plzOffen;
        // EINE Abfrage fuer den ganzen Stapel.
        const treffer = await sucheAehnlicheMenge(tx as unknown as AppDb, stapel.map((g) => ({ schluessel: g.schluessel, name: g.name, plz: g.plz || null })));
        for (const g of stapel) {
          const e = entscheidungAusTreffer(g.schluessel, treffer.get(g.schluessel) ?? []);
          zaehler[`akteure_${e.ergebnis === "vorschlag" ? "vorschlag" : e.ergebnis}`] += 1;
          await tx
            .update(importZeile)
            .set({
              felder: felderPatch(e.patch, ["akteur_id", "akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad", "akteur_neu"].filter((k) => !(k in e.patch))),
              // PR f: eine Doppelzeile (doppel_von) bleibt „aehnlich", bis sie entschieden ist.
              status: sql`case when ${importZeile.status} in ('offen', 'aehnlich') and not (${importZeile.felder} ? ${DOPPEL_VON}) then ${e.statusOffen} else ${importZeile.status} end`,
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
            ? `Akteure aufgelöst: ${alleGruppen.length} Gruppen — ${zaehler.akteure_identisch} identisch, ${zaehler.akteure_vorschlag} Vorschlag, ${zaehler.akteure_neu} neu; ${ohneName} Zeile(n) ohne Akteur-Name${zaehler.plz_aus_ort || zaehler.plz_aus_ort_offen ? `; PLZ aus Ort: ${zaehler.plz_aus_ort} ergänzt, ${zaehler.plz_aus_ort_offen} Zeile(n) in der Nacharbeit` : ""}`
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
              status: sql`case when ${importZeile.status} = 'aehnlich' and not (${importZeile.felder} ? ${DOPPEL_VON}) then 'offen' else ${importZeile.status} end`,
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
 * Sektor-Konflikt entscheiden (PR f, Weggabelung 6, Eric 07.10.2026): tragen
 * die Zeilen eines Akteurs verschiedene Sektoren, gibt es keine stille
 * Uebernahme des ersten Werts — eine Pflichtentscheidung je Akteur, hier.
 * Der gewaehlte Sektor geht in alle Zeilen der Gruppe; ein Sektor-
 * Zuordnungsfehler (B3) an diesen Zeilen ist damit erledigt.
 */
export interface SektorErgebnis {
  ok?: boolean;
  fehler?: string;
  zeilen?: number;
}

/** Zeile nach einer Feld-Korrektur: Fehler-Schluessel entscheiden den Zustand (B3). */
function zustandNachKorrektur(felder: Record<string, string>, status: string): { status: string; fehlergrund: string | null } {
  if (status !== "fehler" && status !== "offen") return { status, fehlergrund: null };
  const grund = zuordnungsFehler(felder);
  return grund ? { status: "fehler", fehlergrund: grund } : { status: "offen", fehlergrund: null };
}

export async function importAkteurSektorWaehlen(laufId: string, gruppe: string, sektor: string): Promise<SektorErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!NACHARBEIT_ZUSTAENDE.includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Sektoren werden nach der Zuordnung entschieden.` };
  const code = sektor.trim();
  if (!(await ladeSektoren()).some((s) => s.aktiv && s.code === code)) return { fehler: `„${code}" ist kein aktiver Sektor.` };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = (await ladeImportZeilen(tx, lauf.id)).filter((z) => gruppenSchluessel(z.felder.akteur_name ?? "", z.felder.akteur_sitz_plz ?? "") === gruppe);
        if (zeilen.length === 0) return { fehler: "Kein Akteur mit diesem Schlüssel im Lauf." };
        for (const z of zeilen) {
          const felder: Record<string, string> = { ...z.felder, akteur_sektor: code };
          delete felder[`${FEHLER_PREFIX}akteur_sektor`];
          const zustand = zustandNachKorrektur(felder, z.status);
          await tx
            .update(importZeile)
            .set({ felder: felderPatch({ akteur_sektor: code }, [`${FEHLER_PREFIX}akteur_sektor`]), ...(zustand.status !== z.status || zustand.fehlergrund !== z.fehlergrund ? zustand : {}) })
            .where(eq(importZeile.id, z.id));
        }
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          // E57: der Gruppen-Schluessel ist ein Betriebsname in Normalform, keine Person.
          text: `Sektor-Konflikt entschieden: Gruppe ${gruppe} → ${code}, ${zeilen.length} Zeile(n)`,
          importLaufId: lauf.id,
        });
        return { ok: true, zeilen: zeilen.length };
      }),
    );
  } catch (e) {
    console.error("Sektor waehlen fehlgeschlagen:", e);
    return { fehler: "Der Sektor konnte nicht gespeichert werden." };
  }
}

/**
 * Doppelzeile entscheiden (PR f, Weggabelung 7): eine exakte Doppelzeile
 * derselben Datei steht „aehnlich" mit doppel_von. Ueberspringen (die
 * Voreinstellung) setzt „uebersprungen" mit Grund; importieren macht sie
 * offen (oder Fehler, wenn sie Zuordnungsfehler traegt) und vermerkt die
 * Entscheidung als Hinweis. zeileId = null entscheidet alle offenen Doppelzeilen.
 */
export async function importDoppelzeileEntscheiden(laufId: string, zeileId: string | null, entscheidung: "ueberspringen" | "importieren"): Promise<SektorErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!NACHARBEIT_ZUSTAENDE.includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Doppelzeilen werden nach der Zuordnung entschieden.` };

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const zeilen = (await ladeImportZeilen(tx, lauf.id)).filter((z) => z.status === "aehnlich" && z.felder[DOPPEL_VON] && (zeileId === null || z.id === zeileId));
        if (zeilen.length === 0) return { fehler: "Keine offene Doppelzeile für diese Auswahl." };
        for (const z of zeilen) {
          const von = z.felder[DOPPEL_VON]!;
          if (entscheidung === "ueberspringen") {
            await tx.update(importZeile).set({ status: "uebersprungen", fehlergrund: `Doppelzeile von Zeile ${von} — übersprungen.` }).where(eq(importZeile.id, z.id));
          } else {
            const hinweis = `Doppelzeile von Zeile ${von}, bewusst importiert.`;
            await tx
              .update(importZeile)
              .set({ ...zustandNachKorrektur(z.felder, "offen"), felder: felderPatch({ [`${HINWEIS_PREFIX}doppelzeile`]: hinweis }, [DOPPEL_VON]) })
              .where(eq(importZeile.id, z.id));
          }
        }
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Doppelzeile(n) ${entscheidung === "ueberspringen" ? "übersprungen" : "bewusst importiert"}: ${zeileId === null ? "alle offenen" : `Zeile ${zeilen[0]!.zeilennummer}`}, ${zeilen.length} Zeile(n)`,
          importLaufId: lauf.id,
        });
        return { ok: true, zeilen: zeilen.length };
      }),
    );
  } catch (e) {
    console.error("Doppelzeile entscheiden fehlgeschlagen:", e);
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

export async function importAdressenAufloesen(laufId: string, erneut = false): Promise<AdressenErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  // PR c: auch nach Probelauf/Ausfuehren (Nacharbeit, Dienst war nicht erreichbar).
  if (!["aufgeloest", "probelauf", "ausgefuehrt"].includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — Adressen werden nach dem Auflösen der Akteure gesucht.` };

  if (erneut) {
    // Befunde ohne Treffer zuruecksetzen — die Adressen zaehlen wieder als offen und werden in diesem Aufruf gesucht.
    await withDb((db) =>
      db.transaction(async (tx) => {
        const mitBefund = (await ladeImportZeilen(tx, lauf.id)).filter((z) => z.felder.akteur_neu === "1" && z.felder.akteur_sitz_offen && !z.felder.akteur_sitz_lat).map((z) => z.id);
        if (mitBefund.length > 0) await tx.update(importZeile).set({ felder: felderPatch({}, ["akteur_sitz_offen"]) }).where(inArray(importZeile.id, mitBefund));
      }),
    );
  }
  // E68 PR 3: lokal, ohne Netz, alle Adressen in EINER Abfrage (5.000 Zeilen in einem Aufruf).
  const zeilen = await withDb((db) => ladeImportZeilen(db, lauf.id));
  const gruppen = adressGruppen(zeilen);
  // Zeile 39 (Eric 08.10.2026): Standort-Spalten (plz/ort) werden ebenfalls geprueft — auch bei vorhandenem Akteur.
  const standorte = standortGruppen(zeilen);
  if (gruppen.length === 0 && standorte.length === 0) return { ok: true, bearbeitet: 0, offen: 0, ohneTreffer: 0 };
  const start = Date.now();
  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        const pruefungen = await pruefePlzOrtStapel(tx, gruppen.map((g) => ({ plz: g.plz, ort: g.ort })));
        const ergebnisse = gruppen.map((g, i) => {
          const e = sitzAusLokal(g, pruefungen[i]!);
          return { gruppe: g, patch: sitzPatch(e), offen: "offen" in e };
        });
        for (const r of ergebnisse) {
          await tx.update(importZeile).set({ felder: felderPatch(r.patch) }).where(inArray(importZeile.id, r.gruppe.zeilenIds));
        }
        let standortBefunde = 0;
        if (standorte.length > 0) {
          const sp = await pruefePlzOrtStapel(tx, standorte.map((g) => ({ plz: g.plz, ort: g.ort })));
          const jeZeile = new Map(zeilen.map((z) => [z.id, z]));
          for (let i = 0; i < standorte.length; i++) {
            const befund = standortBefund(standorte[i]!, sp[i]!);
            if (befund) standortBefunde += standorte[i]!.zeilenIds.length;
            for (const zeileId of standorte[i]!.zeilenIds) {
              const z = jeZeile.get(zeileId)!;
              const alter = z.felder[`${FEHLER_PREFIX}plz`];
              // Ein Formatfehler von feldWert bleibt stehen; nur eigene Befunde werden gesetzt oder geraeumt.
              if (!befund && !istStandortBefund(alter)) continue;
              if (befund && alter === befund) continue;
              const neu = { ...z.felder };
              if (befund) neu[`${FEHLER_PREFIX}plz`] = befund;
              else delete neu[`${FEHLER_PREFIX}plz`];
              await tx
                .update(importZeile)
                .set({ felder: befund ? felderPatch({ [`${FEHLER_PREFIX}plz`]: befund }) : felderPatch({}, [`${FEHLER_PREFIX}plz`]), ...zustandNachKorrektur(neu, z.status) })
                .where(eq(importZeile.id, zeileId));
            }
          }
        }
        const ohneTreffer = ergebnisse.filter((r) => r.offen).length;
        const dauerMs = Date.now() - start;
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        zaehler.adressen_gefunden = (zaehler.adressen_gefunden ?? 0) + (gruppen.length - ohneTreffer);
        zaehler.adressen_offen = (zaehler.adressen_offen ?? 0) + ohneTreffer;
        zaehler.standort_befunde = standortBefunde;
        zaehler.adressen_lokal_ms = dauerMs;
        await tx.update(importLauf).set({ zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Adressen lokal zugeordnet: ${gruppen.length} Adresse(n), ${ohneTreffer} offen (PLZ/Ort), ${dauerMs} ms`,
          importLaufId: lauf.id,
        });
        return { ok: true, bearbeitet: gruppen.length, offen: 0, ohneTreffer };
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
  feldFehler?: { erhebungsdatum?: string; gueltigBis?: string; zeitraumVon?: string; zeitraumBis?: string };
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/;

/** E68 PR 3: Stapel der genauen Suche — eine Anfrage je Sekunde (Nutzungsregel), vier je Aufruf bleiben unter ~10 s. */
const GENAUE_PINS_JE_STAPEL = 4;
const GENAUE_PINS_ABSTAND_MS = 1000;

export interface GenauePinsErgebnis {
  ok?: boolean;
  fehler?: string;
  bearbeitet?: number;
  verbessert?: number;
  offen?: number;
}

/**
 * E68 PR 3, optional: „genaue Pins ermitteln" — fuer Adressen mit Pin im
 * PLZ-Gebiet je eindeutiger Adresse eine Anfrage an den Adressdienst,
 * gedrosselt (1/s), fortsetzbar (Stand in den Zeilen). Ein Treffer hebt die
 * Genauigkeit auf hausnummer/strasse; sonst bleibt der ungefaehre Pin und
 * die Adresse gilt als versucht. Dienstausfall: Fehler genannt, Stand bleibt.
 */
export async function importPinsErmitteln(laufId: string): Promise<GenauePinsErgebnis> {
  const wache = await rechtFuerAction("import.ausfuehren");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!["aufgeloest", "probelauf", "ausgefuehrt"].includes(lauf.status)) return { fehler: `Der Lauf ist „${lauf.status}" — genaue Pins gibt es nach dem Auflösen.` };

  const zeilen = await withDb((db) => ladeImportZeilen(db, lauf.id));
  const gruppen = gruppenFuerGenauePins(zeilen);
  const stapel = gruppen.slice(0, GENAUE_PINS_JE_STAPEL);
  if (stapel.length === 0) return { ok: true, bearbeitet: 0, verbessert: 0, offen: 0 };

  // Erst alle Anfragen des Stapels (gedrosselt), dann eine Transaktion.
  const ergebnisse: { gruppe: (typeof stapel)[number]; patch: Record<string, string>; verbessert: boolean }[] = [];
  for (const [i, g] of stapel.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, GENAUE_PINS_ABSTAND_MS));
    const antwort = await withDb((db) => pruefeAdresse(db, { strasse: g.strasse, hausnummer: g.hausnummer, plz: g.plz, ort: g.ort }));
    const e = antwort.ergebnis;
    if (e.status === "treffer") {
      ergebnisse.push({
        gruppe: g,
        patch: { akteur_sitz_lat: String(e.adresse.lat), akteur_sitz_lng: String(e.adresse.lng), akteur_sitz_quelle: "photon", akteur_sitz_genauigkeit: e.genauigkeit, akteur_sitz_genau_versucht: "1" },
        verbessert: true,
      });
    } else {
      ergebnisse.push({ gruppe: g, patch: { akteur_sitz_genau_versucht: "1" }, verbessert: false });
    }
  }

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        for (const r of ergebnisse) {
          await tx.update(importZeile).set({ felder: felderPatch(r.patch) }).where(inArray(importZeile.id, r.gruppe.zeilenIds));
        }
        const verbessert = ergebnisse.filter((r) => r.verbessert).length;
        const offen = gruppen.length - stapel.length;
        const zaehler: Record<string, number> = { ...(lauf.zaehler ?? {}) };
        zaehler.pins_genau = (zaehler.pins_genau ?? 0) + verbessert;
        await tx.update(importLauf).set({ zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Genaue Pins ermittelt: ${stapel.length} Adresse(n), ${verbessert} verbessert, ${offen} noch offen`,
          importLaufId: lauf.id,
        });
        return { ok: true, bearbeitet: stapel.length, verbessert, offen };
      }),
    );
  } catch (e) {
    console.error("Genaue Pins fehlgeschlagen:", e);
    return { fehler: "Die genauen Pins konnten nicht gespeichert werden." };
  }
}

const MONAT = /^(0[1-9]|1[0-2])\/\d{4}$/;
/** „MM/JJJJ" -> „JJJJ-MM" (Form von monatZuVon/monatZuBis). */
const monatZuIso = (m: string) => `${m.slice(3)}-${m.slice(0, 2)}`;
export async function importBelegDatenSetzen(laufId: string, erhebungsdatum: string, gueltigBis: string, zeitraumVon = "", zeitraumBis = "", zeitraumUnbefristet = false): Promise<BelegDatenErgebnis> {
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
  // PR e: Zeitraum des Laufs — Pflicht, sobald eine Zeile keinen eigenen traegt; keine Vorbelegung (Eric 07.10.2026).
  const zv = zeitraumVon.trim();
  const zb = zeitraumBis.trim();
  const ohne = zeilenOhneZeitraum(await withDb((db) => ladeImportZeilen(db, lauf.id)));
  if (zv && !MONAT.test(zv)) feldFehler.zeitraumVon = "Zeitraum von als MM/JJJJ.";
  if (zb && !MONAT.test(zb)) feldFehler.zeitraumBis = "Zeitraum bis als MM/JJJJ.";
  if (ohne > 0 && !zv) feldFehler.zeitraumVon = `Zeitraum von ist Pflicht: ${ohne} Zeile(n) tragen keinen eigenen Zeitraum.`;
  // E75: statt eines Endes darf der Lauf ausdruecklich „unbefristet" sein — nie beides.
  if (zeitraumUnbefristet && zb) feldFehler.zeitraumBis = `Entweder Zeitraum bis oder „unbefristet", nicht beides.`;
  if (ohne > 0 && !zb && !zeitraumUnbefristet) feldFehler.zeitraumBis = `Zeitraum bis ist Pflicht: ${ohne} Zeile(n) tragen keinen eigenen Zeitraum — Monat eintragen oder „unbefristet" wählen.`;
  if (zv && zb && MONAT.test(zv) && MONAT.test(zb) && monatZuIso(zb) < monatZuIso(zv)) feldFehler.zeitraumBis = "Zeitraum bis liegt vor Zeitraum von.";
  if (!g && istBelegTyp(lauf.belegTyp) && brauchtGueltigBis(lauf.belegTyp)) feldFehler.gueltigBis = "Gültig bis ist bei diesem Belegtyp Pflicht (E33).";
  if (Object.keys(feldFehler).length > 0) return { feldFehler };
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await tx
          .update(importLauf)
          .set({ belegErhebungsdatum: e, belegGueltigBis: g || null, zeitraumVon: zv ? monatZuVon(monatZuIso(zv)) : null, zeitraumBis: zb ? monatZuBis(monatZuIso(zb)) : null, zeitraumUnbefristet, updatedAt: new Date() })
          .where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "geaendert",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Belegdaten des Laufs gesetzt: Erhebungsdatum ${e}${g ? `, gültig bis ${g}` : ""}${zv ? `, Zeitraum ${zv}–${zb}` : ""}`,
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

/** Offene Entscheidungen, die Probelauf und Ausfuehren sperren: Akteur-Vorschlaege, Doppelzeilen (PR f), Sektor-Konflikte (PR f). */
function offeneEntscheidungen(alle: readonly { id: string; status: string; felder: Record<string, string> }[]): string | null {
  const doppel = alle.filter((z) => z.status === "aehnlich" && z.felder[DOPPEL_VON]).length;
  if (doppel > 0) return `${doppel} Doppelzeile(n) warten auf eine Entscheidung — überspringen (Voreinstellung) oder bewusst importieren.`;
  if (alle.some((z) => z.status === "aehnlich")) return "Es gibt noch offene Akteur-Vorschläge — erst übernehmen oder neu anlegen.";
  const konflikte = sektorKonflikte(alle).length;
  if (konflikte > 0) return `Sektor-Konflikt bei ${konflikte} Akteur(en) — erst in „Akteure auflösen" je Akteur entscheiden.`;
  return null;
}

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
  if (!lauf.zeitraumVon || (!lauf.zeitraumBis && !lauf.zeitraumUnbefristet)) {
    const ohne = zeilenOhneZeitraum(await withDb((db) => ladeImportZeilen(db, lauf.id)));
    if (ohne > 0) return { fehler: `Zeitraum des Laufs fehlt: ${ohne} Zeile(n) tragen keinen eigenen Zeitraum — bitte bei den Belegdaten setzen.` };
  }

  const alle = await withDb((db) => ladeImportZeilen(db, lauf.id));
  const sperre = offeneEntscheidungen(alle);
  if (sperre) return { fehler: sperre };
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
                  genauigkeit: f.akteur_sitz_genauigkeit,
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
          // PR f (B3): ein Zuordnungs- oder Lesefehler an einem Feld haelt die Zeile im Fehler — kein Baustein, nie „ok".
          const zf = zuordnungsFehler(z.felder);
          if (zf) {
            ergebnisse.set(z.id, zf);
            continue;
          }
          try {
            const belegId = await belegFuer(z.felder);
            const akteurId = await akteurFuer(z.felder);
            await tx.transaction(async (sp) => {
              const e = stromEingabeAusFormData(art, formDataAusZeile(z.felder, akteurId, lauf));
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
  const sperre = offeneEntscheidungen(alle);
  if (sperre) return { fehler: sperre };
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
                // Worker-Treiber: kein Date-Parameter in rohem SQL — erstelleBeleg schreibt 00:00Z des Erhebungsdatums.
                sql`${beleg.erstelltAm} = ${`${erhebungsdatum}T00:00:00Z`}::timestamptz`,
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
                  genauigkeit: f.akteur_sitz_genauigkeit,
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
          // PR f (B3): wie im Probelauf — eine Zeile mit Zuordnungsfehler wird nie angelegt.
          const zf = zuordnungsFehler(z.felder);
          if (zf) {
            fehlerZeilen += 1;
            await tx.update(importZeile).set({ status: "fehler", fehlergrund: zf }).where(eq(importZeile.id, z.id));
            continue;
          }
          try {
            const belegId = await belegFuer(z.felder);
            const akteurId = await akteurFuer(z.felder);
            const stromId = await tx.transaction(async (sp) => {
              const e = stromEingabeAusFormData(art, formDataAusZeile(z.felder, akteurId, lauf));
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

const AKTEUR_AUFLOESUNG = ["akteur_id", "akteur_neu", "akteur_gruppe", "akteur_vorschlag_id", "akteur_vorschlag_name", "akteur_vorschlag_grad", "akteur_sitz_lat", "akteur_sitz_lng", "akteur_sitz_quelle", "akteur_sitz_genauigkeit", "akteur_sitz_genau_versucht", "akteur_sitz_offen"] as const;
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
  const hinweisePatch: Record<string, string> = {};
  for (const [k, v] of Object.entries(eingabe)) {
    if (istPersonenSchluessel(k)) return { fehler: `Feld „${k}": Personen-Daten werden nicht übernommen.` };
    const def = zielfeld(k);
    if (!def || !def.arten.includes(art) || def.typ === "einheit") return { fehler: `Feld „${k}" ist kein Zielfeld dieses Laufs.` };
    const roh = typeof v === "string" ? v.trim() : "";
    // PR f: dieselben Regeln wie die Zuordnung (deutsche Zahl, Rundung E20, Monat, Datum, keine Kontaktdaten) — abgewiesen statt gespeichert.
    const e = def.typ === "code" ? { wert: roh } : feldWert(def, roh);
    if ("fehler" in e) return { fehler: `${def.label}: ${e.fehler}` };
    patch[k] = e.wert;
    if (e.hinweis) hinweisePatch[`${HINWEIS_PREFIX}${k}`] = e.hinweis;
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
        // E72: aendert sich der Ort einer Zeile ohne PLZ, wird „PLZ aus Ort" mit dem Abgleich neu angestossen.
        const plzLeer = !("akteur_sitz_plz" in patch ? patch.akteur_sitz_plz : (alt.akteur_sitz_plz ?? "")).trim();
        const ortGeaendert = "akteur_sitz_ort" in patch && patch.akteur_sitz_ort !== (alt.akteur_sitz_ort ?? "");
        const akteurGeaendert =
          ("akteur_name" in patch && patch.akteur_name !== (alt.akteur_name ?? "")) || ("akteur_sitz_plz" in patch && patch.akteur_sitz_plz !== (alt.akteur_sitz_plz ?? "")) || (ortGeaendert && plzLeer);
        // PR f (B3): Fehler und Hinweise der korrigierten Felder fallen weg; bleiben andere Fehler, bleibt die Zeile im Fehler.
        const entfernen: string[] = [
          ...Object.keys(patch).filter((k) => patch[k] === ""),
          ...Object.keys(patch).flatMap((k) => [`${FEHLER_PREFIX}${k}`, `${HINWEIS_PREFIX}${k}`]),
          "probelauf",
          ...(akteurGeaendert ? AKTEUR_AUFLOESUNG : []),
          // E72: nur der eigene Befund „Ort … nicht eindeutig/bekannt" raeumt sich mit dem Ort; ein Formatfehler bleibt.
          ...(ortGeaendert && plzLeer && istPlzAusOrtBefund(alt[`${FEHLER_PREFIX}akteur_sitz_plz`]) ? [`${FEHLER_PREFIX}akteur_sitz_plz`, `${HINWEIS_PREFIX}akteur_sitz_plz`] : []),
        ];
        const setzen = { ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== "")), ...hinweisePatch };
        const neu: Record<string, string> = { ...alt };
        for (const k of entfernen) delete neu[k];
        Object.assign(neu, setzen);
        // Zeile 39 (Eric 08.10.2026): ein korrigierter Standort (plz/ort) wird sofort lokal geprueft —
        // ein Befund bleibt als Zeilenfehler am Feld Standort · PLZ, die Zeile geht nicht durch.
        if (("plz" in patch || "ort" in patch) && neu.plz && !neu[`${FEHLER_PREFIX}plz`]) {
          const [e] = await pruefePlzOrtStapel(tx, [{ plz: neu.plz, ort: neu.ort ?? "" }]);
          const befund = standortBefund({ plz: neu.plz, ort: neu.ort ?? "" }, e!);
          if (befund) {
            setzen[`${FEHLER_PREFIX}plz`] = befund;
            neu[`${FEHLER_PREFIX}plz`] = befund;
          }
        }
        await tx
          .update(importZeile)
          .set({ felder: felderPatch(setzen, entfernen), ...zustandNachKorrektur(neu, "offen") })
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

/**
 * Lauf verwerfen (PR g, Eric 07.10.2026): ein Lauf, der nie ausgefuehrt wurde
 * (angelegt … probelauf, fehler), wird beendet — Zeilen geloescht (es gibt
 * keine Stroeme, nur Zwischendaten), Status „verworfen", Zeitpunkt,
 * Ereignis. Ersteller, Pruefer und Admin (import.verwerfen); der taegliche
 * Job macht dasselbe nach import.lauf_inaktiv_tage ohne Aktivitaet
 * (lib/jobs/import-aufraeumen.ts, dieselbe Regel verwirfLauf). Roh-Upload und
 * bereinigte Kopie in R2 gehen mit (best effort, der Job raeumt den Rest).
 */
export interface VerwerfenErgebnis {
  ok?: boolean;
  fehler?: string;
  zeilen?: number;
}

export async function importLaufVerwerfen(laufId: string): Promise<VerwerfenErgebnis> {
  const wache = await rechtFuerAction("import.verwerfen");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (!(IMPORT_LAUF_VERWERFBAR as readonly string[]).includes(lauf.status)) {
    return { fehler: `Der Lauf ist „${lauf.status}" — verworfen wird nur ein Lauf, der nie ausgeführt wurde.` };
  }
  try {
    const erg = await withDb((db) =>
      db.transaction(async (tx) =>
        verwirfLauf(tx, lauf.id, { benutzerId: wache.zugang.id, benutzerEmail: wache.email, text: "von Hand verworfen" }),
      ),
    );
    const env = await getEnvironment();
    const bucket = await getBelegeBucket();
    for (const key of [importRohKey(env, lauf.id, lauf.dateiname), importBelegKey(env, lauf.id)]) {
      await bucket.delete(key).catch((e) => console.error("Verwerfen: R2-Objekt nicht gelöscht:", key, e));
    }
    return { ok: true, zeilen: erg.zeilen };
  } catch (e) {
    console.error("Import-Lauf verwerfen fehlgeschlagen:", e);
    return { fehler: "Der Lauf konnte nicht verworfen werden." };
  }
}

/**
 * Ruecknahme eines ganzen Laufs (PR d, E67): nur Admin, nur solange kein
 * Strom des Laufs danach geaendert, geprueft oder weitergegeben wurde —
 * jedes Ereignis an einem dieser Stroeme ohne die Lauf-ID ist eine
 * Bearbeitung und weist die Ruecknahme ab (rot gezeigt). Entfernt werden
 * die im Lauf angelegten Stroeme (mit Vergaben, Zuweisungen, Inbox-
 * Eintraegen dazu), die Lauf-Belege und die vom Lauf neu angelegten, dadurch
 * verwaisten Akteure (mit Interessen und Kontaktpersonen). Alles in EINER
 * Transaktion, alles protokolliert (verworfen je Strom, akteur_geloescht je
 * Akteur, status_gesetzt am Lauf) — das Protokoll ueberdauert die Objekte.
 * Die Zeilen des Laufs behalten ihre Daten, verlieren den Strom-Bezug und
 * werden „offen"; der Lauf wird „zurueckgenommen" und ist damit beendet.
 */
export interface RuecknahmeErgebnis {
  ok?: boolean;
  fehler?: string;
  /** Zeilennummern der Stroeme, die nach dem Import bearbeitet wurden. */
  bearbeitet?: number[];
  stroeme?: number;
  belege?: number;
  akteure?: number;
}

export async function importZuruecknehmen(laufId: string): Promise<RuecknahmeErgebnis> {
  const wache = await rechtFuerAction("import.zuruecknehmen");
  if ("fehler" in wache) return { fehler: wache.fehler };
  if (!/^[0-9a-f-]{36}$/.test(laufId)) return { fehler: "Ungültige Lauf-ID." };
  const lauf = await withDb((db) => ladeImportLauf(db, laufId));
  if (!lauf) return { fehler: "Lauf nicht gefunden." };
  if (lauf.status !== "ausgefuehrt") return { fehler: `Der Lauf ist „${lauf.status}" — zurückgenommen wird nur ein ausgeführter Lauf.` };
  const art = lauf.art as StromArt;
  const stromTabelle = art === "biomasse" ? biomassestrom : outputBedarf;
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";
  const quellenangabe = `${lauf.dateiname} · Import-Lauf ${lauf.id}`;

  try {
    return await withDb((db) =>
      db.transaction(async (tx) => {
        // Die Stroeme des Laufs: ueber die Zeilen (Strom-ID) — und ueber das Protokoll, falls die Zeilen schon aufgeraeumt sind.
        const zeilen = await ladeImportZeilen(tx, lauf.id);
        const ausZeilen = zeilen.map((z) => (art === "biomasse" ? z.biomassestromId : z.outputBedarfId)).filter((id): id is string => !!id);
        const ausProtokoll = (
          await tx
            .select({ id: aenderung.entitaetId })
            .from(aenderung)
            .where(and(eq(aenderung.importLaufId, lauf.id), eq(aenderung.art, "angelegt"), eq(aenderung.entitaetTyp, entitaetTyp)))
        ).map((r) => r.id);
        const stromIds = [...new Set([...ausZeilen, ...ausProtokoll])];
        if (stromIds.length === 0) return { fehler: "Zu diesem Lauf gibt es keine angelegten Ströme mehr." };

        // Vorbedingung: kein Ereignis an diesen Stroemen ausserhalb des Laufs (Bearbeitung, Pruefung, Weitergabe …).
        const fremd = await tx
          .select({ id: aenderung.entitaetId, art: aenderung.art })
          .from(aenderung)
          .where(and(eq(aenderung.entitaetTyp, entitaetTyp), inArray(aenderung.entitaetId, stromIds), sql`${aenderung.importLaufId} is distinct from ${lauf.id}`));
        if (fremd.length > 0) {
          const betroffen = new Set(fremd.map((f) => f.id));
          const nummern = zeilen.filter((z) => betroffen.has((art === "biomasse" ? z.biomassestromId : z.outputBedarfId) ?? "")).map((z) => z.zeilennummer);
          return {
            fehler: `Rücknahme abgewiesen: ${betroffen.size} Strom/Ströme wurden nach dem Import bearbeitet (${[...new Set(fremd.map((f) => f.art))].join(", ")}). Zeilen: ${nummern.join(", ") || "siehe Protokoll"}.`,
            bearbeitet: nummern,
          };
        }

        // Belege und Akteure der Stroeme merken, bevor die Stroeme fallen.
        const stroeme = await tx
          .select({ id: stromTabelle.id, belegId: stromTabelle.belegId, akteurId: stromTabelle.akteurId })
          .from(stromTabelle)
          .where(inArray(stromTabelle.id, stromIds));
        const belegIds = [...new Set(stroeme.map((s) => s.belegId).filter((b): b is string => !!b))];

        // Abhaengige Zeilen der Stroeme: Zuweisungen, Vergaben, Inbox-Eintraege; die Import-Zeilen verlieren nur den Bezug.
        await tx.delete(stromZuweisung).where(inArray(art === "biomasse" ? stromZuweisung.biomassestromId : stromZuweisung.outputBedarfId, stromIds));
        await tx.delete(vergabeZeitraum).where(inArray(art === "biomasse" ? vergabeZeitraum.biomassestromId : vergabeZeitraum.outputBedarfId, stromIds));
        await tx.delete(inboxEintrag).where(inArray(art === "biomasse" ? inboxEintrag.biomassestromId : inboxEintrag.outputBedarfId, stromIds));
        await tx
          .update(importZeile)
          .set({ ...(art === "biomasse" ? { biomassestromId: null } : { outputBedarfId: null }), status: "offen", felder: felderPatch({}, ["probelauf"]) })
          .where(and(eq(importZeile.laufId, lauf.id), inArray(art === "biomasse" ? importZeile.biomassestromId : importZeile.outputBedarfId, stromIds)));
        for (const s of stroeme) {
          await protokolliere(tx, {
            art: "verworfen",
            entitaet: entitaetTyp,
            id: s.id,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Import zurückgenommen — Strom gelöscht (Lauf ${lauf.id})`,
            importLaufId: lauf.id,
          });
        }
        await tx.delete(stromTabelle).where(inArray(stromTabelle.id, stromIds));

        // Lauf-Belege: nur die des Laufs (Quellenangabe), und nur wenn kein anderer Strom sie noch nutzt.
        let belege = 0;
        for (const belegId of belegIds) {
          const [b] = await tx
            .select({ id: beleg.id, nutzer: sql<number>`(select count(*)::int from biomassestrom where beleg_id = ${belegId}) + (select count(*)::int from output_bedarf where beleg_id = ${belegId})` })
            .from(beleg)
            .where(and(eq(beleg.id, belegId), sql`${beleg.metadata} ->> 'quellenangabe' = ${quellenangabe}`))
            .limit(1);
          if (!b || Number(b.nutzer) > 0) continue;
          await tx.delete(beleg).where(eq(beleg.id, belegId));
          belege += 1;
        }

        // Vom Lauf neu angelegte Akteure, jetzt verwaist: Interessen und Kontaktpersonen gehen mit (wie akteurLoeschen).
        const neueAkteure = (
          await tx
            .select({ id: aenderung.entitaetId })
            .from(aenderung)
            .where(and(eq(aenderung.importLaufId, lauf.id), eq(aenderung.art, "akteur_angelegt"), eq(aenderung.entitaetTyp, "akteur")))
        ).map((r) => r.id);
        let akteure = 0;
        for (const akteurId of neueAkteure) {
          const [a] = await tx
            .select({ id: akteur.id, stroeme: sql<number>`(select count(*)::int from biomassestrom where akteur_id = ${akteurId}) + (select count(*)::int from output_bedarf where akteur_id = ${akteurId})` })
            .from(akteur)
            .where(eq(akteur.id, akteurId))
            .limit(1);
          if (!a || Number(a.stroeme) > 0) continue;
          const interessen = await tx.delete(akteurInteresse).where(eq(akteurInteresse.akteurId, akteurId)).returning({ id: akteurInteresse.id });
          const personen = await tx.delete(kontaktperson).where(eq(kontaktperson.akteurId, akteurId)).returning({ id: kontaktperson.id });
          for (const p of personen) {
            await protokolliere(tx, { art: "kontaktperson_geloescht", entitaet: "kontaktperson", id: p.id, benutzerId: wache.zugang.id, benutzerEmail: wache.email, text: `Akteur ${akteurId} gelöscht (Import zurückgenommen)`, importLaufId: lauf.id });
          }
          await protokolliere(tx, {
            art: "akteur_geloescht",
            entitaet: "akteur",
            id: akteurId,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Import zurückgenommen — im Lauf angelegt, jetzt verwaist; ${interessen.length} Interesse(n), ${personen.length} Kontaktperson(en) mitgelöscht (Lauf ${lauf.id})`,
            importLaufId: lauf.id,
          });
          await tx.delete(akteur).where(eq(akteur.id, akteurId));
          akteure += 1;
        }

        // Zaehler: die Zeilen sind wieder offen, nichts mehr importiert; die Ruecknahme bleibt als eigene Zahl stehen.
        const zaehler: Record<string, number> = {
          ...(lauf.zaehler ?? {}),
          importiert: 0,
          offen: stroeme.length,
          zurueckgenommen_stroeme: stroeme.length,
          zurueckgenommen_belege: belege,
          zurueckgenommen_akteure: akteure,
        };
        await tx.update(importLauf).set({ status: "zurueckgenommen", zurueckgenommenAm: new Date(), zaehler, updatedAt: new Date() }).where(eq(importLauf.id, lauf.id));
        await protokolliere(tx, {
          art: "status_gesetzt",
          entitaet: "import_lauf",
          id: lauf.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Import zurückgenommen: ${stroeme.length} Ströme, ${belege} Beleg(e), ${akteure} Akteur(e) gelöscht`,
          importLaufId: lauf.id,
        });
        return { ok: true, stroeme: stroeme.length, belege, akteure };
      }),
    );
  } catch (e) {
    console.error("Import zurücknehmen fehlgeschlagen:", e);
    const grund = e instanceof Error ? e.message : String(e);
    return { fehler: `Die Rücknahme ist technisch abgebrochen — nichts wurde gelöscht. Grund: ${grund.slice(0, 300)}` };
  }
}
