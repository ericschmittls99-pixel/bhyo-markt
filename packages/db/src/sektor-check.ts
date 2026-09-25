/**
 * F5 PR B: dauerhafter DB-Check der Sektor-Referenzdaten — laeuft im
 * Deploy-CI bei jedem PR gegen die echte Preview-DB. Drei Zusicherungen:
 *
 * 1. Die acht Werte stehen in der Referenztabelle.
 * 2. Kein Akteur traegt einen Sektor, den es dort nicht gibt (der
 *    Fremdschluessel sichert das — der Check belegt, dass er auch greift).
 * 3. `abnehmer` ist KEIN Sektor mehr. Er war eine Rolle, kein Sektor; kaeme
 *    er zurueck, stuende in der Auswahlliste wieder ein Wert, der etwas
 *    anderes bedeutet als alle uebrigen.
 * 4. Die beiden Schreibfaelle der Akteur-Anlage (POST /api/akteure) gehen
 *    durch: neuer Akteur MIT Sektor aus der Liste, neuer Akteur OHNE Sektor.
 *    Nachweis nach E21 gegen die echte Tabelle mit Fremdschluessel, in einer
 *    zurueckgerollten Transaktion — nichts bleibt liegen. Der Fall fehlte im
 *    Nachweis zu 0020; die Combobox schickte Freitext, und die Anlage brach
 *    auf Production (25.09.2026).
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

const ERWARTET = [
  "abfallwirtschaft",
  "energie",
  "forstwirtschaft",
  "holzwirtschaft",
  "industrie",
  "kommunal",
  "landwirtschaft",
  "lebensmittel",
];

async function main() {
  const ziel = new URL(url!);
  console.log(`SEKTORCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  const codes = (await sql`select code from sektor order by code`).map((r) => r.code as string);
  console.log("SEKTOREN " + JSON.stringify(codes));
  for (const e of ERWARTET) if (!codes.includes(e)) fehler.push(`Sektor ${e} fehlt`);
  if (codes.includes("abnehmer")) {
    fehler.push("'abnehmer' ist wieder als Sektor eingetragen — das ist eine Rolle");
  }

  const [z] = await sql`
    select count(*)::int as akteure,
           count(*) filter (where sektor is null)::int as ohne_sektor,
           count(*) filter (where sektor is not null
             and not exists (select 1 from sektor s where s.code = akteur.sektor))::int as unbekannt
      from akteur`;
  console.log("AKTEURE " + JSON.stringify(z));
  if ((z!.unbekannt as number) > 0) {
    fehler.push(`${z!.unbekannt} Akteure mit unbekanntem Sektor`);
  }

  // Der Fremdschluessel muss greifen, nicht nur dastehen.
  let abgewiesen = false;
  try {
    await sql`insert into akteur (name, sektor, status) values ('Sektor-Testzeile', 'gibt-es-nicht', 'entwurf')`;
    await sql`delete from akteur where name = 'Sektor-Testzeile'`;
  } catch {
    abgewiesen = true;
  }
  console.log(`FREMDSCHLUESSEL_GREIFT ${abgewiesen}`);
  if (!abgewiesen) fehler.push("Ein unbekannter Sektor liess sich einfuegen");

  // Schreibpfad Akteur-Anlage: mit Sektor und ohne — beides muss durchgehen.
  const ROLLBACK = Symbol("rollback");
  const faelle: [string, string | null][] = [
    ["mit Sektor", codes[0] ?? "energie"],
    ["ohne Sektor", null],
  ];
  for (const [fall, wert] of faelle) {
    let angelegt = false;
    try {
      await sql.begin(async (tx) => {
        const [row] = await tx`insert into akteur (name, sektor, status)
          values ('Sektor-Testzeile', ${wert}, 'entwurf') returning id, sektor`;
        angelegt = !!row && row.sektor === wert;
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) console.error(e);
    }
    console.log(`ANLAGE_${fall === "mit Sektor" ? "MIT" : "OHNE"}_SEKTOR ${angelegt}`);
    if (!angelegt) fehler.push(`Akteur-Anlage ${fall} scheitert am Schema`);
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::SEKTOR-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Sektor-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
