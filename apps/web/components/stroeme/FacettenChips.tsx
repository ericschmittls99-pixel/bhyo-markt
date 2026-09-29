"use client";

import { useEffect, useRef, useState } from "react";

import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { usePopoverLage } from "@/components/usePopoverLage";
import type { FacettenOption } from "@/lib/stroeme-modell";
import { HierarchieBaum } from "@/components/stroeme/HierarchieBaum";
import { leere, type Ebene, type Knoten } from "@/lib/hierarchie";
import { monatAnzeige, monatKanonisch } from "@/lib/eingabe-format";

export interface FacettenChipDef {
  key: string;
  label: string;
  /** Hinweis zum Filter (Tooltip am Chip, Zeile im Popover), z. B. die Bezugszeit. */
  hinweis?: string;
  optionen: FacettenOption[];
  /**
   * F5 PR B: Gruppierter Filter. Ist er gesetzt, traegt der Chip einen Baum
   * statt einer flachen Liste — dieselbe Chip-Huelle, anderer Inhalt.
   */
  hierarchie?: {
    baum: Knoten[];
    ebenen: Ebene[];
    /** Auswahl je Ebenen-Parameter. */
    auswahl: Record<string, string[]>;
    /** Zusammengeklappte Kurzfassung, z. B. „Baden-Württemberg, +2 Landkreise". */
    kurz: string;
    /** Wie viele Knoten ausdruecklich gewaehlt sind (fuer den Zaehler). */
    anzahl: number;
  };
}

/**
 * Facetten-Chips mit Glas-Popover (Suche, Checkbox-Menue, Auswahl aufheben)
 * plus "Weitere Filter"-Formular-Popover und Reset-X — aus FilterSortZeile
 * extrahiert (PR 6), geteilt zwischen stroeme. und karte. Die Werte leben im
 * Querystring (useUrlZustand); welche Bereichsfelder erscheinen, bestimmt
 * `bereichKeys` (stroeme.: 6, karte.: vonAb/erstellt).
 */
export function FacettenChips({
  facetten,
  auswahl,
  bereichKeys,
  bereich,
  bereichKompakt = false,
  einheit = "t/a",
  preisLabel = "Preis stofflich",
  mitReset,
  onReset,
  schliessSignal = 0,
  onPopoverOffen,
}: {
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereichKeys: readonly string[];
  bereich: Record<string, string>;
  bereichKompakt?: boolean;
  einheit?: string;
  preisLabel?: string;
  mitReset: boolean;
  onReset: () => void;
  /** Erhoeht der Parent den Zaehler, schliessen alle Popover (z. B. Sortmenue geoeffnet). */
  schliessSignal?: number;
  onPopoverOffen?: () => void;
}) {
  const { setze } = useUrlZustand();
  const [offeneFacette, setOffeneFacette] = useState<string | null>(null);
  const [facettenSuche, setFacettenSuche] = useState("");
  const [bereichOffen, setBereichOffen] = useState(false);
  const sucheRef = useRef<HTMLInputElement>(null);
  // Rückmeldung 1: Popover nie über den rechten Rand — gemeinsame Lage für
  // ströme., auswertung. und karte. (lib/popover-lage.ts).
  const facettenLage = usePopoverLage(offeneFacette);
  const bereichLage = usePopoverLage(bereichOffen);

  // Popover schliessen bei Klick ausserhalb / Escape / Parent-Signal.
  useEffect(() => {
    function onDown(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-pop]")) return;
      setOffeneFacette(null);
      setBereichOffen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      setOffeneFacette(null);
      setBereichOffen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (schliessSignal > 0) {
      setOffeneFacette(null);
      setBereichOffen(false);
    }
  }, [schliessSignal]);

  useEffect(() => {
    if (offeneFacette) sucheRef.current?.focus();
  }, [offeneFacette]);

  const bereichAnzahl = bereichKeys.filter((k) => (bereich[k] ?? "") !== "").length;

  function toggleWert(key: string, wert: string) {
    const sel = auswahl[key] ?? [];
    const neu = sel.includes(wert) ? sel.filter((v) => v !== wert) : [...sel, wert];
    setze({ [key]: neu });
  }

  const bereichFeld = (key: string) => {
    switch (key) {
      // F5 PR B: Menge und Preis sind in stofflich (t/a bzw. €/t) und
      // energetisch (MWh/a bzw. €/MWh, ueber Hu abgeleitet) getrennt —
      // vorher lagen alle Erfassungseinheiten auf einer Skala.
      case "mengeMin":
        return { label: "Menge stofflich min", typ: "number", em: einheit };
      case "mengeMax":
        return { label: "Menge stofflich max", typ: "number", em: einheit };
      case "preisMin":
        return { label: preisLabel, typ: "number", em: "€/t", platzhalter: "min" };
      case "preisMax":
        return { label: " ", typ: "number", em: "€/t", platzhalter: "max" };
      case "energieMengeMin":
        return { label: "Menge energetisch min", typ: "number", em: "MWh/a" };
      case "energieMengeMax":
        return { label: "Menge energetisch max", typ: "number", em: "MWh/a" };
      case "energiePreisMin":
        return { label: "Preis energetisch", typ: "number", em: "€/MWh", platzhalter: "min" };
      case "energiePreisMax":
        return { label: " ", typ: "number", em: "€/MWh", platzhalter: "max" };
      case "vollMin":
        return { label: "Vollständigkeit", typ: "number", em: "%", platzhalter: "min" };
      case "vollMax":
        return { label: " ", typ: "number", em: "%", platzhalter: "max" };
      case "vonAb":
        return { label: "Verfügbar ab", typ: "month" };
      // F5 PR B: Vergabefenster. Zwei Monatsgrenzen plus der benannte
      // Zustand — der bekommt ein Kaestchen, kein Textfeld.
      case "vergebenVon":
        return { label: "Vergeben ab", typ: "month" };
      case "vergebenBis":
        return { label: "Vergeben bis", typ: "month" };
      case "vergabeZustand":
        return { label: "auch nicht vergebene Ströme", typ: "zustand" };
      case "erstellt":
        return { label: "Erstellt am", typ: "date" };
      default:
        return { label: key, typ: "text" };
    }
  };

  return (
    <>
      {facetten.map((f) => {
        const sel = auswahl[f.key] ?? [];
        const istOffen = offeneFacette === f.key;
        const fq = facettenSuche.trim().toLowerCase();
        const optionen = istOffen
          ? f.optionen.filter((o) => !fq || o.label.toLowerCase().includes(fq))
          : [];
        const h = f.hierarchie;
        const aktiv = h ? h.anzahl > 0 : sel.length > 0;
        return (
          <div key={f.key} data-pop className="pop-anchor">
            <button
              type="button"
              className={`fchip${aktiv || istOffen ? " aktiv" : ""}`}
              aria-haspopup="menu"
              aria-expanded={istOffen}
              // Zusammengeklappt steht die Kurzfassung statt einer langen
              // Liste: "Baden-Württemberg, +2 Landkreise" sagt mehr als sechs
              // abgeschnittene Namen.
              title={h && h.kurz ? h.kurz : f.hinweis}
              onClick={() => {
                setOffeneFacette(istOffen ? null : f.key);
                setFacettenSuche("");
                setBereichOffen(false);
                if (!istOffen) onPopoverOffen?.();
              }}
            >
              {h && h.kurz ? h.kurz : f.label}
              {!h && sel.length > 0 && <span className="fchip-count">{sel.length}</span>}
              {h && h.anzahl > 1 && <span className="fchip-count">{h.anzahl}</span>}
            </button>
            {istOffen && h && (
              <div
                role="dialog"
                aria-label={f.label}
                className="pop pop--links"
                ref={facettenLage.popRef}
                style={{ width: 320, ...facettenLage.popStil }}
              >
                {h.anzahl > 0 && (
                  <>
                    <button
                      type="button"
                      className="menu-item"
                      // Ein Zuruecksetzen je Hierarchie, nicht je Ebene.
                      onClick={() => setze(leere(h.ebenen))}
                    >
                      <i className="ph-bold ph-x" aria-hidden />
                      <span className="lbl">Auswahl aufheben</span>
                    </button>
                    <div className="pop-divider" />
                  </>
                )}
                <HierarchieBaum
                  baum={h.baum}
                  ebenen={h.ebenen}
                  auswahl={h.auswahl}
                  onAuswahl={(neuA) =>
                    setze(
                      Object.fromEntries(
                        h.ebenen.map((e) => [
                          e.param,
                          (neuA[e.param] ?? []).join(",") || null,
                        ]),
                      ),
                    )
                  }
                />
              </div>
            )}
            {istOffen && !h && (
              <div
                role="dialog"
                aria-label={f.label}
                className="pop pop--links"
                ref={facettenLage.popRef}
                style={{ width: 280, ...facettenLage.popStil }}
              >
                {f.hinweis && (
                  <p className="pop-hinweis">
                    <i className="ph ph-info" aria-hidden />
                    {f.hinweis}
                  </p>
                )}
                <div className="pop-suche">
                  <div className="search search--sm">
                    <i className="ph ph-magnifying-glass" aria-hidden />
                    <input
                      ref={sucheRef}
                      type="search"
                      value={facettenSuche}
                      onChange={(e) => setFacettenSuche(e.target.value)}
                      placeholder={`${f.label} suchen`}
                      aria-label={`${f.label} suchen`}
                    />
                  </div>
                </div>
                <div className="menu" role="menu">
                  {sel.length > 0 && optionen.length > 0 && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => setze({ [f.key]: null })}
                      >
                        <i className="ph-bold ph-x" aria-hidden />
                        <span className="lbl">Auswahl aufheben</span>
                      </button>
                      <div className="pop-divider" />
                    </>
                  )}
                  {optionen.map((o) => (
                    <button
                      key={o.wert}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={sel.includes(o.wert)}
                      className="menu-item"
                      onClick={() => toggleWert(f.key, o.wert)}
                    >
                      <span className={`check${sel.includes(o.wert) ? " an" : ""}`} aria-hidden>
                        {sel.includes(o.wert) && <i className="ph-bold ph-check" />}
                      </span>
                      <span className="lbl">{o.label}</span>
                    </button>
                  ))}
                  {optionen.length === 0 && <p className="menu-leer">keine treffer.</p>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div data-pop className="pop-anchor fc-weitere">
        <button
          type="button"
          className={`fchip${bereichAnzahl || bereichOffen ? " aktiv" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={bereichOffen}
          aria-label="Weitere Filter"
          onClick={() => {
            setBereichOffen((v) => !v);
            setOffeneFacette(null);
            if (!bereichOffen) onPopoverOffen?.();
          }}
        >
          {bereichKompakt ? <i className="ph-bold ph-plus" aria-hidden /> : "Weitere Filter"}
          {bereichAnzahl > 0 && <span className="fchip-count">{bereichAnzahl}</span>}
        </button>
        {bereichOffen && (
          <div
            role="dialog"
            aria-label="Weitere Filter"
            className="pop pop--links pop--form"
            ref={bereichLage.popRef}
            style={{ width: bereichKeys.length > 2 ? 400 : 320, ...bereichLage.popStil }}
          >
            {bereichKeys.map((k) => {
              const feld = bereichFeld(k);
              // Der benannte Zustand ist ein Kaestchen, kein Textfeld —
              // sonst saehe eine Wahl wie eine Eingabe aus.
              if (feld.typ === "zustand") {
                const an = (bereich[k] ?? "") !== "";
                return (
                  <label className="pf pf--zustand" key={k}>
                    <input
                      type="checkbox"
                      checked={an}
                      onChange={(e) =>
                        setze({ [k]: e.target.checked ? "nicht_vergeben" : null })
                      }
                    />
                    <span>{feld.label}</span>
                  </label>
                );
              }
              if (feld.typ === "month") {
                // E31: Monate als eigenes MM/JJJJ-Feld, nie type="month" —
                // dessen Verhalten haengt an Engine und Sprache des Browsers.
                return (
                  <label className="pf" key={k}>
                    <span>{feld.label}</span>
                    <span className="pf-feld">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="MM/JJJJ"
                        maxLength={7}
                        value={monatAnzeige(bereich[k] ?? "")}
                        onChange={(e) =>
                          setze({ [k]: monatKanonisch(e.target.value) || null })
                        }
                      />
                    </span>
                  </label>
                );
              }
              return (
                <label className="pf" key={k}>
                  <span aria-hidden={feld.label === " " || undefined}>
                    {feld.label}
                  </span>
                  <span className="pf-feld">
                    <input
                      type={feld.typ}
                      inputMode={feld.typ === "number" ? "decimal" : undefined}
                      placeholder={feld.platzhalter}
                      value={bereich[k] ?? ""}
                      onChange={(e) => setze({ [k]: e.target.value })}
                    />
                    {feld.em && <em>{feld.em}</em>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {mitReset && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Filter zurücksetzen"
          onClick={onReset}
        >
          <i className="ph-bold ph-x" aria-hidden />
        </button>
      )}
    </>
  );
}
