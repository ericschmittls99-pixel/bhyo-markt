"use server";

import { kontaktperson } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { geaenderteFelder, pruefeKontaktpersonEingabe } from "@/lib/kontaktperson-modell";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.5 PR b (E66/E57): Kontaktpersonen — anlegen und bearbeiten ab bearbeiter,
 * loeschen nur pruefer/admin; echtes Loeschen (die Zeile verschwindet, Inbox-
 * Hinweise per CASCADE). Jeder Pfad protokolliert mit Objektbezug Person;
 * im Freitext stehen nur Feldnamen und IDs, nie der Name (E57, protokoll-check).
 * Kein Umhaengen: akteur_id wird nie geaendert (Server) — der Trigger in der
 * DB weist es ebenfalls ab.
 */
function aktualisiere(akteurId: string) {
  revalidatePath(`/akteure/${akteurId}`);
}

export async function kontaktpersonAnlegen(akteurId: string, fd: FormData): Promise<AktionErgebnis & { id?: string }> {
  const wache = await rechtFuerAction("kontaktperson.anlegen");
  if ("fehler" in wache) return wache;
  const eingabe = pruefeKontaktpersonEingabe(fd);
  if (!eingabe.ok) return { ok: false, fehler: eingabe.fehler };
  let id = "";
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [row] = await tx.insert(kontaktperson).values({ akteurId, ...eingabe.w }).returning({ id: kontaktperson.id });
        id = row!.id;
        await protokolliere(tx, {
          art: "kontaktperson_angelegt",
          entitaet: "kontaktperson",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Akteur ${akteurId}`,
        });
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Anlegen fehlgeschlagen." };
  }
  aktualisiere(akteurId);
  return { ok: true, id };
}

export async function kontaktpersonBearbeiten(id: string, fd: FormData): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("kontaktperson.bearbeiten");
  if ("fehler" in wache) return wache;
  const eingabe = pruefeKontaktpersonEingabe(fd);
  if (!eingabe.ok) return { ok: false, fehler: eingabe.fehler };
  let akteurId = "";
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [alt] = await tx.select().from(kontaktperson).where(eq(kontaktperson.id, id)).limit(1);
        if (!alt) throw new Error("Kontaktperson nicht gefunden.");
        akteurId = alt.akteurId;
        const felder = geaenderteFelder(alt, eingabe.w);
        if (felder.length === 0) throw new Error("Keine Änderung.");
        // akteur_id bleibt — kein Umhaengen (E66).
        await tx.update(kontaktperson).set({ ...eingabe.w, updatedAt: new Date() }).where(eq(kontaktperson.id, id));
        await protokolliere(tx, {
          art: "kontaktperson_geaendert",
          entitaet: "kontaktperson",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Felder: ${felder.join(", ")}`,
        });
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
  aktualisiere(akteurId);
  return { ok: true };
}

export async function kontaktpersonLoeschen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("kontaktperson.loeschen");
  if ("fehler" in wache) return wache;
  let akteurId = "";
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [alt] = await tx.select({ akteurId: kontaktperson.akteurId }).from(kontaktperson).where(eq(kontaktperson.id, id)).limit(1);
        if (!alt) throw new Error("Kontaktperson nicht gefunden.");
        akteurId = alt.akteurId;
        await protokolliere(tx, {
          art: "kontaktperson_geloescht",
          entitaet: "kontaktperson",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Akteur ${akteurId}`,
        });
        await tx.delete(kontaktperson).where(eq(kontaktperson.id, id));
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Löschen fehlgeschlagen." };
  }
  aktualisiere(akteurId);
  return { ok: true };
}

/**
 * Auskunft nach Art. 15 DSGVO erstellen (nur Admin, kontaktperson.auskunft):
 * schreibt das Ereignis auskunft_erstellt (nur IDs) und liefert dessen ID —
 * die Druckansicht ist ausschliesslich ueber dieses Ereignis erreichbar
 * (Entscheidung Eric 01.10.2026): ohne Aktion keine Auskunft.
 */
export async function kontaktpersonAuskunftErstellen(id: string): Promise<AktionErgebnis & { ereignisId?: string; akteurId?: string }> {
  const wache = await rechtFuerAction("kontaktperson.auskunft");
  if ("fehler" in wache) return wache;
  let ereignisId = "";
  let akteurId = "";
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [p] = await tx.select({ akteurId: kontaktperson.akteurId }).from(kontaktperson).where(eq(kontaktperson.id, id)).limit(1);
        if (!p) throw new Error("Kontaktperson nicht gefunden.");
        akteurId = p.akteurId;
        const e = await protokolliere(tx, {
          art: "auskunft_erstellt",
          entitaet: "kontaktperson",
          id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Akteur ${akteurId}`,
        });
        ereignisId = e.id;
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Auskunft fehlgeschlagen." };
  }
  return { ok: true, ereignisId, akteurId };
}
