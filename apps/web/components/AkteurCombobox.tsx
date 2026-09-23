"use client";

import { useEffect, useRef, useState } from "react";

interface AkteurOption {
  id: string;
  name: string;
  sektor: string | null;
}

/**
 * Combobox mit Live-Suche ueber /api/akteure. Kein Treffer -> Inline-Neuanlage
 * (Name = aktuelle Eingabe, Sektor optional). Der gewaehlte Akteur landet als
 * versteckter `akteur_id`-Wert im umgebenden Formular. Seit PR 5 im V2-Look
 * (pf-Feld + Glas-Popover) und mit Prefill fuer das Bearbeiten.
 */
export function AkteurCombobox({
  name,
  initial,
  fehler,
  onGewaehlt,
}: {
  name: string;
  initial?: AkteurOption | null;
  fehler?: string;
  /** F0a: meldet die Akteurwahl nach oben (Adress-Uebernahme-Knopf). */
  onGewaehlt?: (a: AkteurOption | null) => void;
}) {
  const [query, setQuery] = useState(initial?.name ?? "");
  const [treffer, setTreffer] = useState<AkteurOption[]>([]);
  const [gewaehlt, setGewaehlt] = useState<AkteurOption | null>(initial ?? null);
  const [offen, setOffen] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [sektor, setSektor] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gewaehlt) return;
    const q = query.trim();
    const t = setTimeout(async () => {
      setLaedt(true);
      try {
        const res = await fetch(`/api/akteure?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { akteure?: AkteurOption[] };
        setTreffer(data.akteure ?? []);
      } catch {
        setTreffer([]);
      } finally {
        setLaedt(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, gewaehlt]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function waehle(a: AkteurOption) {
    setGewaehlt(a);
    setQuery(a.name);
    setOffen(false);
    onGewaehlt?.(a);
  }

  function loesen() {
    setGewaehlt(null);
    setQuery("");
    setSektor("");
    setOffen(true);
    onGewaehlt?.(null);
  }

  async function neuAnlegen() {
    const nm = query.trim();
    if (!nm) return;
    setLaedt(true);
    try {
      const res = await fetch("/api/akteure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, sektor: sektor.trim() || undefined }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { akteur: AkteurOption };
      waehle(data.akteur);
    } finally {
      setLaedt(false);
    }
  }

  const exakt = treffer.some(
    (a) => a.name.toLowerCase() === query.trim().toLowerCase(),
  );

  return (
    <div className="pf" ref={box} style={{ position: "relative" }}>
      <span>
        Akteur<em className="pf-pflicht" aria-hidden> *</em>
      </span>
      <input type="hidden" name={name} value={gewaehlt?.id ?? ""} />
      <span className="pf-feld scb-feld">
        <input
          type="text"
          role="combobox"
          aria-expanded={offen && !gewaehlt}
          aria-invalid={fehler ? true : undefined}
          autoComplete="off"
          value={query}
          readOnly={!!gewaehlt}
          placeholder="Akteur wählen"
          onFocus={() => !gewaehlt && setOffen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffen(true);
          }}
        />
        <i className="ph-bold ph-caret-down scb-caret" aria-hidden />
      </span>
      {fehler && <span className="pf-fehler">{fehler}</span>}
      {gewaehlt && (
        <span className="akteur-gewaehlt">
          <span className="pill pill--accent">
            {gewaehlt.name}
            {gewaehlt.sektor ? ` · ${gewaehlt.sektor}` : ""}
          </span>
          <button type="button" className="btn btn--sm" onClick={loesen}>
            ändern
          </button>
        </span>
      )}

      {offen && !gewaehlt && (
        <div className="pop pop--links scb-pop" role="presentation">
          <div className="menu scb-menu">
            {laedt && <span className="menu-leer">lädt…</span>}
            {!laedt &&
              treffer.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="menu-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    waehle(a);
                  }}
                >
                  <span className="lbl">{a.name}</span>
                  {a.sektor && <span className="scb-meta">{a.sektor}</span>}
                </button>
              ))}
            {!laedt && !treffer.length && (
              <span className="menu-leer">Kein Treffer.</span>
            )}
            {!laedt && query.trim() && !exakt && (
              <div className="akteur-neu">
                <span className="pf-feld">
                  <input
                    type="text"
                    value={sektor}
                    placeholder="Sektor (optional)"
                    onChange={(e) => setSektor(e.target.value)}
                  />
                </span>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void neuAnlegen();
                  }}
                >
                  „{query.trim()}" neu anlegen
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
