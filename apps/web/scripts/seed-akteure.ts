/**
 * AP2.5 PR a1 (E66): Preview-Testdaten fuer akteure. — als Seed-Skript, keine
 * Migration (Migrationen erfinden keine Fachdaten). Laeuft NUR gegen die
 * Preview (pruefeSeedZiel: einzige Variable SEED_DATABASE_URL_PREVIEW, kein
 * Override; Rot-Nachweis im PR). Idempotent und als Testdaten gekennzeichnet:
 *
 *  1. Sitz des Bestands: jeder Seed-Akteur ('Seed: %') ohne Sitz bekommt
 *     PLZ, Ort und Pin aus dem Standort seines AELTESTEN Stroms (bewusst
 *     gewaehlt, bei mehreren Orten wird die Wahl ausgegeben). Strasse bleibt
 *     leer (unvollstaendig im Sinne von E66), die Hausnummer ebenso.
 *  2. Mindestens 40 zusaetzliche Akteure 'Seed-A25: %' ueber alle Sektoren
 *     und mehrere Orte/Kreise, mit Stroemen und Belegen aller sieben
 *     Belegtypen (beleg.metadata.seed = 'SEED-A25', Strom-Bezeichnung endet
 *     auf ' · SEED-A25'). Bewusst dabei: Dubletten-Kandidaten (stark:
 *     aehnlicher Name, gleiche PLZ; schwach: nur aehnlicher Name), verwaiste
 *     (teils aelter als der Verwaist-Parameter), unvollstaendige (ohne
 *     Strasse oder ohne Pin), einige 'ohne Sektor'.
 *  3. PR b: Kontaktpersonen (Name mit Praefix 'Seed-A25 ') zu den Regelfaellen
 *     und Dubletten — darunter Personen ohne Aktivitaet seit 25/30 Monaten
 *     an Akteuren ohne Beleg-Aktivitaet (loesen die Loeschpruefung aus) und
 *     eine junge Person.
 *
 * Loeschen: nur die SEED-A25-Zeilen (Stroeme, Belege, Akteure ohne fremde
 * Referenz) — nie TRUNCATE, nie den 'Seed: %'-Bestand (seed-preview.ts) und
 * nie 'Test:'-Daten.
 */
import { createHash } from "node:crypto";

import { createSql } from "@bhyo/db";

import { A25_AKTEURE, A25_ORTE, type A25Akteur } from "./seed-akteure-daten";
import { pruefeSeedZiel } from "./seed-guard";

const ziel = pruefeSeedZiel(process.env);
if ("fehler" in ziel) {
  console.error(`Abbruch: ${ziel.fehler}`);
  process.exit(1);
}
const zielUrl = "url" in ziel ? ziel.url : "";
const sql = createSql(zielUrl);

const PRAEFIX = "Seed-A25: ";
const MARKER = " · SEED-A25";
const BELEG_MARKER = "SEED-A25";
/** Marker der Strom-Bezeichnungen des Seed-Bestands (seed-daten.ts) — fuer die Pruef-Ereignisse beider Seeds. */
const SEED_V2_MARKER = " · SEED-v2";

/** Deterministische UUID (v5-artig) aus einem Schluessel — derselbe Schluessel ist dieselbe Zeile. */
function uuid(key: string): string {
  const h = createHash("sha1").update("bhyo-seed-a25:" + key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Orte mit PLZ und Koordinate (Kreise der Region, wie seed-daten.ts). */
const ORTE = A25_ORTE;

const BELEG_TYPEN = ["gespraech", "dokument", "webrecherche", "betriebsdaten", "vertrag", "absichtserklaerung", "angebot"] as const;

const AKTEURE: A25Akteur[] = A25_AKTEURE;

async function main() {
  const host = new URL(zielUrl).hostname;
  console.log(`SEED-A25 host=${host}`);

  // Stammdaten-Guard: Sektoren (inkl. Systemzeile), Materialarten, Produkte muessen existieren.
  const sektoren = (await sql`select code from sektor where aktiv`).map((r) => r.code as string);
  const fehlend = [...new Set(AKTEURE.map((a) => a.sektor))].filter((s) => !sektoren.includes(s));
  if (fehlend.length) {
    console.error(`Abbruch: unbekannte Sektoren ${fehlend.join(", ")} (Migration 0035 fuer ohne_sektor?).`);
    process.exit(1);
  }
  const materialarten = (await sql`select code from materialart order by code`).map((r) => r.code as string);
  const produkte = (await sql`select code from output_produkt order by code`).map((r) => r.code as string);
  if (!materialarten.length || !produkte.length) {
    console.error("Abbruch: keine Materialarten/Produkte in der Referenztabelle.");
    process.exit(1);
  }

  // 1. Sitz des Bestands: setzt seit AP2.5 PR a2 (0039, NOT NULL) seed-preview.ts
  //    beim Einfuegen aus dem ersten Strom-Standort — hier nur noch die Kontrolle.
  const [sb] = await sql`select count(*)::int as ohne_sitz from akteur where name like 'Seed: %' and (sitz_plz is null or sitz_ort is null)`;
  console.log(`SITZ_BESTAND ohne_sitz=${sb!.ohne_sitz}`);

  // 2. SEED-A25-Zeilen loeschen (Marker, FK-Reihenfolge), dann neu einfuegen.
  await sql.begin(async (tx) => {
    await tx`delete from vergabe_zeitraum where biomassestrom_id in (select id from biomassestrom where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from vergabe_zeitraum where output_bedarf_id in (select id from output_bedarf where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from inbox_eintrag where biomassestrom_id in (select id from biomassestrom where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from inbox_eintrag where output_bedarf_id in (select id from output_bedarf where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from biomassestrom where bezeichnung like ${"%" + MARKER}`;
    await tx`delete from output_bedarf where bezeichnung like ${"%" + MARKER}`;
    await tx`delete from beleg where metadata->>'seed' = ${BELEG_MARKER}`;
    // PR b: Kontaktpersonen der SEED-A25-Akteure samt ihrer Loeschpruefungs-Hinweise (Testdaten).
    await tx`delete from inbox_eintrag where kontaktperson_id in (select k.id from kontaktperson k join akteur a on a.id = k.akteur_id where a.name like ${PRAEFIX + "%"} or k.name like ${"Seed-A25 %"})`;
    await tx`delete from kontaktperson where name like ${"Seed-A25 %"} or akteur_id in (select id from akteur where name like ${PRAEFIX + "%"})`;
    await tx`delete from akteur where name like ${PRAEFIX + "%"}
      and not exists (select 1 from biomassestrom b where b.akteur_id = akteur.id)
      and not exists (select 1 from output_bedarf o where o.akteur_id = akteur.id)`;
  });

  let belegTyp = 0;
  let stroemeAngelegt = 0;
  await sql.begin(async (tx) => {
    for (const a of AKTEURE) {
      const id = uuid("akteur:" + a.key);
      const o = ORTE[a.ortIdx]!;
      const [strasse, hausnummer] = a.strasse ? [a.strasse.replace(/\s+\d+\w*$/, ""), a.strasse.match(/\s(\d+\w*)$/)?.[1] ?? null] : [null, null];
      const erstellt = a.alterMonate ? sql`now() - make_interval(months => ${a.alterMonate}::int)` : sql`now()`;
      await tx`insert into akteur (id, name, sektor, status, sitz_strasse, sitz_hausnummer, sitz_plz, sitz_ort, sitz_geom, created_at)
        values (${id}, ${PRAEFIX + a.name}, ${a.sektor}, 'geprueft', ${strasse}, ${hausnummer}, ${o.plz}, ${o.ort},
                ${a.ohnePin ? null : sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.003}, ${o.lat - 0.002}), 4326)`}, ${erstellt})
        on conflict (id) do update set name = excluded.name, sektor = excluded.sektor, sitz_strasse = excluded.sitz_strasse,
          sitz_hausnummer = excluded.sitz_hausnummer, sitz_plz = excluded.sitz_plz, sitz_ort = excluded.sitz_ort,
          sitz_geom = excluded.sitz_geom, created_at = excluded.created_at`;
      for (let i = 0; i < a.stroeme; i++) {
        let belegId: string | null = null;
        if (!a.ohneBeleg) {
          const typ = BELEG_TYPEN[belegTyp++ % BELEG_TYPEN.length]!;
          const mitGueltigBis = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"].includes(typ);
          const [b] = await tx`insert into beleg (typ, extern_nachvollziehbar, link_url, gueltig_bis, metadata, erstellt_am)
            values (${typ}::beleg_typ, false, ${typ === "webrecherche" ? `https://example.org/seed-a25/${a.key}` : null},
                    ${mitGueltigBis ? sql`(current_date + ${30 + i * 90}::int)` : null},
                    ${tx.json({ seed: BELEG_MARKER, quellenangabe: `Seed-A25 ${typ} ${a.key}` })}, now())
            returning id`;
          belegId = b!.id as string;
        }
        const stromId = uuid(`strom:${a.key}:${i}`);
        const bezeichnung = `${a.name} Strom ${i + 1}${MARKER}`;
        if (i % 3 === 2) {
          await tx`insert into output_bedarf (id, akteur_id, bezeichnung, ort, plz, standort_geom, produkt_code, menge_wert, menge_einheit, preis, preis_einheit, preis_herkunft,
              zeitraum_von, zeitraum_bis, saisonalitaet, beleg_id, status, reserviert_bhyo, reserviert_seit)
            values (${stromId}, ${id}, ${bezeichnung}, ${o.ort}, ${o.plz}, ${sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.01}, ${o.lat + 0.01}), 4326)`},
              ${produkte[i % produkte.length]!}, 500, 't/a', null, null, null, '2026-01-01', '2027-12-31', ${tx.json(Array(12).fill(1))}, ${belegId}, 'entwurf', false, null)`;
        } else {
          await tx`insert into biomassestrom (id, akteur_id, bezeichnung, ort, plz, standort_geom, materialart_code, menge_roh_fm, ts_anteil_pct, aschegehalt_pct,
              zeitraum_von, zeitraum_bis, saisonalitaet, preis_min, preis_mittel, preis_max, preis_herkunft, beleg_id, status, reserviert_bhyo, reserviert_seit)
            values (${stromId}, ${id}, ${bezeichnung}, ${o.ort}, ${o.plz}, ${sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.01 * (i + 1)}, ${o.lat - 0.01}), 4326)`},
              ${materialarten[(a.ortIdx + i) % materialarten.length]!}, ${1000 + i * 250}, 45, 5, '2026-01-01', '2027-12-31', ${tx.json(Array(12).fill(1))},
              null, null, null, null, ${belegId}, ${belegId ? "geprueft" : "entwurf"}, false, null)`;
        }
        stroemeAngelegt += 1;
      }
    }
  });

  // 3. PR b: Kontaktpersonen — Regel- und Dubletten-Akteure bekommen 1–2 Personen;
  //    die Loeschpruefungs-Faelle haengen an verwaisten Akteuren (keine Beleg-Aktivitaet).
  const PERSONEN: { akteurKey: string; name: string; funktion: string | null; mail: string | null; telefon: string | null; notiz: string | null; alterMonate?: number }[] = [
    { akteurKey: "mueller-agrar-1", name: "Seed-A25 Anna Müller", funktion: "Geschäftsführung", mail: "a.mueller@example.org", telefon: "07261 100", notiz: null },
    { akteurKey: "mueller-agrar-1", name: "Seed-A25 Jonas Weber", funktion: "Betriebsleitung", mail: "j.weber@example.org", telefon: null, notiz: "Ansprechpartner für Lieferzeiten." },
    { akteurKey: "stadtwerke-speyer-1", name: "Seed-A25 Petra Klein", funktion: "Einkauf Energie", mail: "p.klein@example.org", telefon: "06232 200", notiz: null },
    { akteurKey: "biogas-kraich-1", name: "Seed-A25 Markus Roth", funktion: "Anlagenleitung", mail: null, telefon: "07262 300", notiz: null },
    { akteurKey: "papier-neckar-1", name: "Seed-A25 Sabine Lang", funktion: "Reststoffmanagement", mail: "s.lang@example.org", telefon: null, notiz: null },
    { akteurKey: "r-1", name: "Seed-A25 Thomas Berg", funktion: "Werkleitung", mail: "t.berg@example.org", telefon: "06222 400", notiz: null },
    { akteurKey: "r-4", name: "Seed-A25 Claudia Fuchs", funktion: "Nachhaltigkeit", mail: "c.fuchs@example.org", telefon: null, notiz: "Bevorzugt E-Mail." },
    { akteurKey: "r-6", name: "Seed-A25 Dirk Hahn", funktion: "Disposition", mail: null, telefon: "06222 500", notiz: null },
    { akteurKey: "r-9", name: "Seed-A25 Eva Wolf", funktion: "Forstamtsleitung", mail: "e.wolf@example.org", telefon: null, notiz: null },
    { akteurKey: "r-15", name: "Seed-A25 Lukas Stein", funktion: "Vertrieb", mail: "l.stein@example.org", telefon: "06233 600", notiz: null },
    { akteurKey: "ohne-1", name: "Seed-A25 Vereinsvorsitz Obst", funktion: "Vorsitz", mail: null, telefon: null, notiz: null },
    // Loeschpruefung (E57): keine Aktivitaet seit 25 bzw. 30 Monaten an verwaisten Akteuren (kein Beleg, kein Ereignis).
    { akteurKey: "verwaist-alt-1", name: "Seed-A25 Rainer Alt", funktion: "ehem. Einkauf", mail: null, telefon: null, notiz: null, alterMonate: 25 },
    { akteurKey: "verwaist-alt-2", name: "Seed-A25 Heike Lang", funktion: "ehem. Leitung", mail: null, telefon: null, notiz: null, alterMonate: 30 },
    // Jung: loest nichts aus.
    { akteurKey: "verwaist-jung-1", name: "Seed-A25 Nina Neu", funktion: "Betriebsleitung", mail: "n.neu@example.org", telefon: null, notiz: null },
  ];
  await sql.begin(async (tx) => {
    for (const p of PERSONEN) {
      const stamp = p.alterMonate ? sql`now() - make_interval(months => ${p.alterMonate}::int)` : sql`now()`;
      await tx`insert into kontaktperson (id, akteur_id, name, funktion, mail_dienstlich, telefon, notiz, created_at, updated_at)
        values (${uuid("person:" + p.akteurKey + ":" + p.name)}, ${uuid("akteur:" + p.akteurKey)}, ${p.name}, ${p.funktion}, ${p.mail}, ${p.telefon}, ${p.notiz}, ${stamp}, ${stamp})
        on conflict (id) do update set name = excluded.name, funktion = excluded.funktion, mail_dienstlich = excluded.mail_dienstlich,
          telefon = excluded.telefon, notiz = excluded.notiz, created_at = excluded.created_at, updated_at = excluded.updated_at`;
    }
  });

  // 4. Pruef-Ereignisse fuer die geprueften Seed-Stroeme BEIDER Seeds (Entscheidung
  //    Eric 04.10.2026): verifiziert_am kommt aus dem letzten Ereignis geprueft/
  //    reverifiziert (strom_verifikation, 0032). Ohne Ereignis stehen alle geprueften
  //    Seed-Stroeme auf „Pruefdatum unbekannt" und der Job stellte 254 Hinweise zu.
  //    Streuung deterministisch aus der Strom-ID: 0–4 gueltig (vor 10 Tagen), 5–6
  //    laeuft in 5 Tagen ab (Pruefdatum = heute + 5 Tage - Typ-Frist), 7–8
  //    abgelaufen (Frist + 30 Tage zurueck), 9 bewusst ohne Pruefdatum (Altfall).
  //    Bei den oberen vier Belegtypen zaehlt gueltig_bis als Ablauf, das Ereignis
  //    liefert dort nur das Pruefdatum. Idempotent ueber den Textmarker; die alten
  //    Job-Hinweise der Seed-Stroeme werden entfernt (der Job erledigt
  //    pruefdatum_unbekannt-Hinweise nicht selbst — nur Ereignisse ueber
  //    protokolliere() raeumen ab, und der Seed schreibt bewusst roh), der naechste
  //    Lauf stellt sie zustandsbasiert neu zu. Nur Preview (pruefeSeedZiel).
  const PRUEF_MARKER = "Seed-A25 Pruefereignis";
  const [pruefer] = await sql`select id, email from benutzer where rolle in ('admin', 'pruefer') and aktiv order by rolle, email limit 1`;
  if (!pruefer) {
    console.error("Abbruch: kein aktiver Pruefer/Admin fuer die Pruef-Ereignisse.");
    process.exit(1);
  }
  const pruefung = await sql.begin(async (tx) => {
    await tx`delete from aenderung where art::text = 'geprueft' and text like ${"%" + PRUEF_MARKER + "%"}`;
    const hinweiseWeg = await tx`
      with s as (
        select b.id from biomassestrom b where b.bezeichnung like ${"%" + MARKER} or b.bezeichnung like ${"%" + SEED_V2_MARKER}
        union all
        select o.id from output_bedarf o where o.bezeichnung like ${"%" + MARKER} or o.bezeichnung like ${"%" + SEED_V2_MARKER}
      )
      delete from inbox_eintrag h using s
       where coalesce(h.biomassestrom_id, h.output_bedarf_id) = s.id
         and h.typ::text in ('verifikation_laeuft_ab', 'verifikation_abgelaufen')
      returning h.id`;
    const eingefuegt = await tx`
      with s as (
        select b.id, 'biomassestrom' as typ, bl.typ::text as belegtyp from biomassestrom b join beleg bl on bl.id = b.beleg_id
         where b.status = 'geprueft' and (b.bezeichnung like ${"%" + MARKER} or b.bezeichnung like ${"%" + SEED_V2_MARKER})
        union all
        select o.id, 'output_bedarf', bl.typ::text from output_bedarf o join beleg bl on bl.id = o.beleg_id
         where o.status = 'geprueft' and (o.bezeichnung like ${"%" + MARKER} or o.bezeichnung like ${"%" + SEED_V2_MARKER})
      ), k as (
        select s.*,
               (('x' || substr(md5(s.id::text), 1, 8))::bit(32)::int & 2147483647) % 10 as klasse,
               case when s.belegtyp in ('gespraech', 'dokument', 'webrecherche')
                    then parameter_wert('verifikationsfrist.' || s.belegtyp, current_date) else 6 end as frist
          from s
      ), z as (
        select k.*, case
            when klasse <= 4 then now() - interval '10 days'
            when klasse <= 6 then ((current_date + 5)::timestamp - make_interval(months => frist))::timestamptz
            when klasse <= 8 then now() - make_interval(months => frist) - interval '30 days'
            else null end as zeitpunkt
          from k
      )
      insert into aenderung (entitaet_typ, entitaet_id, zeitpunkt, text, art, benutzer_id, benutzer_email)
      select typ, id, zeitpunkt, ${pruefer.email + ": Geprüft (" + PRUEF_MARKER + ")"}, 'geprueft', ${pruefer.id}, ${pruefer.email}
        from z where zeitpunkt is not null
      returning entitaet_id`;
    const zustaende = await tx`
      with s as (
        select b.id from biomassestrom b where b.status = 'geprueft' and (b.bezeichnung like ${"%" + MARKER} or b.bezeichnung like ${"%" + SEED_V2_MARKER})
        union all
        select o.id from output_bedarf o where o.status = 'geprueft' and (o.bezeichnung like ${"%" + MARKER} or o.bezeichnung like ${"%" + SEED_V2_MARKER})
      )
      select v.zustand, count(*)::int as n from strom_verifikation(current_date) v join s on s.id = v.strom_id group by 1 order by 1`;
    return { ereignisse: eingefuegt.length, hinweiseEntfernt: hinweiseWeg.length, zustaende: Object.fromEntries(zustaende.map((r) => [r.zustand as string, Number(r.n)])) };
  });
  console.log("PRUEFEREIGNISSE " + JSON.stringify(pruefung));

  // Selbstpruefung
  const [z] = await sql`select
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"}) as akteure,
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"} and sektor = 'ohne_sektor') as ohne_sektor,
      (select count(*)::int from akteur a where a.name like ${PRAEFIX + "%"} and not exists (select 1 from biomassestrom b where b.akteur_id = a.id) and not exists (select 1 from output_bedarf o where o.akteur_id = a.id)) as verwaist,
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"} and (sitz_strasse is null or sitz_geom is null)) as unvollstaendig,
      (select count(distinct sektor)::int from akteur where name like ${PRAEFIX + "%"}) as sektoren,
      (select count(distinct sitz_plz)::int from akteur where name like ${PRAEFIX + "%"}) as plz,
      (select count(distinct typ)::int from beleg where metadata->>'seed' = ${BELEG_MARKER}) as belegtypen,
      (select count(*)::int from akteur where name like 'Seed: %' and sitz_plz is null) as bestand_ohne_sitz,
      (select count(*)::int from kontaktperson where name like 'Seed-A25 %') as kontaktpersonen,
      (select count(*)::int from kontaktperson where name like 'Seed-A25 %' and updated_at < now() - interval '24 months') as loeschpruefung_faelle`;
  console.log("SEED-A25 " + JSON.stringify({ ...z, stroeme: stroemeAngelegt }));
  const fehler: string[] = [];
  if (Number(z!.akteure) < 40) fehler.push(`nur ${z!.akteure} Akteure (mindestens 40)`);
  if (Number(z!.belegtypen) !== BELEG_TYPEN.length) fehler.push(`nur ${z!.belegtypen} Belegtypen (alle ${BELEG_TYPEN.length})`);
  if (Number(z!.sektoren) < 9) fehler.push(`nur ${z!.sektoren} Sektoren`);
  if (Number(z!.verwaist) < 3 || Number(z!.unvollstaendig) < 3 || Number(z!.ohne_sektor) < 2) fehler.push("Sonderfaelle fehlen (verwaist/unvollstaendig/ohne Sektor)");
  if (Number(z!.kontaktpersonen) < 10 || Number(z!.loeschpruefung_faelle) < 2) fehler.push("Kontaktpersonen oder Loeschpruefungs-Faelle fehlen (PR b)");
  for (const zustand of ["gueltig", "laeuft_bald_ab", "abgelaufen", "pruefdatum_unbekannt"]) {
    if (!pruefung.zustaende[zustand]) fehler.push(`Pruef-Ereignisse: Zustand ${zustand} fehlt in der Streuung`);
  }
  await sql.end();
  if (fehler.length) {
    console.error("VERLETZUNGEN:\n- " + fehler.join("\n- "));
    process.exit(1);
  }
  console.log("Alle Invarianten erfuellt.");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
