"use client";

import { useRouter } from "next/navigation";
import type { PreisKorridorEinzel as PreisKorridorEinzelDaten } from "@/lib/preiskorridor-einzel";
import { useEffect, useRef, useState } from "react";

import type { FacettenChipDef } from "@/components/stroeme/FacettenChips";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import {
  KarteMap,
  type KarteRegion,
  type KarteSteuerung,
} from "@/components/karte/KarteMap";
import { KarteControls, KarteToolbar } from "@/components/karte/KarteToolbar";
import { KarteLegende } from "@/components/karte/KarteLegende";
import { ZeichnenDialog } from "@/components/karte/ZeichnenDialog";
import { Detail } from "@/components/stroeme/Detail";
import {
  punkteInBbox,
  type KartePunkt,
  type KarteTreffer,
} from "@/lib/karte-modell";
import type { Strom } from "@/lib/stroeme-modell";
import { updateUiCookie } from "@/lib/ui-state";
import type {
  VerfuegbarkeitsErgebnis,
  VergabeDaten,
} from "@/lib/verfuegbarkeit";

type Bbox = [number, number, number, number];
interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Client-Orchestrator von karte. (PR 6): verdrahtet Toolbar, Karte, Legende,
 * Marker-Panel und Zeichnen-Dialog. Datenfilter leben im Querystring
 * (inkl. sicht und detail), Bedienzustand (Legende, Regionsschalter,
 * Filterleiste) im Cookie bhyo_ui.
 */
export function KarteAnsicht({
  punkte,
  poolPunkte,
  gesamtStroeme,
  regionen,
  facetten,
  auswahl,
  bereich,
  bereichKeys,
  ruecksetzParams,
  zurueckgehalten,
  hinweise,
  sicht,
  detailPunkt,
  detailStrom,
  detailVerfuegbarkeit,
  detailVergaben,
  historie,
  begruendung,
  verifizierung,
  preisKorridor = null,
  filterOffenInitial,
  legendeInitial,
  umrisseInitial,
  irgendeinFilter,
}: {
  punkte: KartePunkt[];
  /** Ungefilterte Pins beider Arten — Pool-Zaehlung der Legende (PR 3). */
  poolPunkte: KartePunkt[];
  gesamtStroeme: number;
  regionen: KarteRegion[];
  facetten: FacettenChipDef[];
  auswahl: Record<string, string[]>;
  bereich: Record<string, string>;
  bereichKeys: readonly string[];
  ruecksetzParams: readonly string[];
  zurueckgehalten: string[];
  /** F5 PR B: nicht beruecksichtigte Stroeme, fertige Saetze (LeistenHinweise). */
  hinweise: string[];
  sicht: "alle" | "feedstock" | "outputs";
  detailPunkt: KartePunkt | null;
  detailStrom: Strom | null;
  detailVerfuegbarkeit: VerfuegbarkeitsErgebnis | null;
  detailVergaben: VergabeDaten[];
  historie: { zeitpunkt: string; text: string }[];
  begruendung: string | null;
  verifizierung: string | null;
  /** E38 */
  preisKorridor?: PreisKorridorEinzelDaten | null;
  filterOffenInitial: boolean;
  legendeInitial: { offen: boolean; hoehe?: number };
  umrisseInitial: boolean;
  irgendeinFilter: boolean;
}) {
  const router = useRouter();
  const { setze } = useUrlZustand();
  const steuerung = useRef<KarteSteuerung | null>(null);

  const [zeichnenAktiv, setZeichnenAktiv] = useState(false);
  const [auswahlRect, setAuswahlRect] = useState<{ bbox: Bbox; box: PixelBox } | null>(
    null,
  );
  const [umrisseAn, setUmrisseAn] = useState(umrisseInitial);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      if (auswahlRect) return setAuswahlRect(null);
      if (zeichnenAktiv) setZeichnenAktiv(false);
      // Detail schliesst sich selbst per Escape (eigener Handler).
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function zeigeToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  function umrisseToggle() {
    setUmrisseAn((alt) => {
      const neu = !alt;
      const legende = updateUiCookie({}).legende ?? { offen: true };
      updateUiCookie({ legende: { ...legende, umrisse: neu } });
      return neu;
    });
  }

  function facetteToggle(key: string, wert: string) {
    const sel = auswahl[key] ?? [];
    const neu = sel.includes(wert) ? sel.filter((v) => v !== wert) : [...sel, wert];
    setze({ [key]: neu });
  }

  function trefferWaehlen(t: KarteTreffer) {
    if (t.typ === "region" && t.id) {
      steuerung.current?.fitRegion(t.id);
    } else if (t.typ === "strom" && t.id != null && t.lng != null && t.lat != null) {
      setze({ detail: t.id }, "push");
      steuerung.current?.flyTo(t.lng, t.lat, 12);
    } else if (t.lng != null && t.lat != null) {
      steuerung.current?.flyTo(t.lng, t.lat, 11);
    }
  }

  async function regionAnlegen(name: string) {
    if (!auswahlRect) return;
    const res = await fetch("/api/regionen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, bbox: auswahlRect.bbox }),
    });
    if (res.ok) {
      setAuswahlRect(null);
      setZeichnenAktiv(false);
      zeigeToast(`Fokusregion „${name}" angelegt`);
      router.refresh();
    } else {
      zeigeToast("Anlegen fehlgeschlagen. Bitte erneut versuchen.");
    }
  }

  return (
    <div className="km-seite">
      <KarteMap
        punkte={punkte}
        regionen={regionen}
        umrisseAn={umrisseAn}
        aktivId={detailPunkt?.id ?? null}
        zeichnenAktiv={zeichnenAktiv}
        onPunktKlick={(id) => setze({ detail: id }, "push")}
        onRegionKlick={(id) => steuerung.current?.fitRegion(id)}
        onAuswahl={(bbox, box) => setAuswahlRect({ bbox, box })}
        auswahlBox={auswahlRect?.box ?? null}
        steuerungRef={steuerung}
      />

      <KarteToolbar
        punkte={punkte}
        regionen={regionen}
        facetten={facetten}
        auswahl={auswahl}
        bereich={bereich}
        bereichKeys={bereichKeys}
        ruecksetzParams={ruecksetzParams}
        zurueckgehalten={zurueckgehalten}
        hinweise={hinweise}
        sicht={sicht}
        offenInitial={filterOffenInitial}
        irgendeinFilter={irgendeinFilter}
        onTreffer={trefferWaehlen}
      />

      <KarteControls
        onZoomIn={() => steuerung.current?.zoomIn()}
        onZoomOut={() => steuerung.current?.zoomOut()}
        onFitAlle={() => steuerung.current?.fitAlle()}
        zeichnenAktiv={zeichnenAktiv}
        onZeichnen={() => {
          setZeichnenAktiv((v) => !v);
          setAuswahlRect(null);
        }}
      />

      <KarteLegende
        punkte={punkte}
        poolPunkte={poolPunkte}
        gesamtStroeme={gesamtStroeme}
        umrisseAn={umrisseAn}
        onUmrisseToggle={umrisseToggle}
        onClusterKlick={(k) => facetteToggle("cluster", k)}
        onGruppeKlick={(k) => facetteToggle("gruppe", k)}
        auswahlCluster={auswahl.cluster ?? []}
        auswahlGruppe={auswahl.gruppe ?? []}
        initial={legendeInitial}
      />

      {detailStrom && (
        <Detail
          strom={detailStrom}
          historie={historie}
          begruendung={begruendung}
          verifizierung={verifizierung}
          preisKorridor={preisKorridor}
          verfuegbarkeit={detailVerfuegbarkeit}
          vergaben={detailVergaben}
          modal={false}
          canEdit={false}
          stroemeHref={`/register?tab=${detailStrom.art === "biomasse" ? "biomasse" : "output"}&detail=${detailStrom.id}`}
        />
      )}

      {zeichnenAktiv && !auswahlRect && (
        <div className="km-zeichnen-hinweis" role="status">
          Rechteck über die Karte ziehen · Esc bricht ab
        </div>
      )}

      {zeichnenAktiv && auswahlRect && (
        <ZeichnenDialog
          box={auswahlRect.box}
          bbox={auswahlRect.bbox}
          anzahl={punkteInBbox(punkte, auswahlRect.bbox)}
          onAnlegen={regionAnlegen}
          onNeu={() => setAuswahlRect(null)}
          onAbbrechen={() => {
            setAuswahlRect(null);
            setZeichnenAktiv(false);
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <i className="ph ph-check-circle" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
