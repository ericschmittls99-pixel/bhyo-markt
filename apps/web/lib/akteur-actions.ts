"use server";

import { genauigkeitFuerPin } from "@/lib/adresse-pruefung";
import { akteur, akteurInteresse, biomassestrom, kommentar, kontaktperson, outputBedarf } from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { kreisArsDesSitzes } from "@/lib/akteure";
import { OHNE_ORT, pruefeAkteurEingabe } from "@/lib/akteur-eingabe";
import { withDb } from "@/lib/db";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.5 PR a1 (E66): Stammdaten des Akteurs — bearbeiten ab bearbeiter ohne
 * Sperre (E44), loeschen nur admin und nur verwaist. Jeder Pfad protokolliert;
 * im Freitext stehen nur IDs und Feldnamen, keine Namen (E57).
 */
export async function akteurBearbeiten(id: string, fd: FormData): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("akteur.bearbeiten");
  if ("fehler" in wache) return wache;
  const codes = (await ladeSektoren()).filter((s) => s.aktiv).map((s) => s.code);
  const eingabe = pruefeAkteurEingabe(fd, codes);
  if (!eingabe.ok) return { ok: false, fehler: eingabe.fehler };
  const { w, geom } = eingabe;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [alt] = await tx.select().from(akteur).where(eq(akteur.id, id)).limit(1);
        if (!alt) throw new Error("Akteur nicht gefunden.");
        const neu = {
          name: w.name,
          sektor: w.sektor,
          sitzStrasse: w.sitzStrasse || null,
          sitzHausnummer: w.sitzHausnummer || null,
          sitzPlz: w.sitzPlz,
          sitzOrt: w.sitzOrt,
        };
        const felder = (Object.keys(neu) as (keyof typeof neu)[]).filter((k) => (alt as Record<string, unknown>)[k] !== neu[k]);
        await tx
          .update(akteur)
          .set({ ...neu, sitzGeom: sql`ST_SetSRID(ST_MakePoint(${geom.lng}, ${geom.lat}), 4326)`, sitzGenauigkeit: genauigkeitFuerPin(w.genauigkeit), updatedAt: new Date() })
          .where(eq(akteur.id, id));
        const ars = await kreisArsDesSitzes(tx, id);
        if (!ars) throw new Error(OHNE_ORT);
        await protokolliere(tx, {
          art: "akteur_geaendert",
          entitaet: "akteur",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          // E57: nur Feldnamen, keine Werte, keine Namen.
          text: `Felder: ${[...felder, "sitz_geom"].join(", ")}`,
        });
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
  revalidatePath("/akteure");
  revalidatePath(`/akteure/${id}`);
  return { ok: true };
}

/**
 * Loeschen nur verwaist: kein Strom (auch kein verworfener) verweist auf den
 * Akteur — der Server prueft es in der Transaktion, die DB weist per
 * Fremdschluessel jeden verbliebenen Strom ab. akteur_interesse geht mit
 * (Entscheidung Eric 01.10.2026, protokolliert), Inbox-Hinweise per CASCADE.
 */
export async function akteurLoeschen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("akteur.loeschen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [alt] = await tx.select({ id: akteur.id }).from(akteur).where(eq(akteur.id, id)).limit(1);
        if (!alt) throw new Error("Akteur nicht gefunden.");
        const [b] = await tx.select({ n: sql<number>`count(*)::int` }).from(biomassestrom).where(eq(biomassestrom.akteurId, id));
        const [o] = await tx.select({ n: sql<number>`count(*)::int` }).from(outputBedarf).where(eq(outputBedarf.akteurId, id));
        if ((b?.n ?? 0) + (o?.n ?? 0) > 0) throw new Error("Der Akteur ist nicht verwaist — es verweisen noch Ströme auf ihn.");
        const interessen = await tx.delete(akteurInteresse).where(eq(akteurInteresse.akteurId, id)).returning({ id: akteurInteresse.id });
        // PR b (E57): Kontaktpersonen des verwaisten Akteurs gehen mit — je Person ein Ereignis, nur IDs.
        const personen = await tx.delete(kontaktperson).where(eq(kontaktperson.akteurId, id)).returning({ id: kontaktperson.id });
        for (const p of personen) {
          await protokolliere(tx, {
            art: "kontaktperson_geloescht",
            entitaet: "kontaktperson",
            id: p.id,
            benutzerId: wache.zugang.id,
            benutzerEmail: wache.email,
            text: `Akteur ${id} gelöscht`,
          });
        }
        // AP2.6 PR a (E71): Kommentare des verwaisten Akteurs gehen mit (FK ON DELETE CASCADE) —
        // hier ausdruecklich und gezaehlt, damit das Protokoll die Zahl traegt, nie den Text.
        const kommentare = await tx.delete(kommentar).where(eq(kommentar.akteurId, id)).returning({ id: kommentar.id });
        await protokolliere(tx, {
          art: "akteur_geloescht",
          entitaet: "akteur",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Verwaist gelöscht; ${interessen.length} Interesse(n), ${personen.length} Kontaktperson(en), ${kommentare.length} Kommentar(e) mitgelöscht`,
        });
        await tx.delete(akteur).where(eq(akteur.id, id));
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Löschen fehlgeschlagen." };
  }
  revalidatePath("/akteure");
  return { ok: true };
}
