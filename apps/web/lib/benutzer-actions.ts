"use server";

import { benutzer } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import {
  pruefeAktivWechsel,
  pruefeNeuanlage,
  pruefeRollenwechsel,
  TEXT_SCHON_VORHANDEN,
  type BenutzerZeile,
} from "@/lib/benutzer-regeln";
import { istEindeutigkeitsVerletzung } from "@/lib/db-fehler";
import { normalisiereEmail, ROLLEN, type Rolle } from "@/lib/rechte";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { protokolliere } from "@/lib/protokoll";

export interface BenutzerErgebnis {
  ok: boolean;
  fehler?: string;
}

/** Aktueller Stand als Grundlage der Regelprüfung — immer frisch gelesen. */
function ladeAlle(db: Parameters<Parameters<typeof withDb>[0]>[0]) {
  return db
    .select({ id: benutzer.id, email: benutzer.email, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
    .from(benutzer);
}

function istRolle(wert: string): wert is Rolle {
  return (ROLLEN as readonly string[]).includes(wert);
}

export async function benutzerAnlegen(
  _prev: BenutzerErgebnis,
  formData: FormData,
): Promise<BenutzerErgebnis> {
  // Verwaltungsrecht am Eingang, sichtbar in der Aktion selbst — ein
  // Aufruf eine Ebene tiefer ist zur Laufzeit wirksam und beim Lesen
  // unsichtbar (Befund aus PR B, gemeldet von rechte-check.ts).
  const wache = await rechtFuerAction("benutzer.anlegen");
  if ("fehler" in wache) return wache;

  const email = normalisiereEmail(String(formData.get("email") ?? ""));
  const rolle = String(formData.get("rolle") ?? "");
  if (!istRolle(rolle)) return { ok: false, fehler: "Unbekannte Rolle." };
  const name = String(formData.get("name") ?? "").trim() || null;

  const fehler = await withDb((db) =>
    // Anlegen und Ereignis in EINER Transaktion: kein Benutzer ohne Protokoll.
    db.transaction(async (tx) => {
      const alle = (await ladeAlle(tx)) as BenutzerZeile[];
      const ablehnung = pruefeNeuanlage(alle, email);
      if (ablehnung) return ablehnung.text;
      let neu: { id: string } | undefined;
      try {
        [neu] = await tx.insert(benutzer).values({ email, rolle, name }).returning({ id: benutzer.id });
      } catch (e) {
        // Die Vorprüfung oben ist Komfort; die Wahrheit ist der Primärschlüssel.
        // Liest sie einen veralteten Stand (Hyperdrive-Abfrage-Cache, 29.09.2026),
        // antwortet die Datenbank mit 23505 — und der Nutzer bekommt dieselbe
        // klare Meldung statt eines 500ers. Alles andere bleibt ein Fehler.
        if (istEindeutigkeitsVerletzung(e)) return TEXT_SCHON_VORHANDEN;
        throw e;
      }
      await protokolliere(tx, {
        art: "benutzer_angelegt",
        entitaet: "benutzer",
        id: neu!.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: `${email} als ${rolle} angelegt`,
      });
      return null;
    }),
  );

  if (fehler) return { ok: false, fehler };
  revalidatePath("/einstellungen");
  return { ok: true };
}

export async function rolleSetzen(email: string, rolle: string): Promise<BenutzerErgebnis> {
  // Verwaltungsrecht am Eingang, sichtbar in der Aktion selbst — ein
  // Aufruf eine Ebene tiefer ist zur Laufzeit wirksam und beim Lesen
  // unsichtbar (Befund aus PR B, gemeldet von rechte-check.ts).
  const wache = await rechtFuerAction("benutzer.rolle_setzen");
  if ("fehler" in wache) return wache;
  if (!istRolle(rolle)) return { ok: false, fehler: "Unbekannte Rolle." };
  const ziel = normalisiereEmail(email);

  const fehler = await withDb(async (db) => {
    // Lesen und Schreiben in einer Transaktion: Zwischen Prüfung und Update
    // darf sich der letzte Admin nicht anderswo wegändern lassen.
    return db.transaction(async (tx) => {
      const alle = (await ladeAlle(tx)) as (BenutzerZeile & { id: string })[];
      const ablehnung = pruefeRollenwechsel(alle, ziel, rolle);
      if (ablehnung) return ablehnung.text;
      const betroffen = alle.find((b) => b.email === ziel)!;
      await tx
        .update(benutzer)
        .set({ rolle, geaendertAm: new Date() })
        .where(eq(benutzer.email, ziel));
      await protokolliere(tx, {
        art: "rolle_gesetzt",
        entitaet: "benutzer",
        id: betroffen.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: `Rolle von ${ziel} auf ${rolle} gesetzt`,
      });
      return null;
    });
  });

  if (fehler) return { ok: false, fehler };
  revalidatePath("/einstellungen");
  return { ok: true };
}

/** Kein Löschen, nur deaktivieren — wie bei den Referenzdaten (CLAUDE.md). */
export async function aktivSetzen(email: string, aktiv: boolean): Promise<BenutzerErgebnis> {
  // Verwaltungsrecht am Eingang, sichtbar in der Aktion selbst — ein
  // Aufruf eine Ebene tiefer ist zur Laufzeit wirksam und beim Lesen
  // unsichtbar (Befund aus PR B, gemeldet von rechte-check.ts).
  const wache = await rechtFuerAction("benutzer.aktiv_setzen");
  if ("fehler" in wache) return wache;
  const ziel = normalisiereEmail(email);

  const fehler = await withDb(async (db) =>
    db.transaction(async (tx) => {
      const alle = (await ladeAlle(tx)) as (BenutzerZeile & { id: string })[];
      const ablehnung = pruefeAktivWechsel(alle, ziel, aktiv);
      if (ablehnung) return ablehnung.text;
      const betroffen = alle.find((b) => b.email === ziel)!;
      await tx
        .update(benutzer)
        .set({ aktiv, geaendertAm: new Date() })
        .where(eq(benutzer.email, ziel));
      await protokolliere(tx, {
        art: aktiv ? "benutzer_aktiviert" : "benutzer_deaktiviert",
        entitaet: "benutzer",
        id: betroffen.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: `Zugang von ${ziel} ${aktiv ? "aktiviert" : "deaktiviert"}`,
      });
      return null;
    }),
  );

  if (fehler) return { ok: false, fehler };
  revalidatePath("/einstellungen");
  return { ok: true };
}

/**
 * AP2.9 (E76): Roundup-Mail fuer den EIGENEN Zugang an- oder abschalten
 * (Standard an). Jede Rolle darf das — nur fuer sich selbst: geschrieben
 * wird ausschliesslich die Zeile des angemeldeten Nutzers (Objektregel).
 */
export async function roundupSetzen(an: boolean): Promise<BenutzerErgebnis> {
  const wache = await rechtFuerAction("benutzer.roundup_setzen");
  if ("fehler" in wache) return wache;
  await withDb((db) =>
    db.transaction(async (tx) => {
      await tx.update(benutzer).set({ roundup: an, geaendertAm: new Date() }).where(eq(benutzer.id, wache.zugang.id));
      await protokolliere(tx, {
        art: "geaendert",
        entitaet: "benutzer",
        id: wache.zugang.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: `Roundup-Mail ${an ? "eingeschaltet" : "abgeschaltet"}`,
      });
    }),
  );
  revalidatePath("/einstellungen");
  return { ok: true };
}

