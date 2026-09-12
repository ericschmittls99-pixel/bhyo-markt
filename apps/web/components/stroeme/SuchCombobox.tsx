"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboOption {
  wert: string;
  label: string;
  meta?: string;
}

/**
 * Generische Such-Combobox im V2-Look (PR 5): Textfeld filtert die Optionen,
 * Popover mit Pfeiltasten/Enter/Escape, Klick ausserhalb schliesst. Mit
 * `freitext` (E7 Landkreis) wird die getippte Eingabe selbst zum Wert. Ein
 * gespeicherter Wert ohne passende Option wird als Zusatzoption angezeigt,
 * nie still verworfen.
 */
export function SuchCombobox({
  label,
  name,
  wert,
  onWert,
  optionen,
  placeholder,
  pflicht,
  freitext,
  fehler,
  deaktiviert,
}: {
  label: string;
  name: string;
  wert: string;
  onWert: (v: string) => void;
  optionen: ComboOption[];
  placeholder?: string;
  pflicht?: boolean;
  freitext?: boolean;
  fehler?: string;
  deaktiviert?: boolean;
}) {
  const [offen, setOffen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = zeigt Label des Werts
  const [aktiv, setAktiv] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);

  const alleOptionen = useMemo(() => {
    if (!wert || freitext || optionen.some((o) => o.wert === wert)) return optionen;
    // Alt-Wert (z. B. historische Einheit) sichtbar halten statt still verwerfen.
    return [{ wert, label: wert, meta: "gespeicherter Wert" }, ...optionen];
  }, [optionen, wert, freitext]);

  const anzeige =
    query ?? (wert ? (alleOptionen.find((o) => o.wert === wert)?.label ?? wert) : "");

  const treffer = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return alleOptionen;
    return alleOptionen.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || (o.meta ?? "").toLowerCase().includes(q),
    );
  }, [alleOptionen, query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) zu();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    if (!offen) return;
    listeRef.current
      ?.querySelector(`[data-idx="${aktiv}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [aktiv, offen]);

  function zu() {
    setOffen(false);
    if (query != null && freitext) onWert(query.trim());
    setQuery(null);
  }

  function waehle(o: ComboOption) {
    onWert(o.wert);
    setOffen(false);
    setQuery(null);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!offen) return setOffen(true);
      const d = e.key === "ArrowDown" ? 1 : -1;
      setAktiv((i) => Math.min(treffer.length - 1, Math.max(0, i + d)));
    } else if (e.key === "Enter") {
      if (offen && treffer[aktiv]) {
        e.preventDefault();
        waehle(treffer[aktiv]);
      } else if (freitext) {
        zu();
      }
    } else if (e.key === "Escape" && offen) {
      e.stopPropagation();
      zu();
    }
  }

  const listboxId = `scb-${name}`;
  return (
    <label className="pf" ref={box as never} style={{ position: "relative" }}>
      <span>
        {label}
        {pflicht && <em className="pf-pflicht" aria-hidden> *</em>}
      </span>
      <input type="hidden" name={name} value={freitext && query != null ? query.trim() : wert} />
      <span className="pf-feld scb-feld">
        <input
          type="text"
          role="combobox"
          aria-expanded={offen}
          aria-controls={listboxId}
          aria-invalid={fehler ? true : undefined}
          autoComplete="off"
          disabled={deaktiviert}
          value={anzeige}
          placeholder={placeholder}
          onFocus={() => setOffen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffen(true);
            setAktiv(0);
            if (freitext) onWert(e.target.value.trim());
          }}
          onKeyDown={onKey}
        />
        <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
      </span>
      {fehler && <span className="pf-fehler">{fehler}</span>}
      {offen && !deaktiviert && (
        <div className="pop pop--links scb-pop" role="presentation">
          <div
            className="menu scb-menu"
            role="listbox"
            id={listboxId}
            ref={listeRef}
          >
            {treffer.map((o, i) => (
              <button
                key={o.wert}
                type="button"
                role="option"
                aria-selected={o.wert === wert}
                data-idx={i}
                className={`menu-item${i === aktiv ? " aktiv" : ""}`}
                onMouseEnter={() => setAktiv(i)}
                // onMouseDown statt onClick: laeuft vor dem mousedown-Listener
                // des Dokuments, der das Popover schliesst.
                onMouseDown={(e) => {
                  e.preventDefault();
                  waehle(o);
                }}
              >
                <span className="lbl">{o.label}</span>
                {o.meta && <span className="scb-meta">{o.meta}</span>}
                {o.wert === wert && <i className="ph-bold ph-check" aria-hidden />}
              </button>
            ))}
            {treffer.length === 0 && !freitext && (
              <span className="menu-leer">Kein Treffer.</span>
            )}
            {treffer.length === 0 && freitext && (query ?? "").trim() && (
              <span className="menu-leer">„{(query ?? "").trim()}" wird übernommen.</span>
            )}
          </div>
        </div>
      )}
    </label>
  );
}
