"use server";

import { biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { ERLAUBTE_UEBERGAENGE, STATUS_LABEL } from "@/lib/status";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { pruefeStromSperre } from "@/lib/rechte/sperre-server";
import { protokolliere } from "@/lib/protokoll";
import type { Zugang } from "@/lib/rechte";
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
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: "strom.status_setzen" | "strom.verwerfen",
  art: StromArt,
  id: string,
  neu: string,
  logText: string,
): Promise<AktionErgebnis> {
  const email = zugang.email;
  if (!(neu in STATUS_LABEL)) return { ok: false, fehler: "Unbekannter Status." };

  try {
    // Transaktion + optimistische Sperre: Update greift nur, wenn der Status
    // noch dem gelesenen Stand entspricht — sonst prueft der E8-Guard gegen
    // einen veralteten Wert; und Statuswechsel ohne Protokoll darf es nicht geben.
    await withDb((db) =>
      db.transaction(async (tx) => {
        // E44: Objektstufe — Sperre lesen (Zeilensperre) und gegen die Matrix pruefen.
        await pruefeStromSperre(tx, zugang, aktion, art, id);
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
        await protokolliere(tx, {
          art: aktion === "strom.verwerfen" ? "verworfen" : "status_gesetzt",
          entitaet: art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id,
          benutzerId: zugang.id,
          benutzerEmail: email,
          text: logText,
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
    wache.zugang,
    "strom.status_setzen",
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
  return wechsleStatus(wache.zugang, "strom.verwerfen", art, id, "verworfen", "Strom verworfen (statt gelöscht)");
}
