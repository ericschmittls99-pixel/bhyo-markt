"use server";

import { aenderung, biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { currentUserEmail, withDb } from "@/lib/db";
import { ERLAUBTE_UEBERGAENGE, STATUS_LABEL } from "@/lib/status";
import type { StromArt } from "@/lib/stroeme-modell";

export interface AktionErgebnis {
  ok: boolean;
  fehler?: string;
}

async function wechsleStatus(
  art: StromArt,
  id: string,
  neu: string,
  logText: string,
): Promise<AktionErgebnis> {
  const email = await currentUserEmail();
  if (!email) return { ok: false, fehler: "Nicht authentifiziert." };
  if (!(neu in STATUS_LABEL)) return { ok: false, fehler: "Unbekannter Status." };

  try {
    await withDb(async (db) => {
      const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
      const [zeile] = await db
        .select({ status: tabelle.status })
        .from(tabelle)
        .where(eq(tabelle.id, id))
        .limit(1);
      if (!zeile) throw new Error("Datensatz nicht gefunden.");
      // Verwerfen ist aus jedem Status erlaubt (Papierkorb); sonst gilt E8.
      if (
        neu !== "verworfen" &&
        !(ERLAUBTE_UEBERGAENGE[zeile.status] ?? []).includes(neu)
      )
        throw new Error(
          `Wechsel von „${STATUS_LABEL[zeile.status]}" nach „${STATUS_LABEL[neu]}" ist nicht vorgesehen.`,
        );
      await db
        .update(tabelle)
        .set({ status: neu as never, updatedAt: new Date() })
        .where(eq(tabelle.id, id));
      await db.insert(aenderung).values({
        entitaetTyp: art === "biomasse" ? "biomassestrom" : "output_bedarf",
        entitaetId: id,
        text: `${email}: ${logText}`,
      });
    });
  } catch (e) {
    return {
      ok: false,
      fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
    };
  }

  revalidatePath("/register");
  return { ok: true };
}

/** Statuswechsel im Detail-Kopf (E8): nur erlaubte Uebergaenge, mit Protokoll. */
export async function statusSetzen(
  art: StromArt,
  id: string,
  neu: string,
): Promise<AktionErgebnis> {
  return wechsleStatus(art, id, neu, `Status auf ${STATUS_LABEL[neu] ?? neu} gesetzt`);
}

/**
 * Verwerfen-Flow (Entscheidung E2): UI wie der Mockup-Loesch-Flow, die Aktion
 * setzt aber status = verworfen — es wird NIE physisch geloescht (CLAUDE.md).
 */
export async function stromVerwerfen(
  art: StromArt,
  id: string,
): Promise<AktionErgebnis> {
  return wechsleStatus(art, id, "verworfen", "Strom verworfen (statt gelöscht)");
}
