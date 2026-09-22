"use server";

import { biomassestrom, outputBedarf, vergabeZeitraum } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  aktualisiereBeleg,
  erstelleBeleg,
  logAenderung,
  pflicht,
  saisonAusFormData,
  text,
  ValidierungsFehler,
} from "@/lib/beleg-server";
import { currentUserEmail, withDb, type AppDb } from "@/lib/db";
import {
  herkunftOderNull,
  monatZuBis,
  monatZuVon,
  validiereFormular,
  type FeldFehler,
  type FormularEingaben,
} from "@/lib/formular-modell";
import type { StromArt } from "@/lib/stroeme-modell";
import {
  validiereVergaben,
  vergabenZuWerten,
  type VergabeFormZeile,
} from "@/lib/verfuegbarkeit";

export interface SpeichernErgebnis {
  ok?: boolean;
  feldFehler?: FeldFehler;
  fehler?: string;
}

const s = (v: string | null) => v ?? "";

function eingabenAus(formData: FormData): FormularEingaben {
  const datei = formData.get("beleg_datei");
  return {
    akteurId: s(text(formData, "akteur_id")),
    materialartCode: s(text(formData, "materialart_code")),
    produktCode: s(text(formData, "produkt_code")),
    mengeRohFm: s(text(formData, "menge_roh_fm")),
    tsAnteilPct: s(text(formData, "ts_anteil_pct")),
    aschegehaltPct: s(text(formData, "aschegehalt_pct")),
    mengeWert: s(text(formData, "menge_wert")),
    mengeEinheit: s(text(formData, "menge_einheit")),
    preisMin: s(text(formData, "preis_min")),
    preisMittel: s(text(formData, "preis_mittel")),
    preisMax: s(text(formData, "preis_max")),
    preis: s(text(formData, "preis")),
    vonMonat: s(text(formData, "zeitraum_von")),
    bisMonat: s(text(formData, "zeitraum_bis")),
    begruendung: s(text(formData, "begruendung")),
    belegTyp: s(text(formData, "beleg_typ")),
    belegQuellenangabe: s(text(formData, "beleg_quellenangabe")),
    belegErhebungsdatum: s(text(formData, "beleg_erhebungsdatum")),
    // Beim Bearbeiten zaehlt eine bereits hinterlegte Datei weiter als Datei.
    belegHatDatei:
      (datei instanceof File && datei.size > 0) ||
      formData.get("beleg_datei_vorhanden") === "1",
    belegLink: s(text(formData, "beleg_link")),
  };
}

/**
 * Anlegen (id = null) und Bearbeiten (id gesetzt) fuer beide Arten. Gibt
 * Feld-Fehler fuer die Inline-Anzeige zurueck statt zu redirecten; der Client
 * schliesst das Panel und zeigt den Toast. Kein Status-Feld (E8): Neuanlage
 * ist immer entwurf, Bearbeiten laesst den Status unangetastet.
 */
export async function stromSpeichern(
  art: StromArt,
  id: string | null,
  _prev: SpeichernErgebnis,
  formData: FormData,
): Promise<SpeichernErgebnis> {
  const email = await currentUserEmail();
  if (!email) return { fehler: "Nicht authentifiziert." };

  const eingaben = eingabenAus(formData);
  // Vergabezeilen (AP1j): das Panel nummeriert lueckenlos ab 0 und legt je
  // Zeile einen Marker ab — auch Leerzeilen, damit die Fehler-Indizes passen.
  const vergaben: VergabeFormZeile[] = [];
  for (let i = 0; formData.get(`vergabe_${i}_marker`) != null; i++) {
    vergaben.push({
      vonMonat: s(text(formData, `vergabe_${i}_von`)),
      bisMonat: s(text(formData, `vergabe_${i}_bis`)),
      an: s(text(formData, `vergabe_${i}_an`)),
      anBhyo: formData.get(`vergabe_${i}_bhyo`) === "on",
    });
  }
  const reserviertBhyo = formData.get("reserviert_bhyo") === "on";

  const feldFehler = {
    ...validiereFormular(art, eingaben),
    ...validiereVergaben(eingaben.vonMonat, eingaben.bisMonat, vergaben),
  };
  // Erst validieren, dann hochladen — ein Validierungsfehler darf keine
  // R2-Waisen erzeugen (wie bisher).
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  const begruendung = eingaben.begruendung;
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";

  try {
    const gemeinsam = {
      akteurId: eingaben.akteurId,
      bezeichnung: text(formData, "bezeichnung"),
      ort: text(formData, "ort"),
      landkreis: text(formData, "landkreis"),
      kontaktperson: text(formData, "kontaktperson"),
      zeitraumVon: monatZuVon(eingaben.vonMonat),
      zeitraumBis: monatZuBis(eingaben.bisMonat),
      saisonalitaet: saisonAusFormData(formData),
      reserviertBhyo,
    };

    // Vergabezeilen sind Formular-verwaltete Attribute ohne eigenen Status:
    // je Speichern vollstaendig ersetzen — die Nachvollziehbarkeit liegt in
    // der Aenderungshistorie ueber die Begruendungspflicht.
    const vergabenSpeichern = async (
      tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
      stromId: string,
    ) => {
      const elternSpalte =
        art === "biomasse"
          ? vergabeZeitraum.biomassestromId
          : vergabeZeitraum.outputBedarfId;
      await tx.delete(vergabeZeitraum).where(eq(elternSpalte, stromId));
      const werte = vergabenZuWerten(vergaben);
      if (werte.length)
        await tx.insert(vergabeZeitraum).values(
          werte.map((v) => ({
            ...v,
            biomassestromId: art === "biomasse" ? stromId : null,
            outputBedarfId: art === "biomasse" ? null : stromId,
          })),
        );
    };

    const werte =
      art === "biomasse"
        ? {
            ...gemeinsam,
            materialartCode: eingaben.materialartCode,
            mengeRohFm: pflicht(formData, "menge_roh_fm", "Rohmenge"),
            tsAnteilPct: pflicht(formData, "ts_anteil_pct", "TS-Anteil"),
            aschegehaltPct: pflicht(formData, "aschegehalt_pct", "Aschegehalt"),
            preisMin: text(formData, "preis_min"),
            preisMittel: text(formData, "preis_mittel"),
            preisMax: text(formData, "preis_max"),
            preisHerkunft: herkunftOderNull(text(formData, "preis_herkunft")),
          }
        : {
            ...gemeinsam,
            produktCode: eingaben.produktCode,
            mengeWert: pflicht(formData, "menge_wert", "Bedarfsmenge"),
            mengeEinheit: pflicht(formData, "menge_einheit", "Einheit"),
            preis: text(formData, "preis"),
            preisEinheit: text(formData, "preis_einheit"),
            preisHerkunft: herkunftOderNull(text(formData, "preis_herkunft")),
          };

    await withDb((db) =>
      db.transaction(async (tx) => {
        if (id == null) {
          // Anlegen: Beleg zuerst, dann Insert mit abgeleiteter Qualitaet.
          const belegErgebnis = await erstelleBeleg(tx, formData);
          if (art === "biomasse") {
            const [row] = await tx
              .insert(biomassestrom)
              .values({
                ...(werte as typeof werte & { materialartCode: string }),
                belegId: belegErgebnis?.belegId ?? null,
                qualitaet: belegErgebnis?.qualitaet ?? null,
                status: "entwurf",
              } as never)
              .returning({ id: biomassestrom.id });
            await vergabenSpeichern(tx, row!.id);
            await logAenderung(tx, entitaetTyp, row!.id, email, begruendung);
          } else {
            const [row] = await tx
              .insert(outputBedarf)
              .values({
                ...werte,
                belegId: belegErgebnis?.belegId ?? null,
                qualitaet: belegErgebnis?.qualitaet ?? null,
                status: "entwurf",
              } as never)
              .returning({ id: outputBedarf.id });
            await vergabenSpeichern(tx, row!.id);
            await logAenderung(tx, entitaetTyp, row!.id, email, begruendung);
          }
          return;
        }

        // Bearbeiten: Beleg in place (Entscheidung Eric), Status unangetastet.
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [bestand] = await tx
          .select({ belegId: tabelle.belegId })
          .from(tabelle)
          .where(eq(tabelle.id, id))
          .limit(1);
        if (!bestand) throw new ValidierungsFehler("Datensatz nicht gefunden.");

        const belegErgebnis = bestand.belegId
          ? await aktualisiereBeleg(tx, formData, bestand.belegId)
          : await erstelleBeleg(tx, formData);

        await tx
          .update(tabelle)
          .set({
            ...werte,
            belegId: belegErgebnis?.belegId ?? null,
            qualitaet: belegErgebnis?.qualitaet ?? null,
            updatedAt: new Date(),
          } as never)
          .where(eq(tabelle.id, id));
        await vergabenSpeichern(tx, id);
        await logAenderung(tx, entitaetTyp, id, email, begruendung);
      }),
    );
  } catch (e) {
    if (e instanceof ValidierungsFehler) return { fehler: e.message };
    console.error("Fehler beim Speichern:", e);
    return { fehler: "Speichern fehlgeschlagen. Bitte Eingaben prüfen." };
  }

  revalidatePath("/register");
  return { ok: true };
}
