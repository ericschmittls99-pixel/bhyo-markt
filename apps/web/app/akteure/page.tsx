import { redirect } from "next/navigation";

import { AkteurDetail, AkteurNichtGefunden } from "@/components/akteure/AkteurDetail";
import { AkteureListe } from "@/components/akteure/AkteureListe";
import { EmptyState } from "@/components/shell/EmptyState";
import { ladeAkteur, ladeAkteure, ladeAkteurStroeme, ladeAkteurVerlauf } from "@/lib/akteure";
import { AKTEUR_WEITERE_FILTER, filterAkteure, sortiereAkteure, type AkteureFilter } from "@/lib/akteure-modell";
import { withDb } from "@/lib/db";
import { ladeDubletten, zielNachZusammenfuehrung } from "@/lib/dubletten";
import { filterHinweis, filterLabel, leiste } from "@/lib/filter-modell";
import { ladeKommentare } from "@/lib/kommentare";
import { ladeKontaktpersonen } from "@/lib/kontaktpersonen";
import { darfRolle } from "@/lib/rechte";
import { ladeZuweisbare } from "@/lib/rechte/sperre-server";
import { aktuellerZugang } from "@/lib/rechte/wache";
import { ladeSektoren } from "@/lib/register";
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
 *
 * E77 R6: `?detail=<id>` (wie die Strom-Sidebar; `akteur` ist hier die Facette
 * Sektor / Akteur) oeffnet den Akteur als Sidebar ueber der Liste
 * (AkteurDetail) — dieselbe Huelle wie die Strom-Sidebar in stroeme.;
 * `&reiter=kontaktpersonen` rollt zum Abschnitt (alte Links, Inbox). Die
 * Kennung einer zusammengefuehrten Quelle leitet ueber das Protokoll aufs Ziel.
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
  // E77 R6: Sidebar-Daten nur, wenn ein Akteur gewaehlt ist (dieselben Lader wie die fruehere Seite).
  const akteurId = erster(sp.detail);
  const reiter = erster(sp.reiter) === "kontaktpersonen" ? ("kontaktpersonen" as const) : null;
  let detail: Awaited<ReturnType<typeof ladeDetail>> | "fehlt" | null = null;
  if (akteurId) {
    detail = await ladeDetail(akteurId);
    if (!detail) {
      const ziel = await withDb((db) => zielNachZusammenfuehrung(db, akteurId));
      if (ziel) {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(sp)) for (const w of Array.isArray(v) ? v : v ? [v] : []) p.append(k, w);
        p.set("detail", ziel);
        redirect(`/akteure?${p.toString()}`);
      }
      detail = "fehlt";
    }
  }
  const darfKommentieren = darfRolle(zugang, "kommentar.erstellen");
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
      {detail === "fehlt" && <AkteurNichtGefunden />}
      {detail && detail !== "fehlt" && (
        <AkteurDetail
          akteur={detail.a}
          sektoren={detail.sektoren.filter((s) => s.aktiv || s.code === detail.a.sektor)}
          darfBearbeiten={darfRolle(zugang, "akteur.bearbeiten")}
          darfLoeschen={darfRolle(zugang, "akteur.loeschen") && detail.a.stroeme === 0}
          standorte={detail.stroeme.filter((s) => s.lng != null && s.lat != null).map((s) => ({ id: s.id, lng: s.lng!, lat: s.lat!, label: s.bezeichnung ?? s.belegNr ?? s.art }))}
          stroeme={detail.stroeme}
          personen={detail.personen}
          kontaktRechte={{
            schreiben: darfRolle(zugang, "kontaktperson.anlegen"),
            loeschen: darfRolle(zugang, "kontaktperson.loeschen"),
            auskunft: darfRolle(zugang, "kontaktperson.auskunft"),
          }}
          verlauf={detail.verlauf}
          kommentare={detail.kommentare}
          kommentarZugang={{ id: zugang.id, rolle: zugang.rolle }}
          darfKommentieren={darfKommentieren}
          erwaehnbare={darfKommentieren ? await withDb((db) => ladeZuweisbare(db)) : []}
          fokus={reiter}
        />
      )}
    </main>
  );
}

/** Alles fuer die Sidebar eines Akteurs; null, wenn es ihn nicht (mehr) gibt. */
async function ladeDetail(id: string) {
  const [a, stroeme, sektoren, personen, verlauf, kommentare] = await Promise.all([
    withDb((db) => ladeAkteur(db, id)),
    withDb((db) => ladeAkteurStroeme(db, id)),
    ladeSektoren(),
    withDb((db) => ladeKontaktpersonen(db, id)),
    withDb((db) => ladeAkteurVerlauf(db, id)),
    withDb((db) => ladeKommentare(db, { art: "akteur", id })),
  ]);
  if (!a) return null;
  return { a, stroeme, sektoren, personen, verlauf, kommentare };
}
