"use server";

import { biomassestrom, outputBedarf, vergabeZeitraum } from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";
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
import { withDb, type AppDb } from "@/lib/db";
import {
  herkunftOderNull,
  monatZuBis,
  monatZuVon,
  koordinateAus,
  validiereFormular,
  type FeldFehler,
  type FormularEingaben,
} from "@/lib/formular-modell";
import type { StromArt } from "@/lib/stroeme-modell";
import {
  naechsteReserviertSeit,
  validiereVergaben,
  vergabenZuWerten,
  type VergabeFormZeile,
} from "@/lib/verfuegbarkeit";
import { schreibrechtFuerAction } from "@/lib/wache";
import { dezimalKanonisch, monatKanonisch } from "@/lib/eingabe-format";

export interface SpeichernErgebnis {
  ok?: boolean;
  feldFehler?: FeldFehler;
  fehler?: string;
}

const s = (v: string | null) => v ?? "";

/** Zahlenfeld: Rohtext in die Speicherform, leer bleibt leer. */
function zahl(formData: FormData, key: string): string {
  return dezimalKanonisch(s(text(formData, key)));
}

const leerZuNull = (v: string): string | null => (v.trim() === "" ? null : v);

function nichtLeer(v: string, label: string): string {
  if (v.trim() === "") throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

function eingabenAus(formData: FormData): FormularEingaben {
  const datei = formData.get("beleg_datei");
  return {
    akteurId: s(text(formData, "akteur_id")),
    materialartCode: s(text(formData, "materialart_code")),
    produktCode: s(text(formData, "produkt_code")),
    // F9: Die Felder kommen als deutscher Text herein (Komma, MM/JJJJ) und
    // werden HIER einmal in die Speicherform gebracht — danach rechnet und
    // schreibt alles mit demselben Wert. Mehrdeutige Zahlen bleiben stehen
    // und werden von validiereFormular abgewiesen, nicht stillschweigend
    // gedeutet.
    mengeRohFm: zahl(formData, "menge_roh_fm"),
    tsAnteilPct: zahl(formData, "ts_anteil_pct"),
    aschegehaltPct: zahl(formData, "aschegehalt_pct"),
    mengeWert: zahl(formData, "menge_wert"),
    mengeEinheit: s(text(formData, "menge_einheit")),
    preisMin: zahl(formData, "preis_min"),
    preisMittel: zahl(formData, "preis_mittel"),
    preisMax: zahl(formData, "preis_max"),
    preis: zahl(formData, "preis"),
    vonMonat: monatKanonisch(s(text(formData, "zeitraum_von"))),
    bisMonat: monatKanonisch(s(text(formData, "zeitraum_bis"))),
    begruendung: s(text(formData, "begruendung")),
    belegTyp: s(text(formData, "beleg_typ")),
    belegQuellenangabe: s(text(formData, "beleg_quellenangabe")),
    belegErhebungsdatum: s(text(formData, "beleg_erhebungsdatum")),
    // Beim Bearbeiten zaehlt eine bereits hinterlegte Datei weiter als Datei.
    lat: s(text(formData, "lat")),
    lng: s(text(formData, "lng")),
    saison: saisonAusFormData(formData),
    belegHatDatei:
      (datei instanceof File && datei.size > 0) ||
      formData.get("beleg_datei_vorhanden") === "1",
    belegLink: s(text(formData, "beleg_link")),
    belegGueltigBis: s(text(formData, "beleg_gueltig_bis")),
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
  // F8/E30: Rechtepruefung VOR jeder Wirkung, ueber die zentrale Wache.
  const wache = await schreibrechtFuerAction();
  if ("fehler" in wache) return { fehler: wache.fehler };
  const email = wache.email;

  const eingaben = eingabenAus(formData);
  // Vergabezeilen (AP1j): das Panel nummeriert lueckenlos ab 0 und legt je
  // Zeile einen Marker ab — auch Leerzeilen, damit die Fehler-Indizes passen.
  const vergaben: VergabeFormZeile[] = [];
  for (let i = 0; formData.get(`vergabe_${i}_marker`) != null; i++) {
    vergaben.push({
      vonMonat: monatKanonisch(s(text(formData, `vergabe_${i}_von`))),
      bisMonat: monatKanonisch(s(text(formData, `vergabe_${i}_bis`))),
      an: s(text(formData, `vergabe_${i}_an`)),
      anBhyo: formData.get(`vergabe_${i}_bhyo`) === "on",
    });
  }
  const reserviertBhyo = formData.get("reserviert_bhyo") === "on";
  // Serverseitiger Stichtag fuer den Reservierungs-Stempel (Migration 0010).
  const heute = new Date().toISOString().slice(0, 10);

  const feldFehler = {
    ...validiereFormular(art, eingaben, { neu: id == null }),
    ...validiereVergaben(eingaben.vonMonat, eingaben.bisMonat, vergaben),
  };
  // Erst validieren, dann hochladen — ein Validierungsfehler darf keine
  // R2-Waisen erzeugen (wie bisher).
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  const begruendung = eingaben.begruendung;
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";

  try {
    // F0a: Pin-Koordinate fuer standort_geom. F0b: Landkreis und Bundesland
    // werden raeumlich abgeleitet (strom_verwaltung) — die App schreibt die
    // stillgelegten manuellen Spalten nirgends mehr; DROP folgt mit 0016.
    const koordinate = koordinateAus(eingaben);
    const gemeinsam = {
      akteurId: eingaben.akteurId,
      bezeichnung: text(formData, "bezeichnung"),
      ort: text(formData, "ort"),
      strasse: text(formData, "strasse"),
      hausnummer: text(formData, "hausnummer"),
      plz: text(formData, "plz"),
      standortGeom: koordinate
        ? sql`ST_SetSRID(ST_MakePoint(${koordinate.lng}, ${koordinate.lat}), 4326)`
        : null,
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
            // Aus `eingaben`, nicht erneut aus formData: sonst kaeme hier
            // der unnormalisierte Text an und "1,5" landete in einer
            // numeric-Spalte.
            mengeRohFm: nichtLeer(eingaben.mengeRohFm, "Rohmenge"),
            tsAnteilPct: nichtLeer(eingaben.tsAnteilPct, "TS-Anteil"),
            aschegehaltPct: nichtLeer(eingaben.aschegehaltPct, "Aschegehalt"),
            preisMin: leerZuNull(eingaben.preisMin),
            preisMittel: leerZuNull(eingaben.preisMittel),
            preisMax: leerZuNull(eingaben.preisMax),
            preisHerkunft: herkunftOderNull(text(formData, "preis_herkunft")),
          }
        : {
            ...gemeinsam,
            produktCode: eingaben.produktCode,
            mengeWert: nichtLeer(eingaben.mengeWert, "Bedarfsmenge"),
            mengeEinheit: pflicht(formData, "menge_einheit", "Einheit"),
            preis: leerZuNull(eingaben.preis),
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
                reserviertSeit: naechsteReserviertSeit(reserviertBhyo, null, heute),
                belegId: belegErgebnis?.belegId ?? null,
                status: "entwurf",
              } as never)
              .returning({ id: biomassestrom.id });
            await vergabenSpeichern(tx, row!.id);
            await logAenderung(tx, entitaetTyp, row!.id, email, begruendung || "Ersterfassung");
          } else {
            const [row] = await tx
              .insert(outputBedarf)
              .values({
                ...werte,
                reserviertSeit: naechsteReserviertSeit(reserviertBhyo, null, heute),
                belegId: belegErgebnis?.belegId ?? null,
                status: "entwurf",
              } as never)
              .returning({ id: outputBedarf.id });
            await vergabenSpeichern(tx, row!.id);
            await logAenderung(tx, entitaetTyp, row!.id, email, begruendung || "Ersterfassung");
          }
          return;
        }

        // Bearbeiten: Beleg in place (Entscheidung Eric), Status unangetastet.
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [bestand] = await tx
          .select({
            belegId: tabelle.belegId,
            reserviertSeit: tabelle.reserviertSeit,
          })
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
            // Stempel-Regel 0010: Editieren verjuengt nicht, Abwaehlen nullt.
            reserviertSeit: naechsteReserviertSeit(
              reserviertBhyo,
              bestand.reserviertSeit,
              heute,
            ),
            belegId: belegErgebnis?.belegId ?? null,
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
