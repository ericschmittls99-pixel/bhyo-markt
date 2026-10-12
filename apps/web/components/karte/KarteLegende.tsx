"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CLUSTER_FARBE,
  CLUSTER_LABEL,
  OUTPUT_FARBE,
  OUTPUT_LABEL,
} from "@/lib/farben";
import { ringStil, type KartePunkt, type RingZustand } from "@/lib/karte-modell";
import { updateUiCookie } from "@/lib/ui-state";

const MIN_HOEHE = 96;
const MAX_HOEHE = 480;
const DEFAULT_HOEHE = 320;

/**
 * Glas-Legende von karte. (PR 6): klappbar, Hoehe per Griff ziehbar
 * (Doppelklick = auf/zu, Pfeiltasten ±24 px), vier Gruppen — Cluster und
 * Output-Gruppe (Orbs, klick-filtern), Rand = Qualitaet,
 * Regionen mit Sichtbarkeitsschaltern. Offen/Hoehe/Regionsschalter leben im
 * Cookie bhyo_ui und ueberleben Einklappen und Reload.
 */
/** E24/E27: Reihenfolge der Ring-Zustaende in der Legende. */
const RING_LEGENDE: { zustand: RingZustand; label: string }[] = [
  { zustand: "A", label: "A" },
  { zustand: "B", label: "B" },
  { zustand: "C", label: "C" },
  { zustand: "D", label: "D" },
  { zustand: "unbelegt", label: "unbelegt" },
  { zustand: "ausserhalb", label: "außerhalb" },
];

/**
 * E77 R1: der Legendentext (Groesse ~ Menge, „ausserhalb", ohne Koordinate)
 * sitzt hinter einem i-Knopf im Legendenkopf — auch eingeklappt erreichbar.
 * Knopf schaltet (aria-expanded), Esc schliesst und gibt den Fokus zurueck,
 * Klick ausserhalb schliesst. Das Popover haengt als Portal mit fester Lage
 * am Knopf: die Legende schneidet (overflow hidden) und ihr Blur macht sie
 * zum Containing Block, innen waere es abgeschnitten.
 */
function LegendeHinweis() {
  const [offen, setOffen] = useState(false);
  const [lage, setLage] = useState<{ right: number; bottom: number } | null>(null);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!offen) return;
    const lege = () => {
      const r = knopfRef.current?.getBoundingClientRect();
      if (!r) return;
      setLage({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 6 });
    };
    lege();
    window.addEventListener("resize", lege);
    return () => window.removeEventListener("resize", lege);
  }, [offen]);
  useEffect(() => {
    if (!offen) return;
    const onDown = (e: MouseEvent) => {
      const ziel = e.target as Node;
      if (wrapRef.current?.contains(ziel) || popRef.current?.contains(ziel)) return;
      setOffen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOffen(false);
      knopfRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [offen]);
  return (
    <span className="km-leg-info" ref={wrapRef}>
      <button
        ref={knopfRef}
        type="button"
        className="icon-btn"
        aria-label="Erklärung zur Legende"
        aria-expanded={offen}
        aria-controls={id}
        onClick={() => setOffen((v) => !v)}
      >
        <i className="ph ph-info" aria-hidden />
      </button>
      {offen &&
        lage &&
        createPortal(
          <div id={id} ref={popRef} className="km-leg-info-pop" role="note" style={{ right: lage.right, bottom: lage.bottom }}>
            <p>Größe ~ Menge (t atro/a bzw. Bedarfsmenge).</p>
          <p>
            „außerhalb" heißt: die Koordinate liegt in keinem Verwaltungsgebiet — oft ein
            Hinweis auf einen falsch gesetzten Pin.
          </p>
          <p>
            Ströme <strong>ohne Koordinate</strong> haben keinen Pin und erscheinen deshalb
            nicht auf der Karte.
          </p>
          </div>,
          document.body,
        )}
    </span>
  );
}

export function KarteLegende({
  punkte,
  poolPunkte,
  gesamtStroeme,
  umrisseAn,
  onUmrisseToggle,
  onClusterKlick,
  onGruppeKlick,
  auswahlCluster,
  auswahlGruppe,
  initial,
}: {
  punkte: KartePunkt[];
  /** Ungefilterte Pins — Zeilen-Zaehlung nach Pool-Prinzip (PR 3). */
  poolPunkte: KartePunkt[];
  gesamtStroeme: number;
  /** Master-Toggle regionsumrisse. (Review Eric: ohne Einzelauswahl). */
  umrisseAn: boolean;
  onUmrisseToggle: () => void;
  onClusterKlick: (key: string) => void;
  onGruppeKlick: (key: string) => void;
  auswahlCluster: string[];
  auswahlGruppe: string[];
  initial: { offen: boolean; hoehe?: number };
}) {
  const [offen, setOffen] = useState(initial.offen);
  const [hoehe, setHoehe] = useState(
    Math.min(MAX_HOEHE, Math.max(MIN_HOEHE, initial.hoehe ?? DEFAULT_HOEHE)),
  );
  const [zieht, setZieht] = useState(false);
  const dragRef = useRef<{ startY: number; startHoehe: number } | null>(null);

  function speichere(patch: { offen?: boolean; hoehe?: number }) {
    const aktuell = updateUiCookie({}).legende;
    updateUiCookie({
      legende: {
        offen: patch.offen ?? offen,
        hoehe: patch.hoehe ?? hoehe,
        umrisse: aktuell?.umrisse ?? umrisseAn,
      },
    });
  }

  function toggle() {
    const neu = !offen;
    setOffen(neu);
    speichere({ offen: neu });
  }

  function setzeHoehe(px: number) {
    const geclampt = Math.min(MAX_HOEHE, Math.max(MIN_HOEHE, px));
    setHoehe(geclampt);
    return geclampt;
  }

  function onGriffPointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startHoehe: offen ? hoehe : MIN_HOEHE };
    setZieht(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onGriffPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    // Legende sitzt unten: nach oben ziehen = groesser.
    const delta = dragRef.current.startY - e.clientY;
    const neu = setzeHoehe(dragRef.current.startHoehe + delta);
    if (!offen && neu > MIN_HOEHE) setOffen(true);
  }
  function onGriffPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setZieht(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const zu = hoehe <= MIN_HOEHE;
    if (zu) setOffen(false);
    speichere({ offen: !zu, hoehe });
  }
  function onGriffKey(e: React.KeyboardEvent) {
    const delta = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : null;
    if (delta == null) return;
    e.preventDefault();
    const neu = setzeHoehe((offen ? hoehe : MIN_HOEHE) + delta);
    const zu = neu <= MIN_HOEHE && delta < 0;
    setOffen(!zu);
    speichere({ offen: !zu, hoehe: neu });
  }

  // Pool-Prinzip (Karten-Review 22.09.2026): Zeilen zaehlen aus dem
  // UNGEFILTERTEN Pool — ein aktiver Filter nullt die uebrigen Zeilen nicht,
  // die Auswahl bleibt ueber .aktiv markiert.
  const zaehle = (art: "biomasse" | "output", key: string) =>
    poolPunkte.filter((p) => p.art === art && p.farbeKey === key).length;

  return (
    <section
      className={`km-legende${offen ? "" : " zu"}${zieht ? " ziehen" : ""}`}
      aria-label="Legende"
      style={{ maxHeight: offen ? hoehe : 48 }}
    >
      <div
        className="km-legende-griff"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Legendenhöhe ändern"
        tabIndex={0}
        onPointerDown={onGriffPointerDown}
        onPointerMove={onGriffPointerMove}
        onPointerUp={onGriffPointerUp}
        onDoubleClick={toggle}
        onKeyDown={onGriffKey}
      >
        <span aria-hidden />
      </div>
      <header className="km-legende-kopf">
        <h2>legende.</h2>
        <span className="km-legende-zahl">
          {punkte.length} von {gesamtStroeme} Strömen
        </span>
        <LegendeHinweis />
        <button
          type="button"
          className="icon-btn"
          aria-expanded={offen}
          aria-label={offen ? "Legende einklappen" : "Legende ausklappen"}
          onClick={toggle}
        >
          <i className={`ph-bold ph-caret-${offen ? "down" : "up"}`} aria-hidden />
        </button>
      </header>

      {offen && (
        <div className="km-legende-body">
          <div className="km-leg-grp">
            <h3>cluster.</h3>
            {Object.entries(CLUSTER_FARBE).map(([k, farbe]) => (
              <button
                key={k}
                type="button"
                className={`km-leg-zeile${auswahlCluster.includes(k) ? " aktiv" : ""}`}
                onClick={() => onClusterKlick(k)}
              >
                <img
                  className="km-leg-orb"
                  src={`/orbs/cluster/${k}.webp`}
                  alt=""
                  aria-hidden
                  width={18}
                  height={18}
                />
                <span className="lbl">{CLUSTER_LABEL[k]}</span>
                <span className="anz">{zaehle("biomasse", k)}</span>
              </button>
            ))}
          </div>

          <div className="km-leg-grp">
            <h3>output-gruppe.</h3>
            {Object.entries(OUTPUT_FARBE).map(([k, farbe]) => (
              <button
                key={k}
                type="button"
                className={`km-leg-zeile${auswahlGruppe.includes(k) ? " aktiv" : ""}`}
                onClick={() => onGruppeKlick(k)}
              >
                {k === "add_ons" ? (
                  <i className="km-leg-kreis" style={{ background: farbe }} aria-hidden />
                ) : (
                  <img
                    className="km-leg-orb"
                    src={`/orbs/output/${k}.webp`}
                    alt=""
                    aria-hidden
                    width={18}
                    height={18}
                  />
                )}
                <span className="lbl">{OUTPUT_LABEL[k]}</span>
                <span className="anz">{zaehle("output", k)}</span>
              </button>
            ))}
          </div>

          <div className="km-leg-grp">
            <h3>rand · zustand.</h3>
            <div className="km-leg-qual">
              {/* E24/E27: alle sechs Ring-Zustaende, je mit eigener Optik. */}
              {RING_LEGENDE.map(({ zustand, label }) => {
                const ring = ringStil(zustand);
                return (
                  <span className="km-leg-qual-item" key={zustand}>
                    <i
                      style={{
                        borderColor: ring.farbe,
                        borderWidth: ring.breite,
                        borderStyle: ring.stil,
                      }}
                      aria-hidden
                    />
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="km-leg-grp">
            <h3>regionsumrisse.</h3>
            <button
              type="button"
              className="km-leg-zeile"
              aria-pressed={umrisseAn}
              onClick={onUmrisseToggle}
            >
              <span className="lbl">Umrisse anzeigen</span>
              <span
                className="toggle toggle--sm"
                role="presentation"
                aria-checked={umrisseAn}
                style={{ pointerEvents: "none" }}
              />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
