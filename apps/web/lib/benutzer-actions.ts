"use server";

import { benutzer } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import {
  pruefeAktivWechsel,
  pruefeNeuanlage,
  pruefeRollenwechsel,
  type BenutzerZeile,
} from "@/lib/benutzer-regeln";
import { normalisiereEmail, ROLLEN, type Rolle } from "@/lib/rollen";
import { verwaltungsrechtFuerAction } from "@/lib/wache";

export interface BenutzerErgebnis {
  ok: boolean;
  fehler?: string;
}

/** Aktueller Stand als Grundlage der Regelprüfung — immer frisch gelesen. */
function ladeAlle(db: Parameters<Parameters<typeof withDb>[0]>[0]) {
  return db
    .select({ email: benutzer.email, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
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
  // unsichtbar (Befund aus PR B, gemeldet von wache-abdeckung.ts).
  const abgewiesen = await verwaltungsrechtFuerAction();
  if (abgewiesen) return abgewiesen;

  const email = normalisiereEmail(String(formData.get("email") ?? ""));
  const rolle = String(formData.get("rolle") ?? "");
  if (!istRolle(rolle)) return { ok: false, fehler: "Unbekannte Rolle." };
  const name = String(formData.get("name") ?? "").trim() || null;

  const fehler = await withDb(async (db) => {
    const alle = (await ladeAlle(db)) as BenutzerZeile[];
    const ablehnung = pruefeNeuanlage(alle, email);
    if (ablehnung) return ablehnung.text;
    await db.insert(benutzer).values({ email, rolle, name });
    return null;
  });

  if (fehler) return { ok: false, fehler };
  revalidatePath("/einstellungen");
  return { ok: true };
}

export async function rolleSetzen(email: string, rolle: string): Promise<BenutzerErgebnis> {
  // Verwaltungsrecht am Eingang, sichtbar in der Aktion selbst — ein
  // Aufruf eine Ebene tiefer ist zur Laufzeit wirksam und beim Lesen
  // unsichtbar (Befund aus PR B, gemeldet von wache-abdeckung.ts).
  const abgewiesen = await verwaltungsrechtFuerAction();
  if (abgewiesen) return abgewiesen;
  if (!istRolle(rolle)) return { ok: false, fehler: "Unbekannte Rolle." };
  const ziel = normalisiereEmail(email);

  const fehler = await withDb(async (db) => {
    // Lesen und Schreiben in einer Transaktion: Zwischen Prüfung und Update
    // darf sich der letzte Admin nicht anderswo wegändern lassen.
    return db.transaction(async (tx) => {
      const alle = (await ladeAlle(tx)) as BenutzerZeile[];
      const ablehnung = pruefeRollenwechsel(alle, ziel, rolle);
      if (ablehnung) return ablehnung.text;
      await tx
        .update(benutzer)
        .set({ rolle, geaendertAm: new Date() })
        .where(eq(benutzer.email, ziel));
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
  // unsichtbar (Befund aus PR B, gemeldet von wache-abdeckung.ts).
  const abgewiesen = await verwaltungsrechtFuerAction();
  if (abgewiesen) return abgewiesen;
  const ziel = normalisiereEmail(email);

  const fehler = await withDb(async (db) =>
    db.transaction(async (tx) => {
      const alle = (await ladeAlle(tx)) as BenutzerZeile[];
      const ablehnung = pruefeAktivWechsel(alle, ziel, aktiv);
      if (ablehnung) return ablehnung.text;
      await tx
        .update(benutzer)
        .set({ aktiv, geaendertAm: new Date() })
        .where(eq(benutzer.email, ziel));
      return null;
    }),
  );

  if (fehler) return { ok: false, fehler };
  revalidatePath("/einstellungen");
  return { ok: true };
}
