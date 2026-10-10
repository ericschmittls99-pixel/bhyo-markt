"use server";

/**
 * AP2.9 Umschalten vorbereiten (Eric 09./10.10.2026): Testversand VOR dem
 * Umschalten auf MAIL_MODUS=graph — eine Mail an die eigene Adresse, ueber
 * dieselbe Schreibstelle wie das Roundup (sendeMail, Ereignis mail_gesendet
 * mit modus im Text). Zwei Regeln, beide serverseitig (fail closed):
 *
 *   1. Nur Admins (Aktion mail.testversand, Matrix).
 *   2. Nur an die EIGENE Adresse, und nur wenn sie die hinterlegte
 *      Testadresse ist (Variable MAIL_TEST_EMPFAENGER, wrangler.jsonc) —
 *      der Testversand geht damit nur an Eric, nie an andere Postfaecher.
 *
 * Im Probemodus wird die Mail protokolliert, nicht gesendet; das Ergebnis
 * nennt den Modus, damit der Knopf sagt, was passiert ist.
 */
import { getBindings, withDb } from "@/lib/db";
import { mailKonfigAus, sendeMail } from "@/lib/mail";
import type { Schreiber } from "@/lib/protokoll";
import { normalisiereEmail } from "@/lib/rechte";
import { rechtFuerAction } from "@/lib/rechte/wache";

export interface TestversandErgebnis {
  ok: boolean;
  /** Bei Erfolg: protokoll (Probemodus, nicht gesendet) oder graph (gesendet). */
  modus?: "protokoll" | "graph";
  fehler?: string;
}

export async function testversandAnMich(): Promise<TestversandErgebnis> {
  const wache = await rechtFuerAction("mail.testversand");
  if ("fehler" in wache) return { ok: false, fehler: wache.fehler };
  const env = await getBindings();
  const test = normalisiereEmail(env.MAIL_TEST_EMPFAENGER ?? "");
  if (!test || normalisiereEmail(wache.email) !== test) {
    return { ok: false, fehler: "Der Testversand geht nur an die hinterlegte Testadresse — und nur von ihr selbst aus." };
  }
  const konfig = mailKonfigAus(env);
  const auftrag = {
    art: "probe" as const,
    empfaenger: { id: wache.zugang.id, email: wache.email },
    betreff: "bhyo: Testversand der Tages-Mail",
    text: [
      "Diese Mail prüft den Versandweg der Tages-Mail (Microsoft 365 Graph, Absender news@bhyo.de).",
      "",
      `Ausgelöst in den Einstellungen, Modus ${konfig.modus}.`,
      "",
      "Wenn sie ankommt, kann MAIL_MODUS in Production auf graph gestellt werden.",
    ].join("\n"),
  };
  const erg = await withDb((db) =>
    // sendeMail protokolliert selbst (Art mail_gesendet) — in dieser Transaktion (protokoll-check liest eine Ebene tief).
    db.transaction(async (tx) => sendeMail(tx as unknown as Schreiber, auftrag, konfig)),
  );
  if (!erg.ok) return { ok: false, fehler: `Versand fehlgeschlagen: ${erg.ursache}` };
  return { ok: true, modus: erg.modus };
}
