"use client";

import { useEffect, useRef, useState } from "react";

import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";

import { OSM_STYLE } from "@/components/karte/KarteMap";
import { uebernimmAusPin, type AdresseWerte, type PinModus } from "@/lib/adresse-aus-pin";
import { GENAUIGKEIT_LABEL, type Genauigkeit, type PruefErgebnis } from "@/lib/adresse-pruefung";
import { adresseLabel, type Adresse } from "@/lib/geocode";
import { adresseLabelMitRegion } from "@/lib/region-label";

import "maplibre-gl/dist/maplibre-gl.css";

/** Startausschnitt ohne Pin: Rhein-Neckar/Vorderpfalz (Kernregion). */
const START: [number, number] = [8.55, 49.38];

interface Standort extends Omit<Adresse, "lng" | "lat" | "art" | "kreis" | "land"> {
  lng: number | null;
  lat: number | null;
}

/**
 * Formularblock "Ort" (F0a, E68 PR 2): Adressfelder, ein Knopf „Adresse
 * pruefen" (eine Anfrage je Klick — kein Autocomplete mehr), eine freie Suche
 * als zweite Option ueber denselben Weg, Uebernahme von bestehenden
 * Standorten des Akteurs und ein Kartenausschnitt mit setz- und
 * verschiebbarem Pin. Ablauf der Pruefung in lib/adresse-pruefung(-server):
 * lokal PLZ/Ort -> eine Dienstanfrage -> Treffer / Kandidaten / Punkt im
 * PLZ-Gebiet. Jeder Pin traegt eine Genauigkeit (Hidden-Input): hausnummer,
 * strasse, plz_gebiet, manuell (Klick oder Ziehen), unbekannt (Altbestand).
 * Wird der Pin von Hand gesetzt, holt die Rueckwaertssuche nur PLZ und Ort
 * (lokal, lib/adresse-aus-pin). Der Landkreis erscheint bewusst nicht im
 * Formular (bleibt Attribut am Datensatz; raeumlich abgeleitet).
 */
export function AdresseBlock({
  initial,
  initialGenauigkeit = "unbekannt",
  akteurId,
  fehler,
  hinweisOhnePin = "Ohne Pin erscheint der Strom nicht auf der Karte — Adresse suchen oder Pin in der Karte oben setzen.",
}: {
  initial?: Partial<AdresseWerte> | null;
  /** E68 PR 2: gespeicherte Genauigkeit; ohne Pin-Aenderung geht sie unveraendert zurueck. */
  initialGenauigkeit?: Genauigkeit;
  akteurId: string | null;
  fehler?: string;
  /** AP2.5: Hinweis ohne Pin — Standort (Strom) oder Sitz (Akteur); derselbe Block, dieselbe Karte. */
  hinweisOhnePin?: string;
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
  const [genauigkeit, setGenauigkeit] = useState<Genauigkeit>(initialGenauigkeit);
  const [prueft, setPrueft] = useState(false);
  const [kandidaten, setKandidaten] = useState<Adresse[]>([]);
  const [freiOffen, setFreiOffen] = useState(false);
  const [standorte, setStandorte] = useState<Standort[]>([]);
  const [standorteOffen, setStandorteOffen] = useState(false);

  const kartenDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<MlMarker | null>(null);
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null);
  const reverseAbort = useRef<AbortController | null>(null);
  // Aktueller Feldstand fuer die asynchrone Rueckwaertssuche (kein Zustand im Updater).
  const wRef = useRef(w);
  wRef.current = w;

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
        setGenauigkeit("manuell");
        void adresseAusPin(p.lng, p.lat);
      });
      markerRef.current = m;
    } else {
      markerRef.current.setLngLat([lng, lat]);
    }
    if (zentrieren) map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13) });
  }

  /**
   * Rueckwaertssuche aus dem Pin. "pin": Koordinate fuehrend, alle Felder aus
   * dem Treffer. "ergaenzen": nur fehlende PLZ/Ort. Regel in lib/adresse-aus-pin.
   */
  async function adresseAusPin(lng: number, lat: number, modus: PinModus = "pin") {
    reverseAbort.current?.abort();
    const ac = new AbortController();
    reverseAbort.current = ac;
    try {
      const res = await fetch(`/api/geocode?lat=${lat}&lon=${lng}`, { signal: ac.signal });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? String(res.status));
      }
      const data = (await res.json()) as { adressen?: Adresse[] };
      const r = uebernimmAusPin(wRef.current, data.adressen?.[0] ?? null, modus);
      setW(r.werte);
      setHinweis(r.hinweis);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      // Die Ursache kommt vom Proxy (Zeitlimit, Status, Netz); der Pin bleibt, PLZ und Ort gehen von Hand.
      const grund = (e as Error).message;
      // E68 PR 1: fehlt der PLZ-Bestand, sagt der Server das im Klartext — unveraendert anzeigen.
      if (/PLZ-Gebiete/.test(grund)) {
        setHinweis(grund);
        return;
      }
      setHinweis(`${/Adresssuche/.test(grund) ? grund.replace(/ — Adresse und Pin.*$/, "") : "Rückwärtssuche nicht erreichbar"} — PLZ und Ort bitte von Hand eintragen.`);
    }
  }

  function uebernehmen(a: Adresse | Standort, zentrieren: boolean, g: Genauigkeit = "unbekannt") {
    setGenauigkeit(g);
    setKandidaten([]);
    const neu: AdresseWerte = {
      ...wRef.current,
      strasse: a.strasse ?? "",
      hausnummer: a.hausnummer ?? "",
      plz: a.plz ?? "",
      ort: a.ort ?? "",
      lat: a.lat == null ? wRef.current.lat : String(a.lat),
      lng: a.lng == null ? wRef.current.lng : String(a.lng),
    };
    setW(neu);
    wRef.current = neu;
    setHinweis(null);
    if (a.lng != null && a.lat != null) setzePin(a.lng, a.lat, zentrieren);
    if (neu.plz && neu.ort) return;
    // Standort oder Treffer ohne PLZ/Ort: aus dem Pin ergaenzen — ohne Pin nur melden.
    if (neu.lat && neu.lng) void adresseAusPin(Number(neu.lng), Number(neu.lat), "ergaenzen");
    else setHinweis(uebernimmAusPin(neu, null, "ergaenzen").hinweis);
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
        setGenauigkeit("manuell");
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

  /**
   * E68 PR 2: Ein Klick, hoechstens eine Dienstanfrage. Die Antwort traegt
   * Ergebnis, Kreiszahl und Dauer; die Entscheidung ist serverseitig gefallen.
   */
  async function pruefen() {
    setPrueft(true);
    setKandidaten([]);
    setHinweis(null);
    try {
      const q = new URLSearchParams({ strasse: w.strasse, hausnummer: w.hausnummer, plz: w.plz, ort: w.ort });
      const res = await fetch(`/api/adresse?${q}`);
      const data = (await res.json().catch(() => null)) as { ergebnis?: PruefErgebnis; kreise?: number | null; error?: string } | null;
      if (!res.ok || !data?.ergebnis) throw new Error(data?.error ?? String(res.status));
      const e = data.ergebnis;
      if (e.status === "treffer") {
        uebernehmen({ ...e.adresse, strasse: e.adresse.strasse ?? w.strasse, hausnummer: e.adresse.hausnummer ?? w.hausnummer }, true, e.genauigkeit);
        setHinweis(e.text);
      } else if (e.status === "kandidaten") {
        setKandidaten(e.kandidaten);
        setHinweis(e.text);
      } else if (e.status === "plz_gebiet") {
        setGenauigkeit("plz_gebiet");
        setzePin(e.pin.lng, e.pin.lat, true);
        setHinweis(
          (data.kreise ?? 0) > 1
            ? `${e.text} Die PLZ liegt über einer Kreisgrenze — der Landkreis folgt dem Pin.`
            : e.text,
        );
      } else {
        // ort_fehler („Meinten Sie …?" aus der lokalen Pruefung) und dienst_fehlt: nur der Text.
        setHinweis(e.text);
      }
    } catch (err) {
      setHinweis(`Adressprüfung nicht möglich: ${(err as Error).message} — Pin bitte von Hand setzen.`);
    } finally {
      setPrueft(false);
    }
  }

  /** Freie Suche („Kläranlage Mannheim"): eine Anfrage je Klick, bis zu fuenf Treffer zum Uebernehmen. */
  async function freiSuchen() {
    const q = suchQ.trim();
    if (q.length < 3) return;
    setPrueft(true);
    setHinweis(null);
    try {
      const res = await fetch(`/api/adresse?q=${encodeURIComponent(q)}`);
      const data = (await res.json().catch(() => null)) as { adressen?: Adresse[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Adresssuche nicht erreichbar");
      setVorschlaege(data?.adressen ?? []);
      setSuchOffen(true);
      if ((data?.adressen ?? []).length === 0) setHinweis("Freie Suche ohne Treffer — Adresse und Pin lassen sich vollständig von Hand setzen.");
    } catch (e) {
      setVorschlaege([]);
      const grund = (e as Error).message;
      setHinweis(/Adresssuche/.test(grund) ? grund : "Adresssuche nicht erreichbar — Adresse und Pin lassen sich vollständig von Hand setzen.");
    } finally {
      setPrueft(false);
    }
  }

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

  const standortLabel = (st: Standort) => adresseLabel(st) || "(ohne Adresse)";

  return (
    <fieldset className="adr">
      <legend className="adr-legende">Ort</legend>

      {/* E68 PR 2: Felder zuerst, dann pruefen — kein Vorschlag beim Tippen. */}
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

      <div className="adr-pruefen">
        <button type="button" className="btn btn--primary btn--sm" onClick={pruefen} disabled={prueft}>
          <i className="ph ph-magnifying-glass" aria-hidden />
          {prueft ? "Prüft …" : "Adresse prüfen"}
        </button>
        <span className={`pill pill--muted adr-genauigkeit adr-genauigkeit--${genauigkeit}`}>{GENAUIGKEIT_LABEL[genauigkeit]}.</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFreiOffen((v) => !v)} disabled={prueft}>
          freie Suche
        </button>
        {kandidaten.length > 0 && (
          <span className="adr-popover" role="listbox">
            {kandidaten.map((a, i) => (
              <button key={i} type="button" role="option" aria-selected={false} onClick={() => uebernehmen(a, true, a.hausnummer ? "hausnummer" : a.strasse ? "strasse" : "unbekannt")}>
                {adresseLabelMitRegion(a)}
              </button>
            ))}
          </span>
        )}
      </div>
      {freiOffen && (
        <label className="pf adr-frei">
          <span>Freie Suche</span>
          <span className="pf-feld adr-frei-zeile">
            <input
              type="text"
              value={suchQ}
              onChange={(e) => setSuchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void freiSuchen();
                }
              }}
              placeholder="z. B. Kläranlage Mannheim — Treffer füllt die Felder und setzt den Pin"
              autoComplete="off"
            />
            <button type="button" className="btn btn--sm" onClick={freiSuchen} disabled={prueft || suchQ.trim().length < 3}>
              Suchen
            </button>
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
                    uebernehmen(a, true, a.hausnummer ? "hausnummer" : a.strasse ? "strasse" : "unbekannt");
                    setSuchOffen(false);
                    setSuchQ("");
                  }}
                >
                  {adresseLabelMitRegion(a)}
                </button>
              ))}
            </span>
          )}
          <span className="adr-caption">Suche: © OpenStreetMap-Mitwirkende · eine Anfrage je Klick</span>
        </label>
      )}

      <div className="adr-karte" ref={kartenDiv} aria-label="Kartenausschnitt mit Pin" />
      <span className="adr-caption">
        Klick setzt den Pin, Ziehen verschiebt ihn — dann ist die Koordinate führend (Genauigkeit „manuell", PLZ und Ort aus dem PLZ-Gebiet).
      </span>
      {hinweis && <span className="adr-hinweis">{hinweis}</span>}
      {fehler && <span className="pf-fehler">{fehler}</span>}

      {/* F4: Der Hinweis haengt jetzt am tatsaechlichen Pin-Zustand. Vorher
          stand er statisch im Formular — er erschien auch nach einer
          Adresssuche und blieb stehen, wenn man den Pin von Hand setzte. */}
      {(!w.lat || !w.lng) && (
        <div className="hinweis-box">
          <i className="ph ph-map-pin" aria-hidden />
          <span>{hinweisOhnePin}</span>
        </div>
      )}
      <input type="hidden" name="lat" value={w.lat} />
      <input type="hidden" name="lng" value={w.lng} />
      <input type="hidden" name="genauigkeit" value={w.lat && w.lng ? genauigkeit : "unbekannt"} />
    </fieldset>
  );
}
