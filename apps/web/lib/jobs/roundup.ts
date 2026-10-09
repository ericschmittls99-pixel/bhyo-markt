/**
 * AP2.9 (E76, Eric 09.10.2026): das taegliche Inbox-Roundup je Nutzer.
 *
 * Mo–Fr um 07:07 Berlin (Cron 05:07/06:07 UTC, wrangler.jsonc); der Montag
 * deckt Fr–So ab, weil gezaehlt wird, was seit dem letzten ERFOLGREICHEN
 * Roundup neu dazukam (benutzer.roundup_zuletzt_am, nur bei Erfolg gesetzt).
 * Versand nur „bei Neuem": mindestens ein neuer offener Eintrag seit dem
 * letzten Roundup. Die Mail nennt nur Zaehler je Typ und einen Link auf
 * /inbox; die Fusszeile verlinkt die Einstellung zum Abmelden
 * (benutzer.roundup, Standard an). Keine Inhalte, keine Namen Dritter.
 *
 * Log je Nutzer (E73, Eric): nur die Nutzer-ID, „wuerde senden: ja/nein" und
 * die Zaehler — nie Adressen, nie Texte. Im Probemodus (MAIL_MODUS=protokoll)
 * laeuft alles bis auf den Versand; das Protokoll-Ereignis entsteht trotzdem.
 *
 * Graph-Fehler brechen den Lauf nicht ab: je Nutzer ein Ergebnis, Drosselung
 * wird einmal nach Retry-After (gedeckelt) wiederholt. Der Admin-Hinweis bei
 * Stoerung kommt mit dem Umschalt-Schritt (eigener Inbox-Typ).
 *
 * Datenbankzugriff steckt in `roundupZugriff`; der Ablauf selbst nimmt die
 * Schnittstelle herein und laesst sich ohne Datenbank testen.
 */
import { and, eq, sql } from "drizzle-orm";

import { benutzer, inboxEintrag, jobLauf } from "@bhyo/db/schema";

import { ZEITZONE, kalendertag } from "@/lib/datum";
import type { AppDb } from "@/lib/db";
import { sendeMail, type MailErgebnis, type MailKonfig } from "@/lib/mail";
import type { Schreiber } from "@/lib/protokoll";

export const JOB_ROUNDUP = "roundup";
/** Stunde in Berliner Zeit (E76: 07:07, Minute im Cron). */
export const ROUNDUP_STUNDE_BERLIN = 7;
/** Deckel fuer das einmalige Warten bei Drosselung (Sekunden). */
export const DROSSEL_WARTEN_MAX_S = 20;

/** Anzeigetexte je Inbox-Typ in der Mail — Reihenfolge = Reihenfolge in der Mail. */
export const ROUNDUP_LABEL: readonly (readonly [string, string])[] = [
  ["aufgabe", "Aufgaben an dich"],
  ["pruefauftrag", "Prüfaufträge"],
  ["pruefung_erledigt", "Erledigte Prüfungen"],
  ["erwaehnung", "Erwähnungen in Kommentaren"],
  ["kommentar", "Neue Kommentare"],
  ["aenderung_eintrag", "Änderungen an deinen Einträgen"],
  ["verifikation_laeuft_ab", "Verifikationen, die ablaufen"],
  ["verifikation_abgelaufen", "Abgelaufene Verifikationen"],
  ["biomasse_wird_frei", "Biomasse, die frei wird"],
  ["akteur_verwaist", "Verwaiste Akteure"],
  ["kontaktperson_loeschpruefung", "Löschprüfungen Kontaktpersonen"],
  ["zugriffsanfrage", "Zugriffsanfragen"],
  ["freischaltung", "Freischaltungen"],
  ["zugriff_abgelehnt", "Abgelehnte Zugriffe"],
  ["import_abgeschlossen", "Abgeschlossene Importe"],
];

const WOCHENTAG = new Intl.DateTimeFormat("en-US", { timeZone: ZEITZONE, weekday: "short" });

/** Mo–Fr in Europe/Berlin? */
export function istWerktagBerlin(zeitpunkt: Date): boolean {
  const w = WOCHENTAG.formatToParts(zeitpunkt).find((p) => p.type === "weekday")!.value;
  return w !== "Sat" && w !== "Sun";
}

export interface TypZaehler {
  typ: string;
  offen: number;
  neu: number;
}

export interface Empfaenger {
  id: string;
  email: string;
  /** Letzter erfolgreicher Roundup; null = noch nie (dann zaehlt alles Offene als neu). */
  seit: Date | null;
}

/** Nur bei Neuem (E76): mindestens ein offener Eintrag, der seit dem letzten Roundup entstand. */
export function wuerdeSenden(zaehler: readonly TypZaehler[]): boolean {
  return zaehler.some((z) => z.neu > 0);
}

/** Betreff und Text der Mail — reiner Text, nur Zaehler, ein Link, Fusszeile zur Abmeldung. */
export function roundupText(zaehler: readonly TypZaehler[], basisUrl: string): { betreff: string; text: string } {
  const neu = zaehler.reduce((s, z) => s + z.neu, 0);
  const offen = zaehler.reduce((s, z) => s + z.offen, 0);
  const label = new Map(ROUNDUP_LABEL);
  const reihenfolge = ROUNDUP_LABEL.map(([t]) => t);
  const zeilen = [...zaehler]
    .filter((z) => z.offen > 0)
    .sort((a, b) => {
      const ia = reihenfolge.indexOf(a.typ);
      const ib = reihenfolge.indexOf(b.typ);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map((z) => `- ${label.get(z.typ) ?? z.typ}: ${z.offen} offen${z.neu > 0 ? `, davon ${z.neu} neu` : ""}`);
  const betreff = `bhyo: ${neu} neue${neu === 1 ? "r Hinweis" : " Hinweise"} in deiner Inbox`;
  const text = [
    `Seit deinem letzten Roundup ${neu === 1 ? "ist 1 neuer Hinweis" : `sind ${neu} neue Hinweise`} dazugekommen, insgesamt ${offen} offen.`,
    "",
    ...zeilen,
    "",
    `Zur Inbox: ${basisUrl}/inbox`,
    "",
    `Du bekommst diese Mail an Werktagen, wenn etwas Neues da ist. Abmelden: ${basisUrl}/einstellungen#roundup`,
  ].join("\n");
  return { betreff, text };
}

export interface RoundupZugriff {
  /** Lauf-Zeile anlegen; null, wenn es fuer den Stichtag schon einen Lauf gibt (Idempotenz). */
  beginneLauf(stichtag: string, jetzt: Date): Promise<string | null>;
  beendeLauf(laufId: string, ergebnis: { ergebnis: "ok" | "fehler"; anzahl: number; schritte: Record<string, number>; fehler?: string }): Promise<void>;
  /** Aktive Nutzer mit Roundup an. */
  ladeEmpfaenger(): Promise<Empfaenger[]>;
  zaehle(nutzerId: string, seit: Date | null): Promise<TypZaehler[]>;
  /** Versand und Markierung in EINER Transaktion: markiert nur, wenn der Versand ok war. */
  sendeUndMarkiere(nutzerId: string, jetzt: Date, senden: (tx: Schreiber) => Promise<MailErgebnis>): Promise<MailErgebnis>;
}

export function roundupZugriff(db: AppDb): RoundupZugriff {
  return {
    async beginneLauf(stichtag, jetzt) {
      const r = await db.insert(jobLauf).values({ job: JOB_ROUNDUP, stichtag, ausgeloestAm: jetzt }).onConflictDoNothing({ target: [jobLauf.job, jobLauf.stichtag] }).returning({ id: jobLauf.id });
      return r[0]?.id ?? null;
    },
    async beendeLauf(laufId, e) {
      await db.update(jobLauf).set({ ergebnis: e.ergebnis, anzahl: e.anzahl, schritte: e.schritte, fehler: e.fehler?.slice(0, 2000), beendetAm: new Date() }).where(eq(jobLauf.id, laufId));
    },
    async ladeEmpfaenger() {
      const rows = await db.select({ id: benutzer.id, email: benutzer.email, seit: benutzer.roundupZuletztAm }).from(benutzer).where(and(eq(benutzer.aktiv, true), eq(benutzer.roundup, true))).orderBy(benutzer.email);
      return rows.map((r) => ({ id: r.id, email: r.email, seit: r.seit }));
    },
    async zaehle(nutzerId, seit) {
      const neu = seit ? sql<number>`count(*) filter (where ${inboxEintrag.erstelltAm} > ${seit})::int` : sql<number>`count(*)::int`;
      const rows = await db
        .select({ typ: inboxEintrag.typ, offen: sql<number>`count(*)::int`, neu })
        .from(inboxEintrag)
        .where(and(eq(inboxEintrag.empfaengerId, nutzerId), eq(inboxEintrag.zustand, "offen")))
        .groupBy(inboxEintrag.typ);
      return rows.map((r) => ({ typ: r.typ, offen: Number(r.offen), neu: Number(r.neu) }));
    },
    async sendeUndMarkiere(nutzerId, jetzt, senden) {
      return db.transaction(async (tx) => {
        const erg = await senden(tx as unknown as Schreiber);
        if (erg.ok) await tx.update(benutzer).set({ roundupZuletztAm: jetzt }).where(eq(benutzer.id, nutzerId));
        return erg;
      });
    },
  };
}

export type RoundupErgebnis =
  | { lauf: "wochenende"; stichtag: string }
  | { lauf: "uebersprungen"; stichtag: string }
  | { lauf: "ok"; stichtag: string; empfaenger: number; wuerdeSenden: number; gesendet: number; fehler: number; ursachen: Record<string, number> };

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fuehreRoundupAus(
  zugriff: RoundupZugriff,
  jetzt: Date,
  konfig: MailKonfig,
  basisUrl: string,
  holen: typeof fetch = fetch,
  log: (zeile: string) => void = console.log,
): Promise<RoundupErgebnis> {
  const stichtag = kalendertag(jetzt);
  if (!istWerktagBerlin(jetzt)) return { lauf: "wochenende", stichtag };
  const laufId = await zugriff.beginneLauf(stichtag, jetzt);
  if (!laufId) return { lauf: "uebersprungen", stichtag };

  let wuerde = 0;
  let gesendet = 0;
  let fehler = 0;
  const ursachen: Record<string, number> = {};
  try {
    const empfaenger = await zugriff.ladeEmpfaenger();
    for (const e of empfaenger) {
      const zaehler = await zugriff.zaehle(e.id, e.seit);
      const senden = wuerdeSenden(zaehler);
      const neu = zaehler.reduce((s, z) => s + z.neu, 0);
      const offen = zaehler.reduce((s, z) => s + z.offen, 0);
      const typen = Object.fromEntries(zaehler.map((z) => [z.typ, { offen: z.offen, neu: z.neu }]));
      log(`ROUNDUP nutzer=${e.id} wuerde_senden=${senden ? "ja" : "nein"} neu=${neu} offen=${offen} typen=${JSON.stringify(typen)}`);
      if (!senden) continue;
      wuerde++;
      const { betreff, text } = roundupText(zaehler, basisUrl);
      const auftrag = { art: "roundup" as const, empfaenger: { id: e.id, email: e.email }, betreff, text };
      let erg = await zugriff.sendeUndMarkiere(e.id, jetzt, (tx) => sendeMail(tx, auftrag, konfig, holen, log));
      if (!erg.ok && erg.ursache === "gedrosselt" && erg.wiederholenNach != null) {
        await warte(Math.min(erg.wiederholenNach, DROSSEL_WARTEN_MAX_S) * 1000);
        erg = await zugriff.sendeUndMarkiere(e.id, jetzt, (tx) => sendeMail(tx, auftrag, konfig, holen, log));
      }
      if (erg.ok) gesendet++;
      else {
        fehler++;
        ursachen[erg.ursache] = (ursachen[erg.ursache] ?? 0) + 1;
      }
    }
    // job_lauf.schritte ist Zahl je Schluessel: Ursachen als ursache_<code>; der Modus steht im Log.
    const schritte: Record<string, number> = { empfaenger: empfaenger.length, wuerde_senden: wuerde, gesendet, fehler, ...Object.fromEntries(Object.entries(ursachen).map(([k, v]) => [`ursache_${k}`, v])) };
    await zugriff.beendeLauf(laufId, { ergebnis: "ok", anzahl: gesendet, schritte });
    return { lauf: "ok", stichtag, empfaenger: empfaenger.length, wuerdeSenden: wuerde, gesendet, fehler, ursachen };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    await zugriff.beendeLauf(laufId, { ergebnis: "fehler", anzahl: gesendet, schritte: { wuerde_senden: wuerde, gesendet, fehler }, fehler: text }).catch(() => {});
    throw e;
  }
}
