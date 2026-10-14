"use client";

import Link from "next/link";
import { useState } from "react";

import { ChipLeiste } from "@/components/stroeme/ChipLeiste";
import { FacettenChips, type FacettenChipDef } from "@/components/stroeme/FacettenChips";
import { FilterEntfernen } from "@/components/stroeme/FilterEntfernen";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { AKTEUR_ZUSTAND_LABEL, sitzText, zustaendeAus, type AkteurZeile } from "@/lib/akteure-modell";
import { ruecksetzPatchAus } from "@/lib/filter-modell";

/**
 * Liste der Akteure (AP2.5 PR a1): Kopfzeile mit Suche und den Facetten-Chips
 * des Filtermodells (dieselbe Huelle wie stroeme.), Tabelle mit Sektor, Sitz,
 * Kreis, Stroemen und den Zustands-Pillen (unvollstaendig / ohne Beleg /
 * verwaist — zurueckgenommene Pillen, keine Ampel).
 */
export function AkteureListe({
  zeilen,
  gesamt,
  facetten,
  weitereFacetten,
  auswahl,
  irgendeinFilter,
  ruecksetzParams,
  q,
  dubletten,
}: {
  zeilen: AkteurZeile[];
  gesamt: number;
  facetten: FacettenChipDef[];
  /** E77 R2: die abgeleiteten Zustaende als Kaestchen unter „Weitere Filter". */
  weitereFacetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  irgendeinFilter: boolean;
  ruecksetzParams: readonly string[];
  q: string;
  /** AP2.5 PR c: Zahl der moeglichen Dubletten (Link zur Liste). */
  dubletten: number;
}) {
  const { setze, searchParams } = useUrlZustand();
  const [suche, setSuche] = useState(q);
  // E77 R6: der Akteur oeffnet als Sidebar ueber der Liste — Filter und Suche bleiben in der URL.
  const akteurHref = (id: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("detail", id);
    p.delete("reiter");
    return `/akteure?${p.toString()}`;
  };
  return (
    <>
      <div className="st-toolbar aw-kopfzeile ak-kopf">
        <form
          className="ak-suche"
          onSubmit={(e) => {
            e.preventDefault();
            setze({ q: suche.trim() || null });
          }}
        >
          <span className="pf-feld">
            <input type="search" placeholder="Name, Ort oder PLZ suchen" value={suche} onChange={(e) => setSuche(e.target.value)} aria-label="Akteure suchen" />
          </span>
        </form>
        <span className="st-count">
          {zeilen.length} von {gesamt} {gesamt === 1 ? "Akteur" : "Akteuren"}
          {irgendeinFilter ? " gefiltert" : ""}
        </span>
        {irgendeinFilter && (
          <FilterEntfernen
            onClick={() => {
              setSuche("");
              setze(ruecksetzPatchAus(ruecksetzParams));
            }}
          />
        )}
        <Link href="/akteure/dubletten" className="btn btn--ghost btn--sm">
          <i className="ph ph-copy" aria-hidden />
          mögliche Dubletten{dubletten ? ` (${dubletten})` : ""}
        </Link>
      </div>
      <ChipLeiste className="st-chips ak-chips">
        <FacettenChips facetten={facetten} weitereFacetten={weitereFacetten} auswahl={auswahl} bereichKeys={[]} bereich={{}} />
      </ChipLeiste>
      {zeilen.length === 0 ? (
        <p className="ov-note ak-leer-text">Keine Akteure für diese Auswahl.</p>
      ) : (
        <table className="einst-tabelle ak-tabelle">
          <thead>
            <tr>
              <th>Akteur</th>
              <th>Sektor</th>
              <th>Sitz</th>
              <th>Kreis</th>
              <th className="param-wert">Ströme</th>
              <th>Zustand</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((a) => {
              const z = zustaendeAus(a);
              return (
                <tr key={a.id}>
                  <td>
                    <Link href={akteurHref(a.id)} className="ak-link" scroll={false}>
                      <strong>{a.name}</strong>
                    </Link>
                  </td>
                  <td>{a.sektorLabel}</td>
                  <td>{sitzText(a)}</td>
                  <td>{a.kreisName ?? <span className="c">–</span>}</td>
                  <td className="param-wert">
                    {a.stroeme}
                    {a.stroeme > 0 && <span className="c"> · {a.mitBeleg} mit Beleg</span>}
                  </td>
                  <td>
                    <span className="ak-pillen">
                      {z.length === 0 && <span className="pill pill--muted">vollständig</span>}
                      {z.map((w) => (
                        <span key={w} className="pill pill--muted">
                          {AKTEUR_ZUSTAND_LABEL[w]}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
