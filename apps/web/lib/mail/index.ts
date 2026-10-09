/**
 * AP2.9 (E74): die EINE Schreibstelle fuer ausgehende Mails. Wer eine Mail
 * will, ruft `sendeMail` in seiner Transaktion auf — der Versand haengt wie
 * die Inbox am Protokoll: jede Mail hinterlaesst ein Ereignis `mail_gesendet`
 * am Empfaenger (benutzer), ohne Betreff und ohne Inhalt (nur Art und
 * Laengen). Der Anbieter ist ein Adapter (heute Graph, lib/mail/graph.ts).
 *
 * Probemodus (Standard): MAIL_MODUS=protokoll loggt und protokolliert, sendet
 * aber nicht — so laeuft das Roundup auf Preview und Production trocken,
 * bis die Entra-App steht. MAIL_MODUS=graph sendet.
 *
 * E73: Logzeilen nennen den Empfaenger nur als Nutzer-ID, nie Adresse, Token oder Secret.
 */
import { protokolliere, type Schreiber } from "@/lib/protokoll";

import { GraphFehler, holeGraphToken, sendeGraphMail, type GraphKonfig, type MailNachricht } from "./graph";

export type MailModus = "protokoll" | "graph";

export interface MailKonfig {
  modus: MailModus;
  /** Absenderpostfach (E74: news@bhyo.de), als Worker-Variable MAIL_ABSENDER. */
  absender: string;
  /** Nur im Modus graph noetig; fehlt etwas, wird nicht gesendet, sondern gemeldet. */
  graph: GraphKonfig | null;
}

/** Fachliche Art der Mail — steht im Protokoll statt des Inhalts. */
export type MailArt = "roundup" | "probe";

export interface MailAuftrag {
  art: MailArt;
  empfaenger: { id: string; email: string };
  betreff: string;
  text: string;
}

export type MailErgebnis =
  | { ok: true; modus: MailModus }
  | { ok: false; ursache: string; wiederholenNach: number | null };

/** Rohe Umgebungswerte → Konfiguration; fehlende Graph-Werte machen den Modus nicht kaputt, sie verhindern nur den Versand. */
export function mailKonfigAus(env: { MAIL_MODUS?: string; MAIL_ABSENDER?: string; M365_TENANT_ID?: string; M365_CLIENT_ID?: string; M365_CLIENT_SECRET?: string }): MailKonfig {
  const modus: MailModus = env.MAIL_MODUS === "graph" ? "graph" : "protokoll";
  const graph = env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET ? { tenantId: env.M365_TENANT_ID, clientId: env.M365_CLIENT_ID, clientSecret: env.M365_CLIENT_SECRET } : null;
  return { modus, absender: env.MAIL_ABSENDER ?? "", graph };
}

/** Text des Ereignisses mail_gesendet — Wirkung und Modus ausdruecklich, nie Betreff oder Inhalt. */
export function ereignisText(auftrag: Pick<MailAuftrag, "art" | "betreff" | "text">, modus: MailModus): string {
  const was = auftrag.art === "roundup" ? "Tages-Mail" : "Mail";
  const wirkung = modus === "graph" ? "gesendet" : "protokolliert (Probemodus, nicht gesendet)";
  return `${was} ${wirkung}, modus=${modus}: ${auftrag.art}, Betreff ${auftrag.betreff.length} Zeichen, Text ${auftrag.text.length} Zeichen`;
}

/** E73: „eric.schmitt@bhyo.de" → „e***@bhyo.de"; unbrauchbare Werte werden ganz maskiert. */
export function maskiereEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/**
 * Sendet (oder probt) eine Mail und protokolliert sie in derselben
 * Transaktion. Fehler beim Versand werden als Ergebnis gemeldet, nicht
 * geworfen — der Aufrufer (Job) entscheidet ueber Wiederholung; ein
 * fehlgeschlagener Versand hinterlaesst KEIN Ereignis.
 */
export async function sendeMail(
  tx: Schreiber,
  auftrag: MailAuftrag,
  konfig: MailKonfig,
  holen: typeof fetch = fetch,
  log: (zeile: string) => void = console.log,
): Promise<MailErgebnis> {
  // Eric 09.10.2026: im Log nur die Nutzer-ID, nie eine Adresse.
  const an = auftrag.empfaenger.id;
  if (konfig.modus === "graph") {
    if (!konfig.graph || !konfig.absender) {
      log(`MAIL graph art=${auftrag.art} an=${an} ergebnis=nicht_konfiguriert`);
      return { ok: false, ursache: "nicht_konfiguriert", wiederholenNach: null };
    }
    try {
      const { token } = await holeGraphToken(konfig.graph, holen);
      const nachricht: MailNachricht = { empfaenger: auftrag.empfaenger.email, betreff: auftrag.betreff, text: auftrag.text };
      await sendeGraphMail(token, konfig.absender, nachricht, holen);
    } catch (e) {
      const ursache = e instanceof GraphFehler ? e.ursache : "sonst";
      const nach = e instanceof GraphFehler ? e.wiederholenNach : null;
      log(`MAIL graph art=${auftrag.art} an=${an} ergebnis=${ursache}${nach == null ? "" : ` wiederholen_nach=${nach}`}`);
      return { ok: false, ursache, wiederholenNach: nach };
    }
  }
  await protokolliere(tx, {
    art: "mail_gesendet",
    entitaet: "benutzer",
    id: auftrag.empfaenger.id,
    benutzerId: auftrag.empfaenger.id,
    benutzerEmail: auftrag.empfaenger.email,
    // Kein Betreff, kein Inhalt — nur Art, Modus und Laengen (E73). Das Protokoll ist
    // unveraenderlich: der Modus steht ausdruecklich im Text (Eric 09.10.2026), damit ein
    // Probemodus-Ereignis nie als echter Versand gelesen wird.
    text: ereignisText(auftrag, konfig.modus),
  });
  log(`MAIL ${konfig.modus} art=${auftrag.art} an=${an} betreff_laenge=${auftrag.betreff.length} text_laenge=${auftrag.text.length} ergebnis=ok`);
  return { ok: true, modus: konfig.modus };
}
