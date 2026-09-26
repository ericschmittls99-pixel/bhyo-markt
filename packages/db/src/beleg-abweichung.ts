/**
 * E33/E34: Abweichungsliste der Qualitaetsstufen VOR und NACH der Matrix-
 * Umstellung (Migration 0021) — nur lesend, gegen die echte Datenbank.
 *
 * Gemessen wird, was die Migration veraendern wird, bevor sie laeuft:
 *   - je Beleg die heutige (gespeicherte GENERATED-)Stufe gegen die Stufe
 *     nach der neuen Matrix (Typ + Datei/Link, sonst nichts),
 *   - Belege ohne Quellenangabe (der neue CHECK weist sie ab),
 *   - Belege der oberen vier Typen ohne `gueltig_bis` (Pflicht ab Schritt 3),
 *   - die Dokument/Link-Belege einzeln, weil einer davon umgewidmet wird,
 *   - die namentlich genannten Belege (B-000001, B-000007, B-000009,
 *     B-000124) mit Herkunft (Seed oder von Hand) und referenzierendem Strom.
 *
 * Nach der Migration ist derselbe Lauf der Zielnachweis: "Wechsel" muss
 * dann 0 sein, weil die gespeicherte Stufe der neuen Matrix folgt.
 *
 * Bewusst ueber `typ::text`, damit das Skript vor UND nach dem
 * Enum-Umbau (dokument_link -> dokument, + webrecherche) laeuft.
 * Aufrufer: lese-diagnose.yml (Production, Leserolle) und deploy.yml
 * (Preview, nach der Migration).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

const OBERE_VIER = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"];
const GENANNT = ["B-000001", "B-000007", "B-000009", "B-000124"];

/** Neue Matrix (E34) als SQL-Ausdruck — Spiegel von deriveQualitaet nach 0021. */
const NEUE_STUFE = sql`
  case typ::text
    when 'betriebsdaten'      then case when datei_oder_link then 'A' else 'B' end
    when 'vertrag'            then case when datei            then 'A' else 'B' end
    when 'absichtserklaerung' then case when datei            then 'B' else 'C' end
    when 'angebot'            then case when datei_oder_link then 'B' else 'C' end
    when 'gespraech'          then 'C'
    when 'dokument'           then case when datei_oder_link then 'C' else 'D' end
    when 'dokument_link'      then case when datei_oder_link then 'C' else 'D' end
    when 'webrecherche'       then 'D'
  end`;

async function main() {
  const ziel = new URL(url!);
  console.log(`ABWEICHUNG host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);

  const [k] = await sql`
    select (select count(*)::int from materialart) as materialarten,
           (select count(*)::int from output_produkt) as produkte,
           (select count(*)::int from beleg) as belege,
           (select count(*)::int from drizzle.__drizzle_migrations) as migrationen`;
  console.log("KONTROLLE " + JSON.stringify(k));

  const [typen] = await sql`
    select string_agg(typ || '=' || n, ' ' order by n desc, typ) as verteilung
      from (select typ::text as typ, count(*)::int as n from beleg group by 1) t`;
  console.log(`TYPEN ${typen!.verteilung ?? "(leer)"}`);

  const [herkunft] = await sql`
    select count(*) filter (where metadata->>'seed' is not null)::int as seed,
           count(*) filter (where metadata->>'seed' is null)::int as von_hand
      from beleg`;
  console.log("HERKUNFT " + JSON.stringify(herkunft));

  // Grundlage: je Beleg die Merkmale, die die neue Matrix braucht.
  const zeilen = await sql`
    with f as (
      select beleg_nr, typ::text as typ, qualitaet::text as alt, gueltig_bis::text as gueltig_bis,
             metadata->>'seed' is not null as seed,
             coalesce(btrim(metadata->>'quellenangabe'), '') <> '' as quelle,
             coalesce(btrim(datei_key), '') <> '' as datei,
             (coalesce(btrim(datei_key), '') <> '' or coalesce(btrim(link_url), '') <> '') as datei_oder_link,
             extern_nachvollziehbar as extern,
             coalesce((metadata->>'amtlich')::boolean, false) as amtlich
        from beleg)
    select *, ${NEUE_STUFE} as neu from f order by beleg_nr`;

  const wechsel = zeilen.filter((z) => z.alt !== z.neu);
  console.log(`WECHSEL ${wechsel.length} von ${zeilen.length}`);
  const gruppen = new Map<string, number>();
  for (const w of wechsel) {
    const key = `${w.typ} ${w.alt}→${w.neu}${w.seed ? " (seed)" : ""}`;
    gruppen.set(key, (gruppen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...gruppen.entries()].sort()) console.log(`  ${n} × ${key}`);
  const wechselVonHand = wechsel.filter((w) => !w.seed);
  if (wechselVonHand.length)
    console.log(
      "  von Hand: " +
        wechselVonHand.map((w) => `${w.beleg_nr}(${w.typ} ${w.alt}→${w.neu})`).join(", "),
    );

  const ohneQuelle = zeilen.filter((z) => !z.quelle);
  console.log(
    `OHNE_QUELLE ${ohneQuelle.length}` +
      (ohneQuelle.length ? ": " + ohneQuelle.map((z) => z.beleg_nr).join(", ") : ""),
  );

  const ohneFrist = zeilen.filter((z) => OBERE_VIER.includes(z.typ as string) && !z.gueltig_bis);
  const ohneFristSeed = ohneFrist.filter((z) => z.seed).length;
  console.log(
    `GUELTIG_BIS_FEHLT ${ohneFrist.length} (seed ${ohneFristSeed}, von Hand ${ohneFrist.length - ohneFristSeed})` +
      (ohneFrist.length - ohneFristSeed
        ? ": " + ohneFrist.filter((z) => !z.seed).map((z) => `${z.beleg_nr}(${z.typ})`).join(", ")
        : ""),
  );

  const dokumente = zeilen.filter((z) => z.typ === "dokument_link" || z.typ === "dokument");
  console.log(`DOKUMENT ${dokumente.length}`);
  for (const d of dokumente)
    console.log(
      `  ${d.beleg_nr} ${d.typ} alt=${d.alt} neu=${d.neu} datei=${d.datei} link=${d.datei_oder_link && !d.datei} amtlich=${d.amtlich} extern=${d.extern} seed=${d.seed}`,
    );

  const genannt = await sql`
    select b.beleg_nr, b.typ::text as typ, b.qualitaet::text as stufe, b.gueltig_bis::text as gueltig_bis,
           b.metadata->>'seed' is not null as seed,
           b.metadata->>'quellenangabe' as quelle,
           coalesce(
             (select 'feedstock: ' || s.bezeichnung from biomassestrom s where s.beleg_id = b.id limit 1),
             (select 'output: ' || o.bezeichnung from output_bedarf o where o.beleg_id = b.id limit 1),
             (select 'region: ' || r.name from region r where r.bereitschaft_beleg_id = b.id limit 1),
             'kein Strom') as referenz
      from beleg b where b.beleg_nr = any(${sql.array(GENANNT)}::text[]) order by b.beleg_nr`;
  console.log(`GENANNT ${genannt.length} von ${GENANNT.length} vorhanden`);
  for (const g of genannt)
    console.log(
      `  ${g.beleg_nr} ${g.typ} stufe=${g.stufe} gueltig_bis=${g.gueltig_bis ?? "–"} seed=${g.seed} quelle="${g.quelle ?? ""}" ← ${g.referenz}`,
    );

  await sql.end();
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
