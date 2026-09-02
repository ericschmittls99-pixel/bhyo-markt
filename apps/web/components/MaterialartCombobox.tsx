"use client";

import { useEffect, useRef, useState } from "react";

import { GRUPPE_LABEL } from "@/lib/farben";

interface MaterialartOption {
  code: string;
  label: string;
}

/**
 * Combobox fuer die Materialart – gleiches Muster wie die Akteur-Combobox:
 * Live-Suche ueber /api/materialarten, kein Treffer -> Inline-Neuanlage (Label,
 * der Code wird serverseitig abgeleitet). Der gewaehlte Code landet als
 * versteckter `materialart_code`-Wert im Formular.
 */
export function MaterialartCombobox({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const [treffer, setTreffer] = useState<MaterialartOption[]>([]);
  const [gewaehlt, setGewaehlt] = useState<MaterialartOption | null>(null);
  const [offen, setOffen] = useState(false);
  const [laedt, setLaedt] = useState(false);
  const [gruppe, setGruppe] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gewaehlt) return;
    const q = query.trim();
    const t = setTimeout(async () => {
      setLaedt(true);
      try {
        const res = await fetch(`/api/materialarten?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { materialarten?: MaterialartOption[] };
        setTreffer(data.materialarten ?? []);
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

  function waehle(m: MaterialartOption) {
    setGewaehlt(m);
    setQuery(m.label);
    setOffen(false);
  }

  async function neuAnlegen() {
    const label = query.trim();
    if (!label || !gruppe) return;
    setLaedt(true);
    try {
      const res = await fetch("/api/materialarten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, gruppe }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { materialart: MaterialartOption };
      waehle(data.materialart);
    } finally {
      setLaedt(false);
    }
  }

  const exakt = treffer.some(
    (m) => m.label.toLowerCase() === query.trim().toLowerCase(),
  );

  return (
    <div className="field" ref={box} style={{ position: "relative" }}>
      <label>Materialart *</label>
      <input type="hidden" name={name} value={gewaehlt?.code ?? ""} />
      <input
        type="text"
        value={query}
        readOnly={!!gewaehlt}
        placeholder="Materialart suchen…"
        onFocus={() => !gewaehlt && setOffen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setGewaehlt(null);
          setOffen(true);
        }}
      />
      {gewaehlt && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="pill pill--accent">{gewaehlt.label}</span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setGewaehlt(null);
              setQuery("");
              setOffen(true);
            }}
          >
            ändern
          </button>
        </div>
      )}

      {offen && !gewaehlt && (
        <div
          className="card"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 20,
            marginTop: 4,
            padding: 8,
          }}
        >
          {laedt && <div className="muted" style={{ padding: 8 }}>lädt…</div>}
          {!laedt &&
            treffer.map((m) => (
              <button
                key={m.code}
                type="button"
                className="btn btn--ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => waehle(m)}
              >
                {m.label}
              </button>
            ))}
          {!laedt && !treffer.length && (
            <div className="muted" style={{ padding: 8 }}>
              Kein Treffer.
            </div>
          )}
          {!laedt && query.trim() && !exakt && (
            <div className="stack" style={{ padding: 8, gap: 8 }}>
              <select value={gruppe} onChange={(e) => setGruppe(e.target.value)}>
                <option value="">Gruppe wählen… (Pflicht)</option>
                {Object.entries(GRUPPE_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--primary"
                onClick={neuAnlegen}
                disabled={!gruppe}
              >
                „{query.trim()}" neu anlegen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
