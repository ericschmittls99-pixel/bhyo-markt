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
 * versteckter `akteur_id`-Wert im umgebenden Formular.
 */
export function AkteurCombobox({ name }: { name: string }) {
  const [query, setQuery] = useState("");
  const [treffer, setTreffer] = useState<AkteurOption[]>([]);
  const [gewaehlt, setGewaehlt] = useState<AkteurOption | null>(null);
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
  }

  function loesen() {
    setGewaehlt(null);
    setQuery("");
    setSektor("");
    setOffen(true);
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
    <div className="field" ref={box} style={{ position: "relative" }}>
      <label>Akteur *</label>
      <input type="hidden" name={name} value={gewaehlt?.id ?? ""} />
      <input
        type="text"
        value={query}
        readOnly={!!gewaehlt}
        placeholder="Name oder Sektor suchen…"
        onFocus={() => !gewaehlt && setOffen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOffen(true);
        }}
      />
      {gewaehlt && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="pill pill--accent">
            {gewaehlt.name}
            {gewaehlt.sektor ? ` · ${gewaehlt.sektor}` : ""}
          </span>
          <button type="button" className="btn btn--ghost" onClick={loesen}>
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
            treffer.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn btn--ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => waehle(a)}
              >
                {a.name}
                {a.sektor ? <span className="muted"> · {a.sektor}</span> : null}
              </button>
            ))}
          {!laedt && !treffer.length && (
            <div className="muted" style={{ padding: 8 }}>
              Kein Treffer.
            </div>
          )}
          {!laedt && query.trim() && !exakt && (
            <div className="stack" style={{ padding: 8, gap: 8 }}>
              <input
                type="text"
                value={sektor}
                placeholder="Sektor (optional)"
                onChange={(e) => setSektor(e.target.value)}
              />
              <button type="button" className="btn btn--primary" onClick={neuAnlegen}>
                „{query.trim()}" neu anlegen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
