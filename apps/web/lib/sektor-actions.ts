"use server";

import { sektor } from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { istEindeutigkeitsVerletzung } from "@/lib/db-fehler";
import { protokolliere, type EreignisArt } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { pruefeSektorLabel } from "@/lib/sektor";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.3 PR b (E59): Sektorliste pflegen — anlegen, umbenennen, deaktivieren,
 * reaktivieren. Nur admin (Matrix VERWALTEN), jede Aktion protokolliert mit
 * dem Sektor als Objekt (sektor.id). Geloescht wird nie: Deaktivieren nimmt
 * den Sektor aus der Auswahl, Akteure behalten ihn. Die Wahrheit ueber
 * Dubletten ist der Index lower(btrim(label)) — die Vorpruefung liefert nur
 * die Meldung frueher.
 */
function fehler(e: unknown): AktionErgebnis {
  return { ok: false, fehler: e instanceof Error ? e.message : "Aktion fehlgeschlagen." };
}

const TEXT_DUBLETTE = "Diese Bezeichnung gibt es schon (Schreibweise zählt nicht).";

export async function sektorAnlegen(_prev: AktionErgebnis, formData: FormData): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("sektor.anlegen");
  if ("fehler" in wache) return wache;
  const roh = String(formData.get("label") ?? "");
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const bestehende = await tx.select({ code: sektor.code, label: sektor.label }).from(sektor);
        const pruefung = pruefeSektorLabel(roh, bestehende);
        if (!pruefung.ok) throw new Error(pruefung.text);
        let neu: { id: string } | undefined;
        try {
          [neu] = await tx
            .insert(sektor)
            .values({
              code: pruefung.code,
              label: pruefung.label,
              // Ans Ende der Liste; gleiche Werte sortieren alphabetisch.
              sortierung: sql`coalesce((select max(${sektor.sortierung}) from ${sektor}), 0) + 10`,
            })
            .returning({ id: sektor.id });
        } catch (e) {
          if (istEindeutigkeitsVerletzung(e)) throw new Error(TEXT_DUBLETTE);
          throw e;
        }
        await protokolliere(tx, {
          art: "sektor_angelegt",
          entitaet: "sektor",
          id: neu!.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Sektor „${pruefung.label}“ (${pruefung.code}) angelegt`,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}

export async function sektorUmbenennen(code: string, roh: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("sektor.umbenennen");
  if ("fehler" in wache) return wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const bestehende = await tx.select({ id: sektor.id, code: sektor.code, label: sektor.label }).from(sektor).for("update");
        const alt = bestehende.find((s) => s.code === code);
        if (!alt) throw new Error("Diesen Sektor gibt es nicht.");
        const pruefung = pruefeSektorLabel(roh, bestehende, code);
        if (!pruefung.ok) throw new Error(pruefung.text);
        if (pruefung.label === alt.label) throw new Error("Die Bezeichnung ist unverändert.");
        try {
          await tx.update(sektor).set({ label: pruefung.label }).where(eq(sektor.code, code));
        } catch (e) {
          if (istEindeutigkeitsVerletzung(e)) throw new Error(TEXT_DUBLETTE);
          throw e;
        }
        await protokolliere(tx, {
          art: "sektor_umbenannt",
          entitaet: "sektor",
          id: alt.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `Sektor ${code}: „${alt.label}“ → „${pruefung.label}“`,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}

/** Gemeinsamer Rumpf von deaktivieren/reaktivieren — die Aktion nennt jeder Pfad selbst. */
async function aktivSetzen(
  wache: { zugang: { id: string }; email: string },
  code: string,
  aktiv: boolean,
  art: Extract<EreignisArt, "sektor_deaktiviert" | "sektor_reaktiviert">,
): Promise<void> {
  await withDb((db) =>
    db.transaction(async (tx) => {
      const [alt] = await tx
        .select({ id: sektor.id, label: sektor.label, aktiv: sektor.aktiv })
        .from(sektor)
        .where(eq(sektor.code, code))
        .for("update");
      if (!alt) throw new Error("Diesen Sektor gibt es nicht.");
      if (alt.aktiv === aktiv) throw new Error(aktiv ? "Der Sektor ist schon aktiv." : "Der Sektor ist schon deaktiviert.");
      await tx.update(sektor).set({ aktiv }).where(eq(sektor.code, code));
      await protokolliere(tx, {
        art,
        entitaet: "sektor",
        id: alt.id,
        benutzerId: wache.zugang.id,
        benutzerEmail: wache.email,
        text: `Sektor „${alt.label}“ (${code}) ${aktiv ? "reaktiviert" : "deaktiviert — Akteure behalten ihn"}`,
      });
    }),
  );
}

export async function sektorDeaktivieren(code: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("sektor.deaktivieren");
  if ("fehler" in wache) return wache;
  try {
    await aktivSetzen(wache, code, false, "sektor_deaktiviert");
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}

export async function sektorReaktivieren(code: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("sektor.reaktivieren");
  if ("fehler" in wache) return wache;
  try {
    await aktivSetzen(wache, code, true, "sektor_reaktiviert");
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}
