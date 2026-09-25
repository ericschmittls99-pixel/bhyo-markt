"use client";

import { useMemo, useRef, useState } from "react";

import {
  kurzfassung,
  schalte,
  zustand,
  type Auswahl,
  type Ebene,
  type Knoten,
  type Zustand,
} from "@/lib/hierarchie";

/**
 * Gruppierter Filter als Baum mit Mehrfachauswahl (F5 PR B) — EIN Bauteil für
 * Cluster → Materialart, Gruppe → Produkt und Bundesland → Landkreis → Ort.
 *
 * **Aufklappen und Auswählen sind getrennte Ziele** (Vorgabe Eric,
 * 25.09.2026):
 * - der **Pfeil** klappt auf und zu,
 * - das **Kästchen** wählt,
 * - der **Name** wählt ebenfalls — eine Festlegung, und sie gilt auf jeder
 *   Ebene gleich. Wer aufklappen will, trifft den Pfeil; wer wählen will,
 *   trifft die deutlich größere Fläche aus Kästchen und Name.
 *
 * Beide Ziele sind mindestens 32 px hoch, damit sie sich nicht verwechseln
 * lassen.
 *
 * **Implizit Gewähltes ist einzeln abwählbar.** Es ist erkennbar anders
 * dargestellt (gestricheltes Kästchen, zurückgenommener Name), aber nicht
 * gesperrt — der gewählte Vorfahre löst sich beim Abwählen automatisch in
 * seine übrigen Kinder auf.
 */
export function HierarchieBaum({
  baum,
  ebenen,
  auswahl,
  onAuswahl,
}: {
  baum: Knoten[];
  ebenen: Ebene[];
  auswahl: Auswahl;
  onAuswahl: (neu: Auswahl) => void;
}) {
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const listeRef = useRef<HTMLDivElement>(null);

  function klappe(wert: string) {
    setOffen((alt) => {
      const neu = new Set(alt);
      if (neu.has(wert)) neu.delete(wert);
      else neu.add(wert);
      return neu;
    });
  }

  /**
   * Tastatur ohne Mausanschluss: ↑/↓ bewegen, →/← klappen auf und zu,
   * Leertaste wählt. Bewegt wird über die tatsächlich sichtbaren Zeilen —
   * eingeklappte Kinder sind nicht erreichbar, weil sie nicht da sind.
   */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const ziel = e.target as HTMLElement;
    const zeile = ziel.closest<HTMLElement>("[data-zeile]");
    if (!zeile) return;
    const alle = [...(listeRef.current?.querySelectorAll<HTMLElement>("[data-zeile]") ?? [])];
    const i = alle.indexOf(zeile);
    const wert = zeile.dataset.wert!;
    const hatKinder = zeile.dataset.kinder === "ja";

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        alle[Math.min(i + 1, alle.length - 1)]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        alle[Math.max(i - 1, 0)]?.focus();
        break;
      case "ArrowRight":
        if (hatKinder && !offen.has(wert)) {
          e.preventDefault();
          klappe(wert);
        }
        break;
      case "ArrowLeft":
        if (hatKinder && offen.has(wert)) {
          e.preventDefault();
          klappe(wert);
        }
        break;
      case " ":
        e.preventDefault();
        onAuswahl(schalte(baum, ebenen, auswahl, +zeile.dataset.tiefe!, wert));
        break;
    }
  }

  function zeilen(knoten: Knoten[], tiefe: number, elternGewaehlt: boolean) {
    return knoten.map((k) => {
      const z: Zustand = zustand(k, tiefe, ebenen, auswahl, elternGewaehlt);
      // Implizit = durch einen Vorfahren mitgewählt, nicht selbst angeklickt.
      // Beides ist „gewählt", aber wer BW gewählt hat, soll nicht glauben,
      // er habe jeden Kreis einzeln geklickt.
      const implizit = elternGewaehlt;
      const hatKinder = (k.kinder?.length ?? 0) > 0;
      const auf = offen.has(k.wert);

      return (
        <div key={`${tiefe}-${k.wert}`} className="hb-ast">
          <div
            data-zeile
            data-wert={k.wert}
            data-tiefe={tiefe}
            data-kinder={hatKinder ? "ja" : "nein"}
            className={`hb-zeile hb-zeile--${z}${implizit ? " hb-zeile--implizit" : ""}`}
            style={{ paddingLeft: 8 + tiefe * 18 }}
            tabIndex={0}
            role="treeitem"
            aria-selected={z === "gewaehlt"}
            aria-expanded={hatKinder ? auf : undefined}
          >
            {hatKinder ? (
              <button
                type="button"
                className="hb-pfeil"
                aria-label={auf ? `${k.label} zuklappen` : `${k.label} aufklappen`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  klappe(k.wert);
                }}
              >
                <i className={`ph-bold ph-caret-${auf ? "down" : "right"}`} aria-hidden />
              </button>
            ) : (
              <span className="hb-pfeil hb-pfeil--leer" aria-hidden />
            )}

            <button
              type="button"
              className="hb-waehlen"
              tabIndex={-1}
              // Implizit Gewähltes ist einzeln abwählbar (Vorgabe Eric,
              // 25.09.2026): Der gewählte Vorfahre wird dabei automatisch in
              // seine übrigen Kinder aufgelöst. Ohne das müsste, wer „BW
              // außer einem Kreis" will, dieselbe Auswahl mühsam von Hand
              // zusammenklicken.
              title={implizit ? "Über die übergeordnete Ebene gewählt" : undefined}
              onClick={() => onAuswahl(schalte(baum, ebenen, auswahl, tiefe, k.wert))}
            >
              <span className={`hb-kaestchen hb-kaestchen--${z}`} aria-hidden>
                {z === "gewaehlt" && <i className="ph-bold ph-check" aria-hidden />}
                {z === "teilweise" && <span className="hb-strich" />}
              </span>
              <span className="hb-label">{k.label}</span>
            </button>
          </div>

          {hatKinder && auf && (
            <div role="group">{zeilen(k.kinder!, tiefe + 1, z === "gewaehlt")}</div>
          )}
        </div>
      );
    });
  }

  return (
    <div
      ref={listeRef}
      className="hb"
      role="tree"
      aria-label={ebenen.map((e) => e.label).join(" → ")}
      onKeyDown={onKey}
    >
      {baum.length === 0 ? (
        <p className="hb-leer">Keine Einträge im aktuellen Bestand.</p>
      ) : (
        zeilen(baum, 0, false)
      )}
    </div>
  );
}

/** Kurzfassung für den zusammengeklappten Chip — „Baden-Württemberg, +2 Landkreise". */
export function useKurzfassung(baum: Knoten[], ebenen: Ebene[], auswahl: Auswahl) {
  return useMemo(() => kurzfassung(baum, ebenen, auswahl), [baum, ebenen, auswahl]);
}
