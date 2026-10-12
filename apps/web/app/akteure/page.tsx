import { AkteureListe } from "@/components/akteure/AkteureListe";
import { EmptyState } from "@/components/shell/EmptyState";
import { ladeAkteure } from "@/lib/akteure";
import { AKTEUR_WEITERE_FILTER, filterAkteure, sortiereAkteure, type AkteureFilter } from "@/lib/akteure-modell";
import { withDb } from "@/lib/db";
import { ladeDubletten } from "@/lib/dubletten";
import { filterHinweis, filterLabel, leiste } from "@/lib/filter-modell";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeRegionOptionen } from "@/lib/stroeme";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const liste = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
const erster = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * akteure. (AP2.5 PR a1, E66): Stammdaten der Akteure mit dem Filtermodell
 * (E32, Ansicht „akteure"): Sektor / Akteur und die benannten Zustaende
 * unvollstaendig, ohne Beleg, verwaist (abgeleitet, lib/akteure-modell.ts).
 * Angelegt wird ein Akteur nur im Beleg; hier wird gepflegt.
 */
export default async function AkteurePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const zugang = await aktuellerZugang();
  if (zugang.art !== "erlaubt") {
    return (
      <main className="ak ak-leer">
        <EmptyState icon="buildings" titel="akteure." beschreibung="Kein Zugang." />
      </main>
    );
  }
  const filter: AkteureFilter = { q: erster(sp.q), region: liste(sp.region), sektor: liste(sp.sektor), akteur: liste(sp.akteur), akteur_zustand: liste(sp.akteur_zustand) };
  const [geladen, regionen, dubletten] = await Promise.all([withDb((db) => ladeAkteure(db)), ladeRegionOptionen(), withDb((db) => ladeDubletten(db))]);
  // E77 R2: Dublettenverdacht aus demselben Ursprung wie die Dubletten-Seite (ohne „keine Dublette").
  const verdacht = new Set(dubletten.flatMap((p) => [p.a.id, p.b.id]));
  const pool = geladen.map((a) => ({ ...a, dublettenverdacht: verdacht.has(a.id) }));
  const gefiltert = sortiereAkteure(filterAkteure(pool, filter));
  // Optionen aus dem UNGEFILTERTEN Bestand (wie in stroeme.) — der Chip zeigt, was es gibt.
  const sektoren = new Map<string, string>();
  for (const a of pool) sektoren.set(a.sektor, a.sektorLabel);
  const optionen = {
    region: regionen.map((r) => ({ wert: r.id, label: r.name })),
    akteur: [...sektoren.entries()].map(([wert, label]) => ({ wert, label })).sort((a, b) => a.label.localeCompare(b.label, "de")),
    akteur_zustand: [...AKTEUR_WEITERE_FILTER],
  };
  const lst = leiste("akteure", "alle", filter as unknown as Record<string, unknown>, optionen);
  const alleFacetten = [...lst.haupt, ...lst.weitere].filter((e) => e.def.typ === "facette" || e.def.typ === "hierarchie");
  const chip = (e: (typeof alleFacetten)[number]) => ({ key: e.def.params[0]!, label: filterLabel(e.def, "akteure"), hinweis: filterHinweis(e.def, "akteure"), optionen: e.optionen });
  const facetten = alleFacetten.filter((e) => e.def.darstellung !== "kaestchen").map(chip);
  // E77 R2: die abgeleiteten Zustaende als Kaestchen unter „Weitere Filter".
  const weitereFacetten = alleFacetten.filter((e) => e.def.darstellung === "kaestchen").map(chip);
  return (
    <main className="ak">
      <AkteureListe
        zeilen={gefiltert}
        gesamt={pool.length}
        facetten={facetten}
        weitereFacetten={weitereFacetten}
        auswahl={lst.auswahl}
        irgendeinFilter={lst.irgendeinFilter || filter.q.trim() !== ""}
        ruecksetzParams={lst.ruecksetzParams}
        q={filter.q}
        dubletten={dubletten.length}
      />
    </main>
  );
}
