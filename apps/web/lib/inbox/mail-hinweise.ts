/**
 * AP2.9 Umschalten vorbereiten (E76 Nr. 6 und 8): Hinweise des Roundup-Jobs
 * an die Admins, die den Versand selbst betreffen — ohne Objektbezug.
 *
 *   mail_stoerung          Versand gestoert (Ursache als Code des Adapters).
 *                          Zustandsbasiert, „einmal je Stoerung": je Admin und
 *                          Ursache hoechstens ein OFFENER Eintrag (Index
 *                          inbox_eintrag_mail_stoerung_uidx, ON CONFLICT DO
 *                          NOTHING). Behoben = der naechste Lauf, der im Modus
 *                          graph ohne Stoerung sendet, erledigt alle offenen.
 *   mail_secret_laeuft_ab  Entra-Secret laeuft ab: 30 und 7 Tage vor dem Datum
 *                          aus M365_SECRET_ABLAUF (Bezugsdatum = Ablaufdatum,
 *                          Stufe = Vorlauf). Je Admin, Datum und Stufe genau
 *                          ein Eintrag ueber alle Zustaende (wie wird_frei):
 *                          ein neues Secret hat ein neues Datum; offene
 *                          Hinweise auf ein anderes Datum werden abgeraeumt.
 *
 * Voruebergehende Fehler (gedrosselt, netz, token_sonst, sonst) sind keine
 * Stoerung: sie stehen in job_lauf.schritte (ursache_<code>) und im Log, der
 * naechste Lauf versucht es wieder. Kein Urheber, kein Ereignis (Job-Hinweis,
 * CHECK inbox_eintrag_urheber_check). Zweite Schreibstelle neben hinweise.ts
 * innerhalb von lib/inbox (inbox-check: nur hier).
 */
import { sql } from "drizzle-orm";

import type { Ausfuehrer } from "./hinweise";

/** Ursachen des Adapters, die den Versand dauerhaft verhindern — jede ein eigener Hinweis. */
export const STOERUNG_URSACHEN = ["secret_abgelaufen", "secret_ungueltig", "app_unbekannt", "zugriff_verweigert", "postfach_unbekannt", "nicht_konfiguriert"] as const;
export type StoerungUrsache = (typeof STOERUNG_URSACHEN)[number];

export function istStoerung(ursache: string): ursache is StoerungUrsache {
  return (STOERUNG_URSACHEN as readonly string[]).includes(ursache);
}

/** Vorlauf der proaktiven Meldung in Tagen (E76 Nr. 8: 30 und 7). */
export const SECRET_STUFEN: readonly number[] = [30, 7];

/** Kalendertage von stichtag bis datum (beide JJJJ-MM-TT); negativ = datum liegt zurueck. */
export function tageBis(datum: string, stichtag: string): number {
  return Math.round((Date.parse(`${datum}T00:00:00Z`) - Date.parse(`${stichtag}T00:00:00Z`)) / 86_400_000);
}

/**
 * Welche Stufen am Stichtag faellig sind: jede Stufe, deren Vorlauf erreicht
 * oder unterschritten ist — auch nach dem Ablauf (dann sind alle faellig; den
 * eingetretenen Ablauf meldet daneben die reaktive Stoerung secret_abgelaufen).
 * Reine Funktion, Idempotenz je Stufe liegt im Index.
 */
export function faelligeSecretStufen(ablauf: string, stichtag: string, stufen: readonly number[] = SECRET_STUFEN): number[] {
  const rest = tageBis(ablauf, stichtag);
  return stufen.filter((s) => rest <= s).sort((a, b) => b - a);
}

/** Stoerung an alle aktiven Admins — je Admin und Ursache hoechstens ein offener Eintrag. */
export async function stelleStoerungZu(tx: Ausfuehrer, ursache: StoerungUrsache): Promise<number> {
  const rows = (await tx.execute(sql`
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, ereignis_id, ursache, anzahl, erstellt_am, aktualisiert_am, zustand, zustand_seit)
    select b.id, null, 'mail_stoerung'::inbox_typ, null, ${ursache}, 1, now(), now(), 'offen', now()
      from benutzer b where b.aktiv and b.rolle = 'admin'
    on conflict do nothing
    returning id
  `)) as unknown as { id: string }[];
  return rows.length;
}

/** Versand laeuft wieder: alle offenen Stoerungs-Hinweise sind gegenstandslos. */
export async function raeumeStoerungenAb(tx: Ausfuehrer): Promise<number> {
  const rows = (await tx.execute(sql`
    update inbox_eintrag set zustand = 'erledigt', zustand_seit = now()
     where zustand = 'offen' and typ::text = 'mail_stoerung'
    returning id
  `)) as unknown as { id: string }[];
  return rows.length;
}

/**
 * Proaktive Secret-Meldung: faellige Stufen an alle aktiven Admins zustellen,
 * offene Hinweise auf ein anderes (altes) Datum abraeumen. Ohne hinterlegtes
 * Datum wird nur abgeraeumt.
 */
export async function stelleSecretAblaufZu(tx: Ausfuehrer, ablauf: string | null, stichtag: string): Promise<{ zugestellt: number; abgeraeumt: number }> {
  const abgeraeumt = (await tx.execute(sql`
    update inbox_eintrag set zustand = 'erledigt', zustand_seit = now()
     where zustand = 'offen' and typ::text = 'mail_secret_laeuft_ab'
       and (${ablauf}::date is null or bezugsdatum is distinct from ${ablauf}::date)
    returning id
  `)) as unknown as { id: string }[];
  let zugestellt = 0;
  if (ablauf) {
    for (const stufe of faelligeSecretStufen(ablauf, stichtag)) {
      const rows = (await tx.execute(sql`
        insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, ereignis_id, bezugsdatum, stufe, anzahl, erstellt_am, aktualisiert_am, zustand, zustand_seit)
        select b.id, null, 'mail_secret_laeuft_ab'::inbox_typ, null, ${ablauf}::date, ${stufe}, 1, now(), now(), 'offen', now()
          from benutzer b where b.aktiv and b.rolle = 'admin'
        on conflict do nothing
        returning id
      `)) as unknown as { id: string }[];
      zugestellt += rows.length;
    }
  }
  return { zugestellt, abgeraeumt: abgeraeumt.length };
}
