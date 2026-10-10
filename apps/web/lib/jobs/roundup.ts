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
 * wird einmal nach Retry-After (gedeckelt) wiederholt.
 *
 * Umschalten vorbereiten (Eric 10.10.2026): dauerhafte Ursachen (Secret,
 * Zustimmung, Postfach, nicht konfiguriert) werden als Admin-Hinweis
 * mail_stoerung zugestellt, einmal je offener Stoerung; sendet ein spaeterer
 * Lauf im Modus graph wieder, raeumt er sie ab. Der Secret-Ablauf wird 30 und
 * 7 Tage vorher gemeldet (M365_SECRET_ABLAUF). Die Summen des Laufs stehen in
 * job_lauf.schritte (modus, empfaenger, abgemeldet, wuerde_senden, nichts_neu,
 * gesendet, protokolliert, fehler, ursache_<code>, stoerung_*, secret_*) —
 * lesbar ueber den Leseweg, ohne Worker-Log. „gesendet" zaehlt NUR echte
 * Zustellungen (modus=graph); im Probemodus heisst der Zaehler protokolliert.
 *
 * Datenbankzugriff steckt in `roundupZugriff`; der Ablauf selbst nimmt die
 * Schnittstelle herein und laesst sich ohne Datenbank testen.
 */
import { and, eq, sql } from "drizzle-orm";

import { fehlerKlasse } from "@bhyo/db/fehler";
import { benutzer, inboxEintrag, jobLauf } from "@bhyo/db/schema";

import { ZEITZONE, kalendertag } from "@/lib/datum";
import type { AppDb } from "@/lib/db";
import { istStoerung, raeumeStoerungenAb, stelleSecretAblaufZu, stelleStoerungZu, type StoerungUrsache } from "@/lib/inbox/mail-hinweise";
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
  ["mail_stoerung", "Störungen der Tages-Mail"],
  ["mail_secret_laeuft_ab", "Mail-Secret läuft ab"],
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
  beendeLauf(laufId: string, ergebnis: { ergebnis: "ok" | "fehler"; anzahl: number; schritte: Record<string, number | string>; fehler?: string }): Promise<void>;
  /** Aktive Nutzer mit Roundup an. */
  ladeEmpfaenger(): Promise<Empfaenger[]>;
  /** Aktive Nutzer mit Roundup aus — nur als Zaehler fuer die Summen des Laufs. */
  zaehleAbgemeldet(): Promise<number>;
  /** Admin-Hinweise zum Versand (lib/inbox/mail-hinweise.ts): neu zugestellte bzw. abgeraeumte Eintraege. */
  meldeStoerung(ursache: StoerungUrsache): Promise<number>;
  raeumeStoerungenAb(): Promise<number>;
  pruefeSecretAblauf(ablauf: string | null, stichtag: string): Promise<{ zugestellt: number; abgeraeumt: number }>;
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
    async zaehleAbgemeldet() {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(benutzer).where(and(eq(benutzer.aktiv, true), eq(benutzer.roundup, false)));
      return Number(r?.n ?? 0);
    },
    meldeStoerung: (ursache) => stelleStoerungZu(db, ursache),
    raeumeStoerungenAb: () => raeumeStoerungenAb(db),
    pruefeSecretAblauf: (ablauf, stichtag) => stelleSecretAblaufZu(db, ablauf, stichtag),
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
  | {
      lauf: "ok";
      stichtag: string;
      modus: MailKonfig["modus"];
      empfaenger: number;
      abgemeldet: number;
      wuerdeSenden: number;
      nichtsNeu: number;
      /** Nur modus=graph (echte Zustellungen); im Probemodus zaehlt protokolliert. */
      gesendet: number;
      protokolliert: number;
      fehler: number;
      ursachen: Record<string, number>;
      stoerungen: { gemeldet: number; abgeraeumt: number };
      secret: { zugestellt: number; abgeraeumt: number };
    };

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
  let protokolliert = 0;
  let fehler = 0;
  const ursachen: Record<string, number> = {};
  try {
    // E76 Nr. 8: proaktive Secret-Meldung an die Admins, unabhaengig vom Modus (das Datum
    // ist hinterlegt, bevor umgeschaltet wird) — offene Hinweise auf ein altes Datum abraeumen.
    const secret = await zugriff.pruefeSecretAblauf(konfig.secretAblauf, stichtag);
    const abgemeldet = await zugriff.zaehleAbgemeldet();
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
      if (erg.ok) {
        // Eric 09.10.2026: „gesendet" nur mit modus=graph — ein Probemodus-Ereignis ist kein Versand.
        if (erg.modus === "graph") gesendet++;
        else protokolliert++;
      } else {
        fehler++;
        ursachen[erg.ursache] = (ursachen[erg.ursache] ?? 0) + 1;
      }
    }
    // E76 Nr. 6: dauerhafte Ursachen als Admin-Hinweis, einmal je offener Stoerung (Index);
    // sendet der Lauf im Modus graph und ohne Stoerung, ist die Stoerung behoben.
    const stoerungen = { gemeldet: 0, abgeraeumt: 0 };
    const dauerhaft = Object.keys(ursachen).filter(istStoerung);
    for (const u of dauerhaft) stoerungen.gemeldet += await zugriff.meldeStoerung(u);
    if (dauerhaft.length === 0 && gesendet > 0) stoerungen.abgeraeumt = await zugriff.raeumeStoerungenAb();
    log(`ROUNDUP summe modus=${konfig.modus} empfaenger=${empfaenger.length} abgemeldet=${abgemeldet} wuerde_senden=${wuerde} nichts_neu=${empfaenger.length - wuerde} gesendet=${gesendet} protokolliert=${protokolliert} fehler=${fehler} stoerung_gemeldet=${stoerungen.gemeldet} stoerung_abgeraeumt=${stoerungen.abgeraeumt} secret_zugestellt=${secret.zugestellt} secret_abgeraeumt=${secret.abgeraeumt}`);
    // job_lauf.schritte: Zahlen je Schluessel plus der Modus als Text (Eric 10.10.2026: die Zeile
    // muss ohne Log-Zugang lesbar sein); Ursachen als ursache_<code>.
    const schritte: Record<string, number | string> = {
      modus: konfig.modus,
      empfaenger: empfaenger.length,
      abgemeldet,
      wuerde_senden: wuerde,
      nichts_neu: empfaenger.length - wuerde,
      gesendet,
      protokolliert,
      fehler,
      ...Object.fromEntries(Object.entries(ursachen).map(([k, v]) => [`ursache_${k}`, v])),
      stoerung_gemeldet: stoerungen.gemeldet,
      stoerung_abgeraeumt: stoerungen.abgeraeumt,
      secret_zugestellt: secret.zugestellt,
      secret_abgeraeumt: secret.abgeraeumt,
    };
    await zugriff.beendeLauf(laufId, { ergebnis: "ok", anzahl: gesendet, schritte });
    return {
      lauf: "ok",
      stichtag,
      modus: konfig.modus,
      empfaenger: empfaenger.length,
      abgemeldet,
      wuerdeSenden: wuerde,
      nichtsNeu: empfaenger.length - wuerde,
      gesendet,
      protokolliert,
      fehler,
      ursachen,
      stoerungen,
      secret,
    };
  } catch (e) {
    // E73 (Eric 10.10.2026): nie e.message in die Datenbank — ein Drizzle-Fehler nennt Query und
    // Parameter (Adressen moeglich). Nur Fehlerklasse und Code (packages/db/src/fehler.ts).
    await zugriff.beendeLauf(laufId, { ergebnis: "fehler", anzahl: gesendet, schritte: { modus: konfig.modus, wuerde_senden: wuerde, gesendet, protokolliert, fehler }, fehler: fehlerKlasse(e) }).catch(() => {});
    throw e;
  }
}
