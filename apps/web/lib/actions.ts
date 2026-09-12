"use server";

import { biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  erstelleBeleg,
  logAenderung,
  pflicht,
  saisonAusFormData,
  text,
  ValidierungsFehler,
} from "@/lib/beleg-server";
import { currentUserEmail, withDb } from "@/lib/db";

/**
 * Alt-Actions des Vollseiten-Formulars (AP1b). Die Beleg-/Protokoll-Logik
 * lebt seit PR 5 in lib/beleg-server.ts; diese Datei verschwindet mit dem
 * Umbau der neu-Route auf das Formular-Panel (PR 5, Task 8).
 */

export interface FormState {
  error?: string;
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
      saisonalitaet: saisonAusFormData(formData),
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
      saisonalitaet: saisonAusFormData(formData),
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
