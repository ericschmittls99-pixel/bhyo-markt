/**
 * AP2.4 PR b (E63): Ablauf-Hinweise des taeglichen Jobs — zustandsbasiert,
 * nicht ereignisbasiert. Der Job sieht am Stichtag auf strom_verifikation()
 * und stellt zu, was faellig ist; ausgefallene Tage holen sich dadurch von
 * selbst nach, ohne Sonderlogik:
 *
 *   laeuft_bald_ab      → verifikation_laeuft_ab,   Bezugsdatum = verifiziert_bis
 *   abgelaufen          → verifikation_abgelaufen,  Bezugsdatum = verifiziert_bis
 *   pruefdatum_unbekannt→ verifikation_abgelaufen,  ohne Bezugsdatum, an alle Pruefer
 *
 * als_abgelaufen_markiert (D3: keine Erinnerungen) und ohne_beleg (Entscheidung
 * Eric 01.10.2026) bekommen nichts. Empfaenger: der Pruefer des letzten
 * Ereignisses geprueft/reverifiziert; ist er kein Pruefer/Admin mehr oder
 * deaktiviert, alle aktiven Pruefer und Admins (admin ⊇ pruefer, E42).
 *
 * Idempotenz liegt in der Datenbank: je Empfaenger, Typ, Strom und
 * Bezugsdatum genau ein Eintrag (Migration 0033, NULLS NOT DISTINCT) — ON
 * CONFLICT DO NOTHING. Ein zweiter Lauf erzeugt nichts; eine neue
 * Verifikation ergibt ein neues Bezugsdatum und damit neue Hinweise.
 *
 * Dies ist neben zustellung.ts die zweite Stelle in lib/inbox, die
 * inbox_eintrag schreibt (inbox-check: nur hier). Kein Urheber, kein
 * Ereignis — der Job ist niemand (CHECK inbox_eintrag_urheber_check).
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "../db";

export type Ausfuehrer = Pick<AppDb, "execute">;

export interface HinweisErgebnis {
  laeuftAb: number;
  abgelaufen: number;
  /** Vorab-Hinweise, die mit dem Ablauf gegenstandslos wurden und erledigt sind. */
  vorabErledigt: number;
}

/**
 * Stellt die Hinweise fuer den Stichtag (JJJJ-MM-TT, Kalendertag Berlin) zu.
 * Mengenbasiert in zwei Anweisungen, in der uebergebenen Transaktion.
 */
export async function stelleVerifikationsHinweiseZu(tx: Ausfuehrer, stichtag: string): Promise<HinweisErgebnis> {
  const eingefuegt = (await tx.execute(sql`
    with v as (
      select art, strom_id, zustand, verifiziert_bis
        from strom_verifikation(${stichtag}::date)
       where zustand in ('laeuft_bald_ab', 'abgelaufen', 'pruefdatum_unbekannt')
    ), letzter as (
      -- Pruefer des letzten Ereignisses geprueft/reverifiziert je Strom (E23: aus dem Protokoll).
      select distinct on (a.entitaet_typ, a.entitaet_id) a.entitaet_typ, a.entitaet_id, a.benutzer_id
        from aenderung a
       where a.art::text in ('geprueft', 'reverifiziert')
       order by a.entitaet_typ, a.entitaet_id, a.zeitpunkt desc
    ), pruefer as (
      select id from benutzer where aktiv and rolle in ('pruefer', 'admin')
    ), ziel as (
      select v.art, v.strom_id,
             case when v.zustand = 'laeuft_bald_ab' then 'verifikation_laeuft_ab' else 'verifikation_abgelaufen' end as typ,
             case when v.zustand = 'pruefdatum_unbekannt' then null else v.verifiziert_bis end as bezugsdatum,
             -- Einzelempfaenger nur, wenn der letzte Pruefer noch aktiver Pruefer/Admin ist (sonst alle).
             case when v.zustand <> 'pruefdatum_unbekannt' then lb.id end as einzel
        from v
        left join letzter l
          on l.entitaet_typ = case v.art when 'biomasse' then 'biomassestrom' else 'output_bedarf' end
         and l.entitaet_id = v.strom_id
        left join benutzer lb on lb.id = l.benutzer_id and lb.aktiv and lb.rolle in ('pruefer', 'admin')
    ), empfaenger as (
      select z.art, z.strom_id, z.typ, z.bezugsdatum, coalesce(z.einzel, p.id) as empfaenger_id
        from ziel z
        left join pruefer p on z.einzel is null
    )
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, biomassestrom_id, output_bedarf_id, ereignis_id, bezugsdatum,
                               anzahl, erstellt_am, aktualisiert_am, zustand, zustand_seit)
    select e.empfaenger_id, null, e.typ::inbox_typ,
           case when e.art = 'biomasse' then e.strom_id end,
           case when e.art = 'output' then e.strom_id end,
           null, e.bezugsdatum, 1, now(), now(), 'offen', now()
      from empfaenger e
     where e.empfaenger_id is not null
    returning typ::text as typ
  `)) as unknown as { typ: string }[];

  // Ein Vorab-Hinweis zu demselben Bezugsdatum ist mit dem Ablauf gegenstandslos:
  // erledigen, damit nicht „laeuft am X ab" neben „seit X abgelaufen" steht.
  const erledigt = (await tx.execute(sql`
    update inbox_eintrag h
       set zustand = 'erledigt', zustand_seit = now()
      from inbox_eintrag a
     where h.zustand = 'offen'
       and h.typ::text = 'verifikation_laeuft_ab'
       and a.typ::text = 'verifikation_abgelaufen'
       and a.empfaenger_id = h.empfaenger_id
       and a.bezugsdatum = h.bezugsdatum
       and coalesce(a.biomassestrom_id, a.output_bedarf_id) = coalesce(h.biomassestrom_id, h.output_bedarf_id)
    returning h.id
  `)) as unknown as { id: string }[];

  return {
    laeuftAb: eingefuegt.filter((z) => z.typ === "verifikation_laeuft_ab").length,
    abgelaufen: eingefuegt.filter((z) => z.typ === "verifikation_abgelaufen").length,
    vorabErledigt: erledigt.length,
  };
}
