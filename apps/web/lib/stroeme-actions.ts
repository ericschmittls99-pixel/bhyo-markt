"use server";

import { aenderung, biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { ERLAUBTE_UEBERGAENGE, STATUS_LABEL } from "@/lib/status";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { StromArt } from "@/lib/stroeme-modell";

export interface AktionErgebnis {
  ok: boolean;
  fehler?: string;
}

/**
 * Gemeinsamer Rumpf. Bekommt die BEREITS geprueffte E-Mail uebergeben — die
 * Wache sitzt am Eingang jeder exportierten Aktion, nicht hier drin: Eine
 * Pruefung eine Ebene tiefer sieht man der Signatur nicht an, und
 * scripts/rechte-check.ts sieht sie auch nicht.
 */
async function wechsleStatus(
  email: string,
  art: StromArt,
  id: string,
  neu: string,
  logText: string,
): Promise<AktionErgebnis> {
  if (!(neu in STATUS_LABEL)) return { ok: false, fehler: "Unbekannter Status." };

  try {
    // Transaktion + optimistische Sperre: Update greift nur, wenn der Status
    // noch dem gelesenen Stand entspricht — sonst prueft der E8-Guard gegen
    // einen veralteten Wert; und Statuswechsel ohne Protokoll darf es nicht geben.
    await withDb((db) =>
      db.transaction(async (tx) => {
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [zeile] = await tx
          .select({ status: tabelle.status })
          .from(tabelle)
          .where(eq(tabelle.id, id))
          .limit(1);
        if (!zeile) throw new Error("Datensatz nicht gefunden.");
        if (zeile.status === neu)
          throw new Error(`Der Strom ist bereits „${STATUS_LABEL[neu]}".`);
        // Verwerfen ist aus jedem Status erlaubt (Papierkorb); sonst gilt E8.
        if (
          neu !== "verworfen" &&
          !(ERLAUBTE_UEBERGAENGE[zeile.status] ?? []).includes(neu)
        )
          throw new Error(
            `Wechsel von „${STATUS_LABEL[zeile.status]}" nach „${STATUS_LABEL[neu]}" ist nicht vorgesehen.`,
          );
        const geaendert = await tx
          .update(tabelle)
          .set({ status: neu as never, updatedAt: new Date() })
          .where(and(eq(tabelle.id, id), eq(tabelle.status, zeile.status)))
          .returning({ id: tabelle.id });
        if (!geaendert.length)
          throw new Error("Der Status wurde zwischenzeitlich geändert — bitte neu laden.");
        await tx.insert(aenderung).values({
          entitaetTyp: art === "biomasse" ? "biomassestrom" : "output_bedarf",
          entitaetId: id,
          text: `${email}: ${logText}`,
          benutzerEmail: email,
        });
      }),
    );
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
  const wache = await rechtFuerAction("strom.status_setzen");
  if ("fehler" in wache) return wache;
  return wechsleStatus(
    wache.email,
    art,
    id,
    neu,
    `Status auf ${STATUS_LABEL[neu] ?? neu} gesetzt`,
  );
}

/**
 * Verwerfen-Flow (Entscheidung E2): UI wie der Mockup-Loesch-Flow, die Aktion
 * setzt aber status = verworfen — es wird NIE physisch geloescht (CLAUDE.md).
 */
export async function stromVerwerfen(
  art: StromArt,
  id: string,
): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.verwerfen");
  if ("fehler" in wache) return wache;
  return wechsleStatus(wache.email, art, id, "verworfen", "Strom verworfen (statt gelöscht)");
}
