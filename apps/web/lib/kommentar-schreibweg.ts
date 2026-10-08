import { benutzer, kommentar, kommentarErwaehnung } from "@bhyo/db/schema";
import { eq, inArray } from "drizzle-orm";

import { erwaehnungenAus, pruefeKommentarText } from "@/lib/kommentar-marker";
import { protokolliere } from "@/lib/protokoll";
import { darf, darfZugewiesenWerden } from "@/lib/rechte";
import type { Handelnder, Tx } from "@/lib/strom-schreibweg";

/**
 * AP2.6 PR a (E71): Der Kommentar-Schreibweg als Baustein — wie strom- und
 * akteur-schreibweg: darf() → Schreiben → protokolliere(tx) (und damit
 * zustellen, dieselbe Transaktion). Rechte, Textregel, Erwaehnungen und
 * Protokoll leben hier genau einmal; die Server-Actions (kommentar-actions.ts)
 * rufen nur. Kein "use server": Baustein, keine Action.
 *
 * Grundsaetze (Eric 07.10.2026): Der Text lebt in `kommentar`, das Protokoll
 * traegt nur das Ereignis mit Bezug-ID und Zaehlern — nie den Text (der
 * protokoll-check prueft die Interpolationen). Erwaehnungen leitet der Server
 * aus den Markern des gespeicherten Textes ab; erwaehnbar sind nur aktive
 * Nutzer ab bearbeiter (dieselbe Regel wie ladeZuweisbare), nie
 * Kontaktpersonen (E57) — ein Marker auf etwas anderes weist den Kommentar
 * ab (fail closed, statt ihn stumm zu verschlucken). Die Sperre eines Stroms
 * zaehlt nicht: ein Kommentar aendert keine Stromdaten (E44).
 */
export type KommentarBezug = { art: "biomasse" | "output" | "akteur"; id: string };

/** Fachlicher Fehler (Recht, Text, Erwaehnung, nicht gefunden) — die Action meldet ihn der Oberflaeche. */
export class KommentarFehlerAusnahme extends Error {}

export const KEIN_RECHT = "Kein Recht für diese Aktion.";
export const NICHT_ERWAEHNBAR = "Erwähnung nicht möglich: Nutzer unbekannt, deaktiviert oder Betrachter.";

const BEZUG_ARTEN: readonly KommentarBezug["art"][] = ["biomasse", "output", "akteur"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function istKommentarBezug(b: unknown): b is KommentarBezug {
  return (
    typeof b === "object" &&
    b !== null &&
    BEZUG_ARTEN.includes((b as KommentarBezug).art) &&
    typeof (b as KommentarBezug).id === "string" &&
    UUID.test((b as KommentarBezug).id)
  );
}

interface BezugSpalten {
  biomassestromId: string | null;
  outputBedarfId: string | null;
  akteurId: string | null;
}

function bezugSpalten(b: KommentarBezug): BezugSpalten {
  return {
    biomassestromId: b.art === "biomasse" ? b.id : null,
    outputBedarfId: b.art === "output" ? b.id : null,
    akteurId: b.art === "akteur" ? b.id : null,
  };
}

/** Bezug aus einer Zeile — genau eine Spalte ist gesetzt (CHECK kommentar_genau_ein_bezug_check). */
export function bezugAus(z: BezugSpalten): KommentarBezug {
  if (z.biomassestromId) return { art: "biomasse", id: z.biomassestromId };
  if (z.outputBedarfId) return { art: "output", id: z.outputBedarfId };
  if (z.akteurId) return { art: "akteur", id: z.akteurId };
  throw new Error("Kommentar ohne Bezug.");
}

const BEZUG_TEXT: Record<KommentarBezug["art"], string> = { biomasse: "Strom", output: "Bedarf", akteur: "Akteur" };

/**
 * Erwaehnte Nutzer gegen die Benutzertabelle pruefen: jeder Marker muss auf
 * einen aktiven Nutzer ab bearbeiter zeigen (darfZugewiesenWerden), sonst
 * wird der Kommentar abgewiesen. Liefert die IDs unveraendert zurueck.
 */
export async function pruefeErwaehnbare(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const zeilen = await tx
    .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
    .from(benutzer)
    .where(inArray(benutzer.id, [...ids]));
  const erwaehnbar = new Set(zeilen.filter((z) => darfZugewiesenWerden(z)).map((z) => z.id));
  if (ids.some((id) => !erwaehnbar.has(id))) throw new KommentarFehlerAusnahme(NICHT_ERWAEHNBAR);
  return [...ids];
}

export interface KommentarNeu {
  id: string;
  bezug: KommentarBezug;
  erwaehnte: string[];
}

export async function kommentarErstellenInTx(tx: Tx, handelnder: Handelnder, bezug: KommentarBezug, roh: unknown): Promise<KommentarNeu> {
  // E42: Rechte VOR jeder Wirkung — auch im Baustein, nicht nur am Eingang der Action.
  if (!darf(handelnder, "kommentar.erstellen")) throw new KommentarFehlerAusnahme(KEIN_RECHT);
  if (!istKommentarBezug(bezug)) throw new KommentarFehlerAusnahme("Ungültiger Bezug.");
  const t = pruefeKommentarText(roh);
  if (!t.ok) throw new KommentarFehlerAusnahme(t.fehler);
  const erwaehnte = await pruefeErwaehnbare(tx, erwaehnungenAus(t.text));

  const [zeile] = await tx
    .insert(kommentar)
    .values({ ...bezugSpalten(bezug), autorId: handelnder.id, text: t.text })
    .returning({ id: kommentar.id });
  const id = zeile!.id;
  if (erwaehnte.length) await tx.insert(kommentarErwaehnung).values(erwaehnte.map((nutzerId) => ({ kommentarId: id, nutzerId })));

  const bezugArt = BEZUG_TEXT[bezug.art];
  const bezugId = bezug.id;
  await protokolliere(tx, {
    art: "kommentar_erstellt",
    entitaet: "kommentar",
    id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: `${bezugArt} ${bezugId}; ${erwaehnte.length} Erwähnung(en)`,
  });
  return { id, bezug, erwaehnte };
}

export interface KommentarZeile extends BezugSpalten {
  id: string;
  autorId: string;
  text: string | null;
  geloeschtAm: Date | null;
}

/**
 * Objektstufe der Wache fuer bearbeiten/loeschen: liest den Kommentar mit
 * Zeilensperre (FOR UPDATE) und prueft die Matrix am Autor. Ein geloeschter
 * Kommentar wird nicht mehr bearbeitet oder erneut geloescht.
 */
export async function pruefeKommentarObjekt(
  tx: Tx,
  handelnder: Handelnder,
  aktion: "kommentar.bearbeiten" | "kommentar.loeschen",
  id: string,
): Promise<KommentarZeile> {
  const [z] = await tx
    .select({
      id: kommentar.id,
      autorId: kommentar.autorId,
      text: kommentar.text,
      geloeschtAm: kommentar.geloeschtAm,
      biomassestromId: kommentar.biomassestromId,
      outputBedarfId: kommentar.outputBedarfId,
      akteurId: kommentar.akteurId,
    })
    .from(kommentar)
    .where(eq(kommentar.id, id))
    .for("update")
    .limit(1);
  if (!z) throw new KommentarFehlerAusnahme("Kommentar nicht gefunden.");
  if (z.geloeschtAm) throw new KommentarFehlerAusnahme("Der Kommentar ist bereits gelöscht.");
  if (!darf(handelnder, aktion, { autorId: z.autorId })) throw new KommentarFehlerAusnahme(KEIN_RECHT);
  return z;
}

export interface KommentarBearbeitet {
  bezug: KommentarBezug;
  /** Beim Bearbeiten neu hinzugekommene Erwaehnungen — nur sie werden zugestellt (PR c); entfernte bleiben. */
  neueErwaehnte: string[];
}

export async function kommentarBearbeitenInTx(tx: Tx, handelnder: Handelnder, id: string, roh: unknown): Promise<KommentarBearbeitet> {
  const alt = await pruefeKommentarObjekt(tx, handelnder, "kommentar.bearbeiten", id);
  const t = pruefeKommentarText(roh);
  if (!t.ok) throw new KommentarFehlerAusnahme(t.fehler);
  const alle = await pruefeErwaehnbare(tx, erwaehnungenAus(t.text));
  const bisher = new Set((await tx.select({ nutzerId: kommentarErwaehnung.nutzerId }).from(kommentarErwaehnung).where(eq(kommentarErwaehnung.kommentarId, id))).map((e) => e.nutzerId));
  const neue = alle.filter((n) => !bisher.has(n));
  if (t.text === alt.text) throw new KommentarFehlerAusnahme("Keine Änderung.");

  await tx.update(kommentar).set({ text: t.text, bearbeitetAm: new Date() }).where(eq(kommentar.id, id));
  // Entfernte Erwaehnungen werden nicht zurueckgenommen (E71 Punkt 13) — nur neue kommen dazu.
  if (neue.length) await tx.insert(kommentarErwaehnung).values(neue.map((nutzerId) => ({ kommentarId: id, nutzerId })));

  const bezug = bezugAus(alt);
  const bezugArt = BEZUG_TEXT[bezug.art];
  const bezugId = bezug.id;
  await protokolliere(tx, {
    art: "kommentar_bearbeitet",
    entitaet: "kommentar",
    id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: `${bezugArt} ${bezugId}; ${neue.length} neue Erwähnung(en)`,
  });
  return { bezug, neueErwaehnte: neue };
}

/**
 * Weiches Loeschen: Text NULL, geloescht_am gesetzt — die Zeile bleibt als
 * „Kommentar geloescht" im Verlauf. Die Erwaehnungszeilen gehen mit (Eric
 * 08.10.2026): sie leiten sich aus dem Text ab, und der ist weg. Inbox-
 * Eintraege zum Kommentar bleiben und zeigen „Kommentar geloescht" (PR c).
 */
export async function kommentarLoeschenInTx(tx: Tx, handelnder: Handelnder, id: string): Promise<{ bezug: KommentarBezug }> {
  const alt = await pruefeKommentarObjekt(tx, handelnder, "kommentar.loeschen", id);
  await tx.update(kommentar).set({ text: null, geloeschtAm: new Date() }).where(eq(kommentar.id, id));
  await tx.delete(kommentarErwaehnung).where(eq(kommentarErwaehnung.kommentarId, id));
  const bezug = bezugAus(alt);
  const bezugArt = BEZUG_TEXT[bezug.art];
  const bezugId = bezug.id;
  await protokolliere(tx, {
    art: "kommentar_geloescht",
    entitaet: "kommentar",
    id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: `${bezugArt} ${bezugId}`,
  });
  return { bezug };
}
