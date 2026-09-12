"use client";

import { useEffect, useRef, useState } from "react";

import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import type { FacettenOption } from "@/lib/stroeme-modell";

export interface FacettenChipDef {
  key: string;
  label: string;
  optionen: FacettenOption[];
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
  einheit = "Menge",
  preisLabel = "Preis",
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
      case "mengeMin":
        return { label: "Menge min", typ: "number", em: einheit };
      case "mengeMax":
        return { label: "Menge max", typ: "number", em: einheit };
      case "preisMin":
        return { label: preisLabel, typ: "number", em: "€", platzhalter: "min" };
      case "preisMax":
        return { label: " ", typ: "number", em: "€", platzhalter: "max" };
      case "vonAb":
        return { label: "Verfügbar ab", typ: "month" };
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
        return (
          <div key={f.key} data-pop className="pop-anchor">
            <button
              type="button"
              className={`fchip${sel.length || istOffen ? " aktiv" : ""}`}
              aria-haspopup="menu"
              aria-expanded={istOffen}
              onClick={() => {
                setOffeneFacette(istOffen ? null : f.key);
                setFacettenSuche("");
                setBereichOffen(false);
                if (!istOffen) onPopoverOffen?.();
              }}
            >
              {f.label}
              {sel.length > 0 && <span className="fchip-count">{sel.length}</span>}
            </button>
            {istOffen && (
              <div role="dialog" aria-label={f.label} className="pop pop--links" style={{ width: 280 }}>
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

      <div data-pop className="pop-anchor">
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
            style={{ width: bereichKeys.length > 2 ? 400 : 320 }}
          >
            {bereichKeys.map((k) => {
              const feld = bereichFeld(k);
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
