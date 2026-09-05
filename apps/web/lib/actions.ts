"use server";

import {
  aenderung,
  beleg,
  biomassestrom,
  outputBedarf,
} from "@bhyo/db/schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  type AppDb,
  currentUserEmail,
  getBelegeBucket,
  getEnvironment,
  withDb,
} from "@/lib/db";
import {
  type BelegBewertung,
  type BelegTyp,
  berechneGueltigBis,
  deriveQualitaet,
} from "@/lib/qualitaet";

export interface FormState {
  error?: string;
}

const BELEG_TYPEN: BelegTyp[] = [
  "dokument_link",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
];

function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function pflicht(formData: FormData, key: string, label: string): string {
  const v = text(formData, key);
  if (!v) throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

class ValidierungsFehler extends Error {}

function saisonalitaet(formData: FormData): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = Number(formData.get(`saison_${i}`));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

/**
 * Laedt eine optionale Beleg-Datei nach R2 hoch und legt die Beleg-Zeile an.
 * Gibt Beleg-ID und die serverseitig abgeleitete Qualitaet zurueck – oder null,
 * wenn kein Beleg-Typ gewaehlt wurde.
 */
async function erstelleBeleg(
  db: AppDb,
  formData: FormData,
): Promise<{ belegId: string; qualitaet: "A" | "B" | "C" | "D" } | null> {
  const typ = text(formData, "beleg_typ") as BelegTyp | null;
  if (!typ || !BELEG_TYPEN.includes(typ)) return null;

  const quellenangabe = pflicht(formData, "beleg_quellenangabe", "Quellenangabe");
  const erhebungsdatum = pflicht(
    formData,
    "beleg_erhebungsdatum",
    "Erhebungsdatum",
  );
  const linkUrl = text(formData, "beleg_link");
  const externNachvollziehbar = formData.get("beleg_extern") === "on";

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
  const angebotGueltigBis =
    typ === "angebot" ? text(formData, "beleg_gueltig_bis") : null;

  // Datei-Upload nach R2 (optional). Key mit Umgebungs-Praefix, damit sich
  // Preview-Test-Uploads nicht mit Production-Belegen vermischen.
  let dateiKey: string | null = null;
  const datei = formData.get("beleg_datei");
  if (datei instanceof File && datei.size > 0) {
    const env = await getEnvironment();
    const safeName = datei.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    dateiKey = `belege/${env}/${crypto.randomUUID()}-${safeName}`;
    const bucket = await getBelegeBucket();
    await bucket.put(dateiKey, await datei.arrayBuffer(), {
      httpMetadata: { contentType: datei.type || "application/octet-stream" },
    });
  }

  const gueltigBis = berechneGueltigBis(typ, erhebungsdatum, angebotGueltigBis);

  const bewertung: BelegBewertung = {
    typ,
    externNachvollziehbar,
    erhebungsdatum,
    dateiKey,
    linkUrl,
    gueltigBis,
    metadata: {
      amtlich: metadata.amtlich as boolean | undefined,
      quellenangabe,
      gespraechsdatum: metadata.gespraechsdatum as string | undefined,
      gespraechspartner: metadata.gespraechspartner as string | undefined,
    },
  };
  const qualitaet = deriveQualitaet(bewertung);

  const [row] = await db
    .insert(beleg)
    .values({
      typ,
      dateiKey,
      linkUrl,
      externNachvollziehbar,
      metadata,
      gueltigBis,
      erstelltAm: new Date(erhebungsdatum),
    })
    .returning({ id: beleg.id });

  return { belegId: row!.id, qualitaet };
}

async function logAenderung(
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

export async function createBiomasse(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = await currentUserEmail();
  if (!email) return { error: "Nicht authentifiziert." };

  try {
    const akteurId = pflicht(formData, "akteur_id", "Akteur");
    const materialartCode = pflicht(formData, "materialart_code", "Materialart");
    const begruendung = pflicht(formData, "begruendung", "Begründung");

    // Pflichtfelder des Datensatzes zuerst validieren – erst danach den Beleg
    // hochladen/anlegen, damit ein Validierungsfehler keine R2-Waisen erzeugt.
    const werte = {
      akteurId,
      materialartCode,
      bezeichnung: text(formData, "bezeichnung"),
      ort: text(formData, "ort"),
      landkreis: text(formData, "landkreis"),
      kontaktperson: text(formData, "kontaktperson"),
      mengeRohFm: pflicht(formData, "menge_roh_fm", "Rohmenge"),
      tsAnteilPct: pflicht(formData, "ts_anteil_pct", "TS-Anteil"),
      aschegehaltPct: pflicht(formData, "aschegehalt_pct", "Aschegehalt"),
      zeitraumVon: pflicht(formData, "zeitraum_von", "Zeitraum von"),
      zeitraumBis: pflicht(formData, "zeitraum_bis", "Zeitraum bis"),
      saisonalitaet: saisonalitaet(formData),
      preisMin: text(formData, "preis_min"),
      preisMittel: text(formData, "preis_mittel"),
      preisMax: text(formData, "preis_max"),
      preisHerkunft: (text(formData, "preis_herkunft") as never) ?? null,
      status: (text(formData, "status") as never) ?? "entwurf",
    };

    await withDb(async (db) => {
      const belegErgebnis = await erstelleBeleg(db, formData);
      const [row] = await db
        .insert(biomassestrom)
        .values({
          ...werte,
          belegId: belegErgebnis?.belegId ?? null,
          qualitaet: belegErgebnis?.qualitaet ?? null,
        })
        .returning({ id: biomassestrom.id });
      await logAenderung(db, "biomassestrom", row!.id, email, begruendung);
    });
  } catch (e) {
    return { error: fehlertext(e) };
  }

  revalidatePath("/register");
  redirect("/register?tab=biomasse");
}

export async function createOutput(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = await currentUserEmail();
  if (!email) return { error: "Nicht authentifiziert." };

  try {
    const akteurId = pflicht(formData, "akteur_id", "Akteur");
    const begruendung = pflicht(formData, "begruendung", "Begründung");

    const werte = {
      akteurId,
      bezeichnung: text(formData, "bezeichnung"),
      ort: text(formData, "ort"),
      landkreis: text(formData, "landkreis"),
      kontaktperson: text(formData, "kontaktperson"),
      produktCode: pflicht(formData, "produkt_code", "Output-Produkt"),
      mengeWert: pflicht(formData, "menge_wert", "Bedarfsmenge"),
      mengeEinheit: pflicht(formData, "menge_einheit", "Einheit"),
      zeitraumVon: pflicht(formData, "zeitraum_von", "Zeitraum von"),
      zeitraumBis: pflicht(formData, "zeitraum_bis", "Zeitraum bis"),
      saisonalitaet: saisonalitaet(formData),
      status: (text(formData, "status") as never) ?? "entwurf",
    };

    await withDb(async (db) => {
      const belegErgebnis = await erstelleBeleg(db, formData);
      const [row] = await db
        .insert(outputBedarf)
        .values({
          ...werte,
          belegId: belegErgebnis?.belegId ?? null,
          qualitaet: belegErgebnis?.qualitaet ?? null,
        })
        .returning({ id: outputBedarf.id });
      await logAenderung(db, "output_bedarf", row!.id, email, begruendung);
    });
  } catch (e) {
    return { error: fehlertext(e) };
  }

  revalidatePath("/register");
  redirect("/register?tab=output");
}

function fehlertext(e: unknown): string {
  if (e instanceof ValidierungsFehler) return e.message;
  console.error("Fehler beim Anlegen:", e);
  return "Speichern fehlgeschlagen. Bitte Eingaben prüfen.";
}
