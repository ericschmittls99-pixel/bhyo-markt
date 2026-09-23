"use client";

import { useEffect, useRef, useState } from "react";

import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";

import { OSM_STYLE } from "@/components/karte/KarteMap";
import { adresseLabel, type Adresse } from "@/lib/geocode";

import "maplibre-gl/dist/maplibre-gl.css";

/** Startausschnitt ohne Pin: Rhein-Neckar/Vorderpfalz (Kernregion). */
const START: [number, number] = [8.55, 49.38];

interface AdresseWerte {
  strasse: string;
  hausnummer: string;
  plz: string;
  ort: string;
  lat: string;
  lng: string;
}

interface Standort extends Omit<Adresse, "lng" | "lat"> {
  lng: number | null;
  lat: number | null;
}

/**
 * Formularblock "Ort" (F0a): Adresssuche (Bequemlichkeit, kein Tor),
 * Uebernahme von bestehenden Standorten des Akteurs, manuell editierbare
 * Adressfelder und ein Kartenausschnitt mit setz- und verschiebbarem Pin.
 * Wird der Pin verschoben, ist die KOORDINATE fuehrend: die Adressfelder
 * werden per Rueckwaertssuche aktualisiert und als "aus Pin uebernommen"
 * gekennzeichnet. Der Landkreis erscheint bewusst nicht im Formular
 * (bleibt Attribut am Datensatz; ab F0b raeumlich abgeleitet).
 */
export function AdresseBlock({
  initial,
  akteurId,
  fehler,
}: {
  initial?: Partial<AdresseWerte> | null;
  akteurId: string | null;
  fehler?: string;
}) {
  const [w, setW] = useState<AdresseWerte>({
    strasse: initial?.strasse ?? "",
    hausnummer: initial?.hausnummer ?? "",
    plz: initial?.plz ?? "",
    ort: initial?.ort ?? "",
    lat: initial?.lat ?? "",
    lng: initial?.lng ?? "",
  });
  const [suchQ, setSuchQ] = useState("");
  const [vorschlaege, setVorschlaege] = useState<Adresse[]>([]);
  const [suchOffen, setSuchOffen] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [standorte, setStandorte] = useState<Standort[]>([]);
  const [standorteOffen, setStandorteOffen] = useState(false);

  const kartenDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const reverseAbort = useRef<AbortController | null>(null);

  const feld = (k: keyof AdresseWerte, v: string) => setW((alt) => ({ ...alt, [k]: v }));

  /** Pin auf der Karte setzen/bewegen und die Hidden-Felder fuellen. */
  function setzePin(lng: number, lat: number, zentrieren = false) {
    setW((alt) => ({ ...alt, lat: String(lat), lng: String(lng) }));
    const map = mapRef.current;
    const ml = mlRef.current;
    if (!map || !ml) return;
    if (!markerRef.current) {
      const m = new ml.Marker({ draggable: true, color: "#3A5412" })
        .setLngLat([lng, lat])
        .addTo(map);
      m.on("dragend", () => {
        const p = m.getLngLat();
        setW((alt) => ({ ...alt, lat: String(p.lat), lng: String(p.lng) }));
        void adresseAusPin(p.lng, p.lat);
      });
      markerRef.current = m;
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }
    if (zentrieren) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13) });
  }

  /** Pin fuehrend: Adressfelder per Rueckwaertssuche nachziehen. */
  async function adresseAusPin(lng: number, lat: number) {
    reverseAbort.current?.abort();
    const ac = new AbortController();
    reverseAbort.current = ac;
    try {
      const res = await fetch(`/api/geocode?lat=${lat}&lon=${lng}`, { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { adressen?: Adresse[] };
      const a = data.adressen?.[0];
      if (!a) throw new Error("leer");
      setW((alt) => ({
        ...alt,
        strasse: a.strasse ?? "",
        hausnummer: a.hausnummer ?? "",
        plz: a.plz ?? "",
        ort: a.ort ?? "",
      }));
      setHinweis("Adresse aus Pin übernommen.");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setHinweis("Rückwärtssuche nicht erreichbar — Adressfelder unverändert.");
    }
  }

  function uebernehmen(a: Adresse | Standort, zentrieren: boolean) {
    setW((alt) => ({
      ...alt,
      strasse: a.strasse ?? "",
      hausnummer: a.hausnummer ?? "",
      plz: a.plz ?? "",
      ort: a.ort ?? "",
      lat: a.lat == null ? alt.lat : String(a.lat),
      lng: a.lng == null ? alt.lng : String(a.lng),
    }));
    setHinweis(null);
    if (a.lng != null && a.lat != null) setzePin(a.lng, a.lat, zentrieren);
  }

  // Karte einmalig aufbauen; beim Bearbeiten steht der Pin an der
  // gespeicherten Stelle.
  useEffect(() => {
    let beendet = false;
    (async () => {
      if (!kartenDiv.current || mapRef.current) return;
      const ml = await import("maplibre-gl");
      if (beendet || !kartenDiv.current) return;
      mlRef.current = ml;
      const hatPin = w.lat !== "" && w.lng !== "";
      const map = new ml.Map({
        container: kartenDiv.current,
        style: OSM_STYLE as never,
        center: hatPin ? [Number(w.lng), Number(w.lat)] : START,
        zoom: hatPin ? 13 : 9,
        attributionControl: { compact: true },
      });
      map.on("click", (e) => {
        setzePin(e.lngLat.lng, e.lngLat.lat);
        void adresseAusPin(e.lngLat.lng, e.lngLat.lat);
      });
      mapRef.current = map;
      if (hatPin) setzePin(Number(w.lng), Number(w.lat));
    })();
    return () => {
      beendet = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adresssuche: debounced, ab 3 Zeichen; Ausfall blockiert nichts.
  useEffect(() => {
    const q = suchQ.trim();
    if (q.length < 3) {
      setVorschlaege([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Adresssuche nicht erreichbar");
        }
        const data = (await res.json()) as { adressen?: Adresse[] };
        setVorschlaege(data.adressen ?? []);
        setSuchOffen(true);
        setHinweis(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setVorschlaege([]);
        setHinweis(
          "Adresssuche nicht erreichbar — Adresse und Pin lassen sich vollständig von Hand setzen.",
        );
      }
    }, 350);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [suchQ]);

  // Bestehende Standorte des gewaehlten Akteurs (Uebernahme-Knopf).
  useEffect(() => {
    setStandorte([]);
    setStandorteOffen(false);
    if (!akteurId) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/standorte?akteur=${encodeURIComponent(akteurId)}`, {
          signal: ac.signal,
        });
        const data = (await res.json()) as { standorte?: Standort[] };
        setStandorte(data.standorte ?? []);
      } catch {
        setStandorte([]);
      }
    })();
    return () => ac.abort();
  }, [akteurId]);

  const standortLabel = (st: Standort) =>
    adresseLabel({ ...st, lng: st.lng ?? 0, lat: st.lat ?? 0 }) || "(ohne Adresse)";

  return (
    <fieldset className="adr">
      <legend className="adr-legende">Ort</legend>

      <label className="pf">
        <span>Adresse suchen</span>
        <span className="pf-feld">
          <input
            type="text"
            value={suchQ}
            onChange={(e) => setSuchQ(e.target.value)}
            onFocus={() => vorschlaege.length > 0 && setSuchOffen(true)}
            placeholder="Straße, Ort — Auswahl füllt die Felder und setzt den Pin"
            autoComplete="off"
          />
        </span>
        {suchOffen && vorschlaege.length > 0 && (
          <span className="adr-popover" role="listbox">
            {vorschlaege.map((a, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  uebernehmen(a, true);
                  setSuchOffen(false);
                  setSuchQ("");
                }}
              >
                {adresseLabel(a)}
              </button>
            ))}
          </span>
        )}
        <span className="adr-caption">Suche: © OpenStreetMap-Mitwirkende</span>
      </label>

      {standorte.length > 0 && (
        <div className="adr-uebernahme">
          <button type="button" className="btn btn--sm" onClick={() => setStandorteOffen((v) => !v)}>
            Adresse von bestehendem Standort übernehmen
          </button>
          {standorteOffen && (
            <span className="adr-popover" role="listbox">
              {standorte.map((st, i) => (
                <button
                  key={i}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    uebernehmen(st, true);
                    setStandorteOffen(false);
                  }}
                >
                  {standortLabel(st)}
                </button>
              ))}
            </span>
          )}
        </div>
      )}

      <div className="fp-zeile">
        <label className="pf">
          <span>Straße</span>
          <span className="pf-feld">
            <input type="text" name="strasse" value={w.strasse} onChange={(e) => feld("strasse", e.target.value)} />
          </span>
        </label>
        <label className="pf adr-kurz">
          <span>Hausnummer</span>
          <span className="pf-feld">
            <input type="text" name="hausnummer" value={w.hausnummer} onChange={(e) => feld("hausnummer", e.target.value)} />
          </span>
        </label>
      </div>
      <div className="fp-zeile">
        <label className="pf adr-kurz">
          <span>PLZ</span>
          <span className="pf-feld">
            <input type="text" name="plz" value={w.plz} onChange={(e) => feld("plz", e.target.value)} />
          </span>
        </label>
        <label className="pf">
          <span>Ort</span>
          <span className="pf-feld">
            <input type="text" name="ort" value={w.ort} onChange={(e) => feld("ort", e.target.value)} />
          </span>
        </label>
      </div>

      <div className="adr-karte" ref={kartenDiv} aria-label="Kartenausschnitt mit Pin" />
      <span className="adr-caption">
        Klick setzt den Pin, Ziehen verschiebt ihn — dann ist die Koordinate führend.
      </span>
      {hinweis && <span className="adr-hinweis">{hinweis}</span>}
      {fehler && <span className="pf-fehler">{fehler}</span>}

      <input type="hidden" name="lat" value={w.lat} />
      <input type="hidden" name="lng" value={w.lng} />
    </fieldset>
  );
}
