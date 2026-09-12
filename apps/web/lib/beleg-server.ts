import { aenderung, beleg } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { type AppDb, getBelegeBucket, getEnvironment } from "@/lib/db";
import {
  type BelegBewertung,
  type BelegTyp,
  berechneGueltigBis,
  deriveQualitaet,
} from "@/lib/qualitaet";

/**
 * Geteilte Server-Helfer fuer die Erfassungs-Actions (PR 5): FormData-Zugriff,
 * Beleg anlegen/aktualisieren (inkl. R2-Upload), Aenderungsprotokoll. Kein
 * "use server" — diese Funktionen sind keine Actions, sondern deren Bausteine.
 */

export const BELEG_TYPEN: BelegTyp[] = [
  "dokument_link",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
];

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
  externNachvollziehbar: boolean;
  metadata: Record<string, unknown>;
  angebotGueltigBis: string | null;
}

function belegDatenAus(formData: FormData): BelegDaten | null {
  const typ = text(formData, "beleg_typ") as BelegTyp | null;
  if (!typ || !BELEG_TYPEN.includes(typ)) return null;

  const quellenangabe = pflicht(formData, "beleg_quellenangabe", "Quellenangabe");
  const erhebungsdatum = pflicht(formData, "beleg_erhebungsdatum", "Erhebungsdatum");

  // Typ-spezifische Zusatzfelder in beleg.metadata.
  const metadata: Record<string, unknown> = { quellenangabe };
  if (typ === "gespraech") {
    metadata.gespraechsdatum = text(formData, "beleg_gespraechsdatum");
    metadata.gespraechspartner = text(formData, "beleg_gespraechspartner");
    metadata.kernnotiz = text(formData, "beleg_kernnotiz");
  }
  if (typ === "dokument_link") {
    metadata.amtlich = formData.get("beleg_amtlich") === "on";
  }

  return {
    typ,
    quellenangabe,
    erhebungsdatum,
    linkUrl: text(formData, "beleg_link"),
    externNachvollziehbar: formData.get("beleg_extern") === "on",
    metadata,
    angebotGueltigBis: typ === "angebot" ? text(formData, "beleg_gueltig_bis") : null,
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

function bewerte(d: BelegDaten, dateiKey: string | null) {
  const gueltigBis = berechneGueltigBis(d.typ, d.erhebungsdatum, d.angebotGueltigBis);
  const bewertung: BelegBewertung = {
    typ: d.typ,
    externNachvollziehbar: d.externNachvollziehbar,
    erhebungsdatum: d.erhebungsdatum,
    dateiKey,
    linkUrl: d.linkUrl,
    gueltigBis,
    metadata: {
      amtlich: d.metadata.amtlich as boolean | undefined,
      quellenangabe: d.quellenangabe,
      gespraechsdatum: d.metadata.gespraechsdatum as string | undefined,
      gespraechspartner: d.metadata.gespraechspartner as string | undefined,
    },
  };
  return { gueltigBis, qualitaet: deriveQualitaet(bewertung) };
}

export interface BelegErgebnis {
  belegId: string;
  qualitaet: "A" | "B" | "C" | "D";
}

/** Legt die Beleg-Zeile neu an (Anlegen bzw. Strom ohne bisherigen Beleg). */
export async function erstelleBeleg(
  db: AppDb,
  formData: FormData,
): Promise<BelegErgebnis | null> {
  const d = belegDatenAus(formData);
  if (!d) return null;
  const dateiKey = await ladeDateiHoch(formData);
  const { gueltigBis, qualitaet } = bewerte(d, dateiKey);

  const [row] = await db
    .insert(beleg)
    .values({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis,
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .returning({ id: beleg.id });

  return { belegId: row!.id, qualitaet };
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
  const { gueltigBis, qualitaet } = bewerte(d, dateiKey);

  await db
    .update(beleg)
    .set({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis,
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .where(eq(beleg.id, belegId));

  return { belegId, qualitaet };
}

export async function logAenderung(
  db: AppDb,
  entitaetTyp: string,
  entitaetId: string,
  email: string,
  begruendung: string,
) {
  await db.insert(aenderung).values({
    entitaetTyp,
    entitaetId,
    text: `${email}: ${begruendung}`,
  });
}
