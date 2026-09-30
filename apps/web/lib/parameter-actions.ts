"use server";

import { parameterDefinition, parameterWert } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { withDb } from "@/lib/db";
import { istEindeutigkeitsVerletzung } from "@/lib/db-fehler";
import { heuteBerlin, pruefeParameterEingabe } from "@/lib/parameter";
import { protokolliere } from "@/lib/protokoll";
import { rechtFuerAction } from "@/lib/rechte/wache";
import type { AktionErgebnis } from "@/lib/stroeme-actions";

/**
 * AP2.3 (E60): Parameter setzen = neue Verlaufszeile ab einem Datum, nie
 * rueckwirkend; zuruecknehmen = nur eine noch nicht geltende Zeile. Beides
 * nur admin (Matrix), beides protokolliert. CHECK und Trigger in der
 * Datenbank sichern dieselben Regeln.
 */
function fehler(e: unknown): AktionErgebnis {
  return { ok: false, fehler: e instanceof Error ? e.message : "Aktion fehlgeschlagen." };
}

export async function parameterSetzen(
  _prev: AktionErgebnis,
  formData: FormData,
): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("parameter.setzen");
  if ("fehler" in wache) return wache;
  const schluessel = String(formData.get("schluessel") ?? "");
  const wert = Number(String(formData.get("wert") ?? ""));
  const gueltigAb = String(formData.get("gueltig_ab") ?? "").trim();
  const begruendung = String(formData.get("begruendung") ?? "").trim();
  const heute = heuteBerlin();
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [def] = await tx.select().from(parameterDefinition).where(eq(parameterDefinition.schluessel, schluessel)).limit(1);
        const ablehnung = pruefeParameterEingabe(def, { wert, gueltigAb, begruendung }, heute);
        if (ablehnung) throw new Error(ablehnung.text);
        let neu: { id: string } | undefined;
        try {
          [neu] = await tx
            .insert(parameterWert)
            .values({ schluessel, wert, gueltigAb, begruendung, erstelltVon: wache.zugang.id })
            .returning({ id: parameterWert.id });
        } catch (e) {
          // UNIQUE (schluessel, gueltig_ab): pro Tag eine Aenderung je Parameter.
          if (istEindeutigkeitsVerletzung(e)) throw new Error("Für dieses Datum ist bereits eine Änderung eingetragen — erst zurücknehmen.");
          throw e;
        }
        await protokolliere(tx, {
          art: "parameter_gesetzt",
          entitaet: "parameter_wert",
          id: neu!.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `${schluessel} = ${wert} ab ${gueltigAb}: ${begruendung}`,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}

export async function parameterZuruecknehmen(id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("parameter.zuruecknehmen");
  if ("fehler" in wache) return wache;
  const heute = heuteBerlin();
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        const [zeile] = await tx
          .select({ id: parameterWert.id, schluessel: parameterWert.schluessel, wert: parameterWert.wert, gueltigAb: parameterWert.gueltigAb })
          .from(parameterWert)
          .where(eq(parameterWert.id, id))
          .for("update");
        if (!zeile) throw new Error("Diese Änderung gibt es nicht.");
        const ab = String(zeile.gueltigAb);
        // Nur eine geplante (noch nicht geltende) Aenderung laesst sich zuruecknehmen — der Trigger prueft dasselbe.
        if (ab.startsWith("-infinity") || ab <= heute) throw new Error("Diese Änderung gilt bereits und bleibt im Verlauf.");
        await tx.delete(parameterWert).where(eq(parameterWert.id, zeile.id));
        await protokolliere(tx, {
          art: "parameter_zurueckgenommen",
          entitaet: "parameter_wert",
          id: zeile.id,
          benutzerId: wache.zugang.id,
          benutzerEmail: wache.email,
          text: `${zeile.schluessel} = ${zeile.wert} ab ${ab} zurückgenommen`,
        });
      }),
    );
  } catch (e) {
    return fehler(e);
  }
  revalidatePath("/einstellungen");
  return { ok: true };
}
