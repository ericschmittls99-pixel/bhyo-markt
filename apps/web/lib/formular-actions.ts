"use server";

import { beleg, biomassestrom, outputBedarf, vergabeZeitraum } from "@bhyo/db/schema";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { aktualisiereBeleg, erstelleBeleg, ValidierungsFehler } from "@/lib/beleg-server";
import { heuteBerlin } from "@/lib/datum";
import { withDb } from "@/lib/db";
import { fachlicheFelder } from "@/lib/feldeinstufung";
import { type FeldFehler } from "@/lib/formular-modell";
import type { StromArt } from "@/lib/stroeme-modell";
import { naechsteReserviertSeit, vergabenZuWerten } from "@/lib/verfuegbarkeit";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { protokolliere } from "@/lib/protokoll";
import { pruefeBelegSperre, pruefeStromSperre } from "@/lib/rechte/sperre-server";
import {
  FeldFehlerAusnahme,
  pruefeStromEingabe,
  stromAnlegen,
  stromEingabeAusFormData,
  stromWerte,
  vergabenSpeichern,
} from "@/lib/strom-schreibweg";

export interface SpeichernErgebnis {
  ok?: boolean;
  feldFehler?: FeldFehler;
  fehler?: string;
}

/**
 * E62/D6: Vergleichsform fuer „hat sich das Feld geaendert?" — Zahlen als
 * Zahl (numeric kommt als Text), Datum/Text als Text, JSON stabil, leer als
 * null. Absichtlich grob: lieber einmal zu viel zuruecksetzen als eine
 * fachliche Aenderung uebersehen.
 */
function vergleichsform(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : t;
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** Geaenderte Felder in Spaltenschreibweise (fuer die Feldliste im Ereignis). */
function geaenderteFelder(
  spalten: Record<string, { name: string }>,
  vorher: Record<string, unknown>,
  nachher: Record<string, unknown>,
): string[] {
  return Object.keys(nachher)
    .filter((k) => k in spalten && vergleichsform(vorher[k]) !== vergleichsform(nachher[k]))
    .map((k) => spalten[k]!.name);
}

/**
 * Anlegen (id = null) und Bearbeiten (id gesetzt) fuer beide Arten. Gibt
 * Feld-Fehler fuer die Inline-Anzeige zurueck statt zu redirecten; der Client
 * schliesst das Panel und zeigt den Toast. Kein Status-Feld (E8): Neuanlage
 * ist immer entwurf, Bearbeiten laesst den Status unangetastet.
 *
 * AP2.7 PR a0 (E67): Das Anlegen laeuft ueber den Baustein stromAnlegen
 * (lib/strom-schreibweg) — derselbe Weg, den der Import nutzt. Die Action
 * uebersetzt nur FormData, prueft Rechte am Eingang und zeigt Fehler an.
 */
export async function stromSpeichern(
  art: StromArt,
  id: string | null,
  _prev: SpeichernErgebnis,
  formData: FormData,
): Promise<SpeichernErgebnis> {
  // F8/E30, E42: Rechtepruefung VOR jeder Wirkung, ueber die zentrale Wache —
  // Anlegen und Bearbeiten sind getrennte Aktionen der Matrix.
  const wache = await rechtFuerAction(id == null ? "strom.anlegen" : "strom.bearbeiten");
  if ("fehler" in wache) return { fehler: wache.fehler };
  const email = wache.email;
  const handelnder = { id: wache.zugang.id, email, rolle: wache.zugang.rolle };

  const e = stromEingabeAusFormData(art, formData);
  const { eingaben, vergaben, reserviertBhyo } = e;
  // Serverseitiger Stichtag fuer den Reservierungs-Stempel (Migration 0010) —
  // Kalendertag Europe/Berlin, wie das Basisdatum der Fristen (PR b).
  const heute = heuteBerlin();

  const feldFehler = pruefeStromEingabe(e, { neu: id == null });
  // Erst validieren, dann hochladen — ein Validierungsfehler darf keine
  // R2-Waisen erzeugen (wie bisher).
  if (Object.keys(feldFehler).length > 0) return { feldFehler };

  const begruendung = eingaben.begruendung;
  const entitaetTyp = art === "biomasse" ? "biomassestrom" : "output_bedarf";

  try {
    if (id == null) {
      await stromAnlegen(handelnder, e, heute);
      revalidatePath("/register");
      return { ok: true };
    }

    const { werte, koordinate } = stromWerte(e);

    await withDb((db) =>
      db.transaction(async (tx) => {
        // E44: Objektstufe — Sperre des Stroms (Zeilensperre) gegen die Matrix.
        await pruefeStromSperre(tx, wache.zugang, "strom.bearbeiten", art, id);
        // Bearbeiten: Beleg in place (Entscheidung Eric). Status unangetastet —
        // AUSSER bei einer fachlichen Aenderung an einem geprueften Strom (E62,
        // D6): dann zurueck auf „in Pruefung", in derselben Transaktion.
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const spalten = getTableColumns(tabelle) as Record<string, { name: string }>;
        const [bestand] = await tx.select().from(tabelle).where(eq(tabelle.id, id)).limit(1);
        if (!bestand) throw new ValidierungsFehler("Datensatz nicht gefunden.");
        const vorher = bestand as unknown as Record<string, unknown>;
        // standort_geom ist ein SQL-Ausdruck — Vergleich ueber die Koordinate.
        const [geomVorher] = await tx
          .select({ lng: sql<unknown>`case when ${tabelle.standortGeom} is null then null else ST_X(${tabelle.standortGeom}) end`, lat: sql<unknown>`case when ${tabelle.standortGeom} is null then null else ST_Y(${tabelle.standortGeom}) end` })
          .from(tabelle)
          .where(eq(tabelle.id, id));
        const belegVorher = bestand.belegId
          ? (await tx.select().from(beleg).where(eq(beleg.id, bestand.belegId)).limit(1))[0] ?? null
          : null;
        const vergabenVorher = await tx
          .select({ vergebenVon: vergabeZeitraum.vergebenVon, vergebenBis: vergabeZeitraum.vergebenBis, vergebenAn: vergabeZeitraum.vergebenAn, anBhyo: vergabeZeitraum.anBhyo })
          .from(vergabeZeitraum)
          .where(eq(art === "biomasse" ? vergabeZeitraum.biomassestromId : vergabeZeitraum.outputBedarfId, id));

        // E44, geteilte Belege: nur aendern, wenn kein referenzierender Strom
        // fuer den Handelnden gesperrt ist (alle Referenzen gehalten).
        if (bestand.belegId) await pruefeBelegSperre(tx, wache.zugang, bestand.belegId);
        const belegErgebnis = bestand.belegId
          ? await aktualisiereBeleg(tx, e.beleg!, bestand.belegId)
          : await erstelleBeleg(tx, e.beleg!);

        const neueWerte = {
          ...werte,
          // Stempel-Regel 0010: Editieren verjuengt nicht, Abwaehlen nullt.
          reserviertSeit: naechsteReserviertSeit(
            reserviertBhyo,
            bestand.reserviertSeit,
            heute,
          ),
          belegId: belegErgebnis?.belegId ?? null,
        };
        await tx
          .update(tabelle)
          .set({ ...neueWerte, updatedAt: new Date() } as never)
          .where(eq(tabelle.id, id));
        await vergabenSpeichern(tx, art, id, vergaben);
        // AP2.5 PR a1 (E66/E23): Wechselt der Strom den Akteur, bekommt der ALTE Akteur
        // ein Ereignis — daraus liest der Verwaist-Hinweis, seit wann er ohne Strom ist.
        if (bestand.akteurId !== eingaben.akteurId) {
          await protokolliere(tx, {
            art: "akteur_geaendert",
            entitaet: "akteur",
            id: bestand.akteurId,
            benutzerId: wache.zugang.id,
            benutzerEmail: email,
            text: `Strom ${id} umgehängt`,
          });
        }
        await protokolliere(tx, { art: "geaendert", entitaet: entitaetTyp, id, benutzerId: wache.zugang.id, benutzerEmail: email, text: begruendung });

        // E62 D6: Feldliste der Aenderung — Strom, Koordinate, Beleg, Vergaben.
        const { standortGeom: _g, ...ohneGeom } = neueWerte as Record<string, unknown> & { standortGeom?: unknown };
        const geaendert = geaenderteFelder(spalten, vorher, ohneGeom);
        const geomNachher = koordinate ? { lng: koordinate.lng, lat: koordinate.lat } : { lng: null, lat: null };
        if (vergleichsform(geomVorher?.lng) !== vergleichsform(geomNachher.lng) || vergleichsform(geomVorher?.lat) !== vergleichsform(geomNachher.lat)) {
          geaendert.push("standort_geom");
        }
        if (belegErgebnis?.belegId) {
          const [belegNachher] = await tx.select().from(beleg).where(eq(beleg.id, belegErgebnis.belegId)).limit(1);
          if (!belegVorher) geaendert.push("beleg.typ");
          else if (belegNachher) {
            const bv = belegVorher as unknown as Record<string, unknown>;
            const bn = belegNachher as unknown as Record<string, unknown>;
            const belegSpalten = getTableColumns(beleg) as Record<string, { name: string }>;
            for (const k of ["typ", "dateiKey", "linkUrl", "gueltigBis", "externNachvollziehbar", "erstelltAm"]) {
              if (vergleichsform(bv[k]) !== vergleichsform(bn[k])) geaendert.push(`beleg.${belegSpalten[k]!.name}`);
            }
            const mv = (bv.metadata ?? {}) as Record<string, unknown>;
            const mn = (bn.metadata ?? {}) as Record<string, unknown>;
            for (const k of new Set([...Object.keys(mv), ...Object.keys(mn)])) {
              if (vergleichsform(mv[k]) !== vergleichsform(mn[k])) geaendert.push(`beleg.metadata.${k}`);
            }
          }
        } else if (belegVorher) geaendert.push("beleg.typ");
        const vergabenNachher = vergabenZuWerten(vergaben);
        const vergabeText = (v: { vergebenVon: string | null; vergebenBis: string | null; vergebenAn: string | null; anBhyo: boolean }) =>
          JSON.stringify([v.vergebenVon, v.vergebenBis, v.vergebenAn ?? null, v.anBhyo]);
        if (JSON.stringify([...vergabenVorher.map(vergabeText)].sort()) !== JSON.stringify([...vergabenNachher.map(vergabeText)].sort())) {
          geaendert.push("vergabe_zeitraum.vergeben_von");
        }
        const fachlich = fachlicheFelder(entitaetTyp, geaendert);
        if (bestand.status === "geprueft" && fachlich.length > 0) {
          await tx.update(tabelle).set({ status: "in_pruefung" as never, updatedAt: new Date() } as never).where(eq(tabelle.id, id));
          await protokolliere(tx, {
            art: "zurueckgesetzt",
            entitaet: entitaetTyp,
            id,
            benutzerId: wache.zugang.id,
            benutzerEmail: email,
            text: `Zurückgesetzt in Prüfung: fachliche Änderung an ${fachlich.join(", ")}`,
          });
        }
      }),
    );
  } catch (fehler) {
    if (fehler instanceof FeldFehlerAusnahme) return { feldFehler: fehler.feldFehler };
    if (fehler instanceof ValidierungsFehler) return { fehler: fehler.message };
    console.error("Fehler beim Speichern:", fehler);
    return { fehler: "Speichern fehlgeschlagen. Bitte Eingaben prüfen." };
  }

  revalidatePath("/register");
  return { ok: true };
}
