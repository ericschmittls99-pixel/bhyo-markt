"use client";

import { useEffect, useRef, useState } from "react";

import { sektorAnzeige } from "@/lib/sektor";

interface AkteurOption {
  id: string;
  name: string;
  /** Sektor-Code der Referenztabelle (0020) oder null = "ohne Sektor". */
  sektor: string | null;
}

interface SektorOption {
  code: string;
  label: string;
  aktiv: boolean;
}

/**
 * Combobox mit Live-Suche ueber /api/akteure. Kein Treffer -> Inline-Neuanlage
 * (Name = aktuelle Eingabe, Sektor aus der Auswahlliste der Referenztabelle
 * oder "ohne Sektor" — kein Freitext mehr, seit 0020 haengt ein
 * Fremdschluessel daran). Angezeigt wird das Label, gespeichert der Code.
 * Der gewaehlte Akteur landet als
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
  const [sektoren, setSektoren] = useState<SektorOption[]>([]);
  // AP2.5 (E66, Praezisierung F0a): der Sitz des neuen Akteurs — vorbefuellt mit dem
  // Strom-Standort aus dem umgebenden Formular (AdresseBlock), frei aenderbar; PLZ und
  // Ort sind Pflicht, der Pin (lat/lng) kommt mit (Kreis-ARS, E25). Kein Vererben danach.
  const [sitz, setSitz] = useState({ strasse: "", hausnummer: "", plz: "", ort: "", lat: "", lng: "" });
  const [sitzVorbefuellt, setSitzVorbefuellt] = useState(false);
  const [anlageFehler, setAnlageFehler] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Einmal laden: acht Zeilen, Quelle fuer Auswahl und Anzeige-Label.
  useEffect(() => {
    let aktiv = true;
    fetch("/api/sektoren")
      .then((r) => r.json() as Promise<{ sektoren?: SektorOption[] }>)
      .then((d) => aktiv && setSektoren(d.sektoren ?? []))
      .catch(() => aktiv && setSektoren([]));
    return () => {
      aktiv = false;
    };
  }, []);

  /** Label zum Code; ein deaktivierter Sektor bleibt benannt, ein unbekannter Code (Altbestand) sichtbar. */
  const sektorLabel = (code: string | null) => {
    if (!code) return null;
    const s = sektoren.find((x) => x.code === code);
    return s ? sektorAnzeige(s.label, s.aktiv) : code;
  };

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

  /** Sitz einmal aus dem Strom-Standort des Formulars uebernehmen (Felder strasse/hausnummer/plz/ort/lat/lng). */
  function sitzVorbefuellen() {
    if (sitzVorbefuellt) return;
    const form = box.current?.closest("form");
    const lies = (n: string) => {
      const el = form?.elements.namedItem(n) as HTMLInputElement | RadioNodeList | null;
      return el && "value" in el ? String(el.value ?? "") : "";
    };
    setSitz({ strasse: lies("strasse"), hausnummer: lies("hausnummer"), plz: lies("plz"), ort: lies("ort"), lat: lies("lat"), lng: lies("lng") });
    setSitzVorbefuellt(true);
  }
  async function neuAnlegen() {
    const nm = query.trim();
    if (!nm) return;
    setLaedt(true);
    setAnlageFehler(null);
    try {
      const res = await fetch("/api/akteure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nm,
          sektor: sektor || undefined,
          sitz_strasse: sitz.strasse,
          sitz_hausnummer: sitz.hausnummer,
          sitz_plz: sitz.plz,
          sitz_ort: sitz.ort,
          lat: sitz.lat,
          lng: sitz.lng,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setAnlageFehler(data?.error ?? "Anlegen fehlgeschlagen.");
        return;
      }
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
            {gewaehlt.sektor ? ` · ${sektorLabel(gewaehlt.sektor)}` : ""}
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
                  {a.sektor && <span className="scb-meta">{sektorLabel(a.sektor)}</span>}
                </button>
              ))}
            {!laedt && !treffer.length && (
              <span className="menu-leer">Kein Treffer.</span>
            )}
            {!laedt && query.trim() && !exakt && (
              <div className="akteur-neu" ref={() => sitzVorbefuellen()}>
                <span className="pf-feld">
                  <select
                    aria-label="Sektor"
                    value={sektor}
                    onChange={(e) => setSektor(e.target.value)}
                  >
                    <option value="">ohne Sektor</option>
                    {sektoren
                      .filter((s) => s.aktiv)
                      .map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </span>
                {/* Sitz (E66): PLZ und Ort Pflicht, Adresse frei; der Pin kommt aus dem Strom-Standort. */}
                <span className="akteur-neu-sitz">
                  <span className="pf-feld">
                    <input type="text" aria-label="Sitz: Straße" placeholder="Straße" value={sitz.strasse} onChange={(e) => setSitz({ ...sitz, strasse: e.target.value })} />
                  </span>
                  <span className="pf-feld akteur-neu-nr">
                    <input type="text" aria-label="Sitz: Hausnummer" placeholder="Nr." value={sitz.hausnummer} onChange={(e) => setSitz({ ...sitz, hausnummer: e.target.value })} />
                  </span>
                  <span className="pf-feld akteur-neu-plz">
                    <input type="text" aria-label="Sitz: PLZ" placeholder="PLZ *" value={sitz.plz} onChange={(e) => setSitz({ ...sitz, plz: e.target.value })} />
                  </span>
                  <span className="pf-feld">
                    <input type="text" aria-label="Sitz: Ort" placeholder="Ort *" value={sitz.ort} onChange={(e) => setSitz({ ...sitz, ort: e.target.value })} />
                  </span>
                </span>
                <span className="c akteur-neu-hinweis">
                  {sitz.lat && sitz.lng ? "Sitz-Pin aus dem Standort übernommen; in akteure. änderbar." : "Erst den Standort mit Pin setzen — der Sitz übernimmt ihn (Kreis-ARS)."}
                </span>
                {anlageFehler && <span className="pf-fehler">{anlageFehler}</span>}
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={!sitz.plz.trim() || !sitz.ort.trim() || !sitz.lat || !sitz.lng}
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
