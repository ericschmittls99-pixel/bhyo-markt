"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
 * plus "Weitere Filter"-Formular-Popover — aus FilterSortZeile extrahiert
 * (PR 6), geteilt zwischen stroeme., karte., auswertung. und akteure. Die
 * Werte leben im Querystring (useUrlZustand); welche Bereichsfelder
 * erscheinen, bestimmt `bereichKeys` (stroeme.: 6, karte.: vonAb/erstellt).
 *
 * E77 R2: Die Popover haengen als Portal am Body mit fester Lage (die
 * Chip-Leiste scrollt horizontal und wuerde sie sonst abschneiden); „Filter
 * entfernen" sitzt bei den Eltern neben dem Filter-Knopf (FilterEntfernen);
 * ohne weitere Filter gibt es keinen „Weitere Filter"-Knopf; `weitereFacetten`
 * sind Mehrfachauswahlen, die als Kaestchengruppe im Popover stehen statt
 * als Chip (akteure.: die abgeleiteten Zustaende).
 */
export function FacettenChips({
  facetten,
  auswahl,
  bereichKeys,
  bereich,
  bereichKompakt = false,
  einheit = "t/a",
  preisLabel = "Preis stofflich",
  weitereFacetten = [],
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
  /** E77 R2: Facetten als Kaestchengruppe im Popover „Weitere Filter" (Werte wie bei Chips: Liste im Querystring). */
  weitereFacetten?: FacettenChipDef[];
  /** Erhoeht der Parent den Zaehler, schliessen alle Popover (z. B. Sortmenue geoeffnet). */
  schliessSignal?: number;
  onPopoverOffen?: () => void;
}) {
  const { setze } = useUrlZustand();
  const [offeneFacette, setOffeneFacette] = useState<string | null>(null);
  const [facettenSuche, setFacettenSuche] = useState("");
  const [bereichOffen, setBereichOffen] = useState(false);
  const sucheRef = useRef<HTMLInputElement>(null);
  const ankerRefs = useRef<Record<string, HTMLElement | null>>({});
  const bereichAnkerRef = useRef<HTMLButtonElement>(null);
  // Rückmeldung 1: Popover nie über den rechten Rand — gemeinsame Lage für
  // ströme., auswertung., karte. und akteure. (lib/popover-lage.ts); E77 R2
  // fixiert am Anker (Portal).
  const facettenAnker = useCallback(() => (offeneFacette ? (ankerRefs.current[offeneFacette] ?? null) : null), [offeneFacette]);
  const bereichAnker = useCallback(() => bereichAnkerRef.current, []);
  const facettenLage = usePopoverLage(offeneFacette, { fixiert: true, anker: facettenAnker });
  const bereichLage = usePopoverLage(bereichOffen, { fixiert: true, anker: bereichAnker });

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

  const bereichAnzahl =
    bereichKeys.filter((k) => (bereich[k] ?? "") !== "").length +
    weitereFacetten.reduce((n, f) => n + (auswahl[f.key]?.length ?? 0), 0);
  const mitWeiteren = bereichKeys.length > 0 || weitereFacetten.length > 0;

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
              ref={(el) => {
                ankerRefs.current[f.key] = el;
              }}
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
            {istOffen && h && createPortal(
              <div
                data-pop
                role="dialog"
                aria-label={f.label}
                className="pop pop--links pop--fixiert"
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
              </div>,
              document.body,
            )}
            {istOffen && !h && createPortal(
              <div
                data-pop
                role="dialog"
                aria-label={f.label}
                className="pop pop--links pop--fixiert"
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
              </div>,
              document.body,
            )}
          </div>
        );
      })}

      {mitWeiteren && (
      <div data-pop className="pop-anchor fc-weitere">
        <button
          ref={bereichAnkerRef}
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
        {bereichOffen && createPortal(
          <div
            data-pop
            role="dialog"
            aria-label="Weitere Filter"
            className="pop pop--links pop--form pop--fixiert"
            ref={bereichLage.popRef}
            style={{ width: bereichKeys.length > 2 ? 400 : 320, ...bereichLage.popStil }}
          >
            {weitereFacetten.map((f) => {
              const sel = auswahl[f.key] ?? [];
              return (
                <fieldset className="pf pf--gruppe" key={f.key}>
                  <legend>{f.label}</legend>
                  {f.optionen.map((o) => (
                    <label className="pf pf--zustand" key={o.wert}>
                      <input type="checkbox" checked={sel.includes(o.wert)} onChange={() => toggleWert(f.key, o.wert)} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
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
          </div>,
          document.body,
        )}
      </div>
      )}
    </>
  );
}
