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
  /** AP2.5 (E66): Verwaist-Hinweise an die Admins (neu zugestellt / wieder erledigt, weil der Akteur einen Strom hat). */
  verwaist: number;
  verwaistErledigt: number;
  /** AP2.5 PR b (E57): Loeschpruefung — Kontaktpersonen ohne Aktivitaet seit M Monaten (neu / wieder erledigt). */
  loeschpruefung: number;
  loeschpruefungErledigt: number;
  /**
   * Betrieb 05.10.2026: offene Ablauf-Hinweise (laeuft_ab/abgelaufen), deren
   * Bedingung zum Stichtag nicht mehr gilt — abgeleitet aus dem aktuellen
   * Verifikationszustand, ohne Ereignisliste (in Pruefung, Frist verschoben,
   * verworfen, geloescht …). Idempotent, im selben Lauf wie das Zustellen.
   */
  abgeraeumt: number;
  /** Betrieb 06.10.2026: Millisekunden je Schritt (zustellen, vorab_erledigen, abraeumen, …). */
  schritteMs: Record<string, number>;
}

/**
 * Stellt die Hinweise fuer den Stichtag (JJJJ-MM-TT, Kalendertag Berlin) zu.
 * Mengenbasiert in zwei Anweisungen, in der uebergebenen Transaktion.
 */
export async function stelleVerifikationsHinweiseZu(tx: Ausfuehrer, stichtag: string): Promise<HinweisErgebnis> {
  // Betrieb 06.10.2026 (Eric): Dauer je Schritt, damit job_lauf.schritte zeigt,
  // wo die Zeit bleibt (57 s am 06.10. bei 0 Stroemen auf Production).
  const schritteMs: Record<string, number> = {};
  const zeit = async <T,>(name: string, f: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    const r = await f();
    schritteMs[name] = Date.now() - t;
    return r;
  };
  const eingefuegt = (await zeit("zustellen", () => tx.execute(sql`
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
    on conflict do nothing
    returning typ::text as typ
  `))) as unknown as { typ: string }[];

  // Ein Vorab-Hinweis zu demselben Bezugsdatum ist mit dem Ablauf gegenstandslos:
  // erledigen, damit nicht „laeuft am X ab" neben „seit X abgelaufen" steht.
  const erledigt = (await zeit("vorab_erledigen", () => tx.execute(sql`
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
  `))) as unknown as { id: string }[];

  // Betrieb 05.10.2026 (Eric): Jeder offene Ablauf-Hinweis des Jobs, dessen
  // Bedingung zum Stichtag nicht mehr gilt, wird abgeraeumt. Die Bedingung ist
  // genau die, unter der der Hinweis zugestellt wurde: laeuft_ab = Zustand
  // laeuft_bald_ab mit demselben verifiziert_bis; abgelaufen = Zustand
  // abgelaufen mit demselben verifiziert_bis ODER pruefdatum_unbekannt ohne
  // Bezugsdatum. Alles andere (in_pruefung nach fachlicher Aenderung,
  // verschobene Frist, verworfen, Strom ohne Zustand) raeumt ab. Laeuft NACH
  // dem Zustellen: eine verschobene Frist liefert im selben Lauf den neuen
  // Hinweis und raeumt den alten. Keine Ereignisliste, nur der Zustand.
  const abgeraeumt = (await zeit("abraeumen", () => tx.execute(sql`
    with v as (
      select strom_id, zustand, verifiziert_bis from strom_verifikation(${stichtag}::date)
    ), faellig as (
      select h.id
        from inbox_eintrag h
        left join v on v.strom_id = coalesce(h.biomassestrom_id, h.output_bedarf_id)
       where h.zustand = 'offen'
         and h.ausloeser_id is null
         and h.typ::text in ('verifikation_laeuft_ab', 'verifikation_abgelaufen')
         and not (
           (h.typ::text = 'verifikation_laeuft_ab' and v.zustand = 'laeuft_bald_ab' and v.verifiziert_bis = h.bezugsdatum)
           or (h.typ::text = 'verifikation_abgelaufen'
               and ((v.zustand = 'abgelaufen' and v.verifiziert_bis = h.bezugsdatum)
                    or (v.zustand = 'pruefdatum_unbekannt' and h.bezugsdatum is null)))
         )
    )
    update inbox_eintrag h
       set zustand = 'erledigt', zustand_seit = now()
      from faellig f
     where f.id = h.id
    returning h.id
  `))) as unknown as { id: string }[];

  // AP2.5 PR a1 (E66): verwaiste Akteure — kein Strom verweist auf den Akteur
  // (E48, auch kein verworfener). Seit wann: letztes Ereignis am Akteur
  // (akteur_angelegt/akteur_geaendert, darunter das Entfernen des letzten
  // Stroms durch Umhaengen), fuer Altbestand ohne Ereignis created_at. Nach
  // parameter_wert('akteur.verwaist_hinweis_monate') Monaten ein Hinweis an
  // alle aktiven Admins, Bezugsdatum = seit-wann; idempotent per Index.
  const verwaist = (await zeit("verwaist", () => tx.execute(sql`
    with s as (
      select akteur_id from biomassestrom union all select akteur_id from output_bedarf
    ), p as (
      select entitaet_id, max(zeitpunkt) as zeitpunkt from aenderung
       where entitaet_typ = 'akteur' and art::text in ('akteur_angelegt', 'akteur_geaendert') group by entitaet_id
    ), v as (
      select a.id as akteur_id, (coalesce(p.zeitpunkt, a.created_at) at time zone 'Europe/Berlin')::date as seit
        from akteur a left join p on p.entitaet_id = a.id
       where not exists (select 1 from s where s.akteur_id = a.id)
    ), faellig as (
      select v.akteur_id, v.seit from v
       where v.seit + make_interval(months => parameter_wert('akteur.verwaist_hinweis_monate', ${stichtag}::date)) <= ${stichtag}::date
    ), admins as (
      select id from benutzer where aktiv and rolle = 'admin'
    )
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, akteur_id, ereignis_id, bezugsdatum,
                               anzahl, erstellt_am, aktualisiert_am, zustand, zustand_seit)
    select ad.id, null, 'akteur_verwaist'::inbox_typ, f.akteur_id, null, f.seit, 1, now(), now(), 'offen', now()
      from faellig f cross join admins ad
    on conflict do nothing
    returning id
  `))) as unknown as { id: string }[];
  // Hat ein Akteur wieder einen Strom, sind offene Verwaist-Hinweise gegenstandslos.
  const verwaistErledigt = (await zeit("verwaist_erledigen", () => tx.execute(sql`
    update inbox_eintrag h
       set zustand = 'erledigt', zustand_seit = now()
     where h.zustand = 'offen' and h.typ::text = 'akteur_verwaist' and h.akteur_id is not null
       and (exists (select 1 from biomassestrom b where b.akteur_id = h.akteur_id)
            or exists (select 1 from output_bedarf o where o.akteur_id = h.akteur_id))
    returning h.id
  `))) as unknown as { id: string }[];

  // AP2.5 PR b (E57): Loeschpruefung — letzte Aktivitaet = juengste Aenderung an der
  // Person (Zeitstempel oder Protokoll) oder an einem Beleg (Strom, E48) ihres
  // Akteurs. Nach parameter_wert('kontaktperson.loeschpruefung_monate') Monaten
  // ein Hinweis an alle aktiven Admins, Bezugsdatum = letzte Aktivitaet; nur die
  // ID der Person im Eintrag (E57). Geloescht wird nur von Hand.
  const AKTIVITAET = sql`
    with stroeme as (
      select id, akteur_id from biomassestrom union all select id, akteur_id from output_bedarf
    ), beleg_aktivitaet as (
      select s.akteur_id, max(a.zeitpunkt) as zeitpunkt
        from stroeme s join aenderung a on a.entitaet_id = s.id and a.entitaet_typ in ('biomassestrom', 'output_bedarf')
       group by s.akteur_id
    ), person_aktivitaet as (
      select entitaet_id, max(zeitpunkt) as zeitpunkt from aenderung where entitaet_typ = 'kontaktperson' group by entitaet_id
    ), letzte as (
      select k.id as kontaktperson_id,
             (greatest(k.updated_at, coalesce(pa.zeitpunkt, k.created_at), coalesce(ba.zeitpunkt, k.created_at)) at time zone 'Europe/Berlin')::date as seit
        from kontaktperson k
        left join person_aktivitaet pa on pa.entitaet_id = k.id
        left join beleg_aktivitaet ba on ba.akteur_id = k.akteur_id
    )`;
  const loeschpruefung = (await zeit("loeschpruefung", () => tx.execute(sql`
    ${AKTIVITAET}, faellig as (
      select kontaktperson_id, seit from letzte
       where seit + make_interval(months => parameter_wert('kontaktperson.loeschpruefung_monate', ${stichtag}::date)) <= ${stichtag}::date
    ), admins as (
      select id from benutzer where aktiv and rolle = 'admin'
    )
    insert into inbox_eintrag (empfaenger_id, ausloeser_id, typ, kontaktperson_id, ereignis_id, bezugsdatum,
                               anzahl, erstellt_am, aktualisiert_am, zustand, zustand_seit)
    select ad.id, null, 'kontaktperson_loeschpruefung'::inbox_typ, f.kontaktperson_id, null, f.seit, 1, now(), now(), 'offen', now()
      from faellig f cross join admins ad
    on conflict do nothing
    returning id
  `))) as unknown as { id: string }[];
  // Gibt es wieder Aktivitaet (juenger als das Bezugsdatum), ist der offene Hinweis gegenstandslos.
  const loeschpruefungErledigt = (await zeit("loeschpruefung_erledigen", () => tx.execute(sql`
    ${AKTIVITAET}
    update inbox_eintrag h
       set zustand = 'erledigt', zustand_seit = now()
      from letzte l
     where h.zustand = 'offen' and h.typ::text = 'kontaktperson_loeschpruefung'
       and l.kontaktperson_id = h.kontaktperson_id and l.seit > h.bezugsdatum
    returning h.id
  `))) as unknown as { id: string }[];

  return {
    laeuftAb: eingefuegt.filter((z) => z.typ === "verifikation_laeuft_ab").length,
    abgelaufen: eingefuegt.filter((z) => z.typ === "verifikation_abgelaufen").length,
    vorabErledigt: erledigt.length,
    abgeraeumt: abgeraeumt.length,
    verwaist: verwaist.length,
    verwaistErledigt: verwaistErledigt.length,
    loeschpruefung: loeschpruefung.length,
    loeschpruefungErledigt: loeschpruefungErledigt.length,
    schritteMs,
  };
}
