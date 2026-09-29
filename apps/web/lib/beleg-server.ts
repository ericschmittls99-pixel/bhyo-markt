import { beleg, inboxEintrag } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { type AppDb, getBelegeBucket, getEnvironment } from "@/lib/db";
import {
  BELEG_TYPEN,
  type BelegTyp,
  brauchtGueltigBis,
  istBelegTyp,
  normalisiereUrl,
} from "@/lib/qualitaet";

/**
 * Geteilte Server-Helfer fuer die Erfassungs-Actions (PR 5): FormData-Zugriff,
 * Beleg anlegen/aktualisieren (inkl. R2-Upload), Aenderungsprotokoll. Kein
 * "use server" — diese Funktionen sind keine Actions, sondern deren Bausteine.
 */

// E34: Reihenfolge und Menge der Typen haben genau einen Ursprung.
export { BELEG_TYPEN };

export class ValidierungsFehler extends Error {}

export function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function pflicht(formData: FormData, key: string, label: string): string {
  const v = text(formData, key);
  if (!v) throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

export function saisonAusFormData(formData: FormData): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = Number(formData.get(`saison_${i}`));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

interface BelegDaten {
  typ: BelegTyp;
  quellenangabe: string;
  erhebungsdatum: string;
  linkUrl: string | null;
  /** E34: Freigabe zur externen Verwendung (F6) — kein Eingang der Stufe. */
  externNachvollziehbar: boolean;
  metadata: Record<string, unknown>;
  /** E33: nur bei den oberen vier Typen; die unteren drei tragen null. */
  gueltigBis: string | null;
}

function belegDatenAus(formData: FormData): BelegDaten | null {
  const typ = text(formData, "beleg_typ");
  if (!istBelegTyp(typ)) return null;

  // Die Quellenangabe ist Pflicht fuer alle sieben Typen — hier als Bitte,
  // in der DB als Zusicherung (CHECK beleg_quellenangabe_check, 0021).
  const quellenangabe = pflicht(formData, "beleg_quellenangabe", "Quellenangabe");
  const erhebungsdatum = pflicht(formData, "beleg_erhebungsdatum", "Erhebungsdatum");
  const linkUrl = normalisiereUrl(text(formData, "beleg_link"));

  // E33: Faelligkeit der oberen vier Typen kommt aus dem Formular (Pflicht
  // in der Oberflaeche; validiereFormular meldet es als Feldfehler, hier die
  // zweite Wache fuer Aufrufer ohne Formularvalidierung). Untere drei: null.
  const gueltigBis = brauchtGueltigBis(typ)
    ? pflicht(formData, "beleg_gueltig_bis", "Gültig bis")
    : null;
  // E34: Formularpflicht Link bei Webrecherche — keine Stufenbedingung.
  if (typ === "webrecherche" && !linkUrl)
    throw new ValidierungsFehler("Link ist bei Webrecherche ein Pflichtfeld.");

  // Typ-spezifische Zusatzfelder in beleg.metadata. Seit E34 nur noch die
  // Quellenangabe und beim Gespraech die Kernnotiz; amtlich, Gespraechsdatum
  // und Gespraechspartner werden nicht mehr geschrieben oder gelesen.
  const metadata: Record<string, unknown> = { quellenangabe };
  if (typ === "gespraech") metadata.kernnotiz = text(formData, "beleg_kernnotiz");

  return {
    typ,
    quellenangabe,
    erhebungsdatum,
    linkUrl,
    externNachvollziehbar: formData.get("beleg_extern") === "on",
    metadata,
    gueltigBis,
  };
}

/**
 * Laedt eine optionale Beleg-Datei nach R2 hoch. Key mit Umgebungs-Praefix,
 * damit sich Preview-Test-Uploads nicht mit Production-Belegen vermischen.
 */
async function ladeDateiHoch(formData: FormData): Promise<string | null> {
  const datei = formData.get("beleg_datei");
  if (!(datei instanceof File) || datei.size === 0) return null;
  const env = await getEnvironment();
  const safeName = datei.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const dateiKey = `belege/${env}/${crypto.randomUUID()}-${safeName}`;
  const bucket = await getBelegeBucket();
  await bucket.put(dateiKey, await datei.arrayBuffer(), {
    httpMetadata: { contentType: datei.type || "application/octet-stream" },
  });
  return dateiKey;
}

// E23: keine Stufe mehr im Ergebnis — die DB leitet sie als
// GENERATED-Spalte auf beleg selbst ab; die App schreibt sie nirgends.
export interface BelegErgebnis {
  belegId: string;
}

/** Legt die Beleg-Zeile neu an (Anlegen bzw. Strom ohne bisherigen Beleg). */
export async function erstelleBeleg(
  db: AppDb,
  formData: FormData,
): Promise<BelegErgebnis | null> {
  const d = belegDatenAus(formData);
  if (!d) return null;
  const dateiKey = await ladeDateiHoch(formData);

  const [row] = await db
    .insert(beleg)
    .values({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis: d.gueltigBis,
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .returning({ id: beleg.id });

  return { belegId: row!.id };
}

/**
 * Aktualisiert die bestehende Beleg-Zeile IN PLACE (Entscheidung Eric,
 * 2026-09-12). Eine neue Datei bekommt einen neuen R2-Key; das alte R2-Objekt
 * bleibt liegen, geloescht wird nichts. Ohne neue Datei bleibt der bestehende
 * dateiKey erhalten.
 */
export async function aktualisiereBeleg(
  db: AppDb,
  formData: FormData,
  belegId: string,
): Promise<BelegErgebnis | null> {
  const d = belegDatenAus(formData);
  if (!d) return null;

  const [alt] = await db
    .select({ dateiKey: beleg.dateiKey })
    .from(beleg)
    .where(eq(beleg.id, belegId))
    .limit(1);
  if (!alt) throw new ValidierungsFehler("Beleg nicht gefunden — bitte neu laden.");

  const neuerKey = await ladeDateiHoch(formData);
  const dateiKey = neuerKey ?? alt.dateiKey;

  await db
    .update(beleg)
    .set({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis: d.gueltigBis,
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .where(eq(beleg.id, belegId));

  return { belegId };
}

/** PROBE: Schreibzugriff auf inbox_eintrag ausserhalb des Moduls — muss inbox-check rot machen. */
export async function probeInboxUpdate(db: AppDb) {
  await db.update(inboxEintrag).set({ gelesenAm: new Date() });
}
