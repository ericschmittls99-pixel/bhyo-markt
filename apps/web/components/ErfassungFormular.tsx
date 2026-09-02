"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { AkteurCombobox } from "@/components/AkteurCombobox";
import { MaterialartCombobox } from "@/components/MaterialartCombobox";
import { QualitaetPill } from "@/components/Pills";
import { SaisonEditor } from "@/components/SaisonEditor";
import type { FormState } from "@/lib/actions";
import { type BelegTyp, deriveQualitaet } from "@/lib/qualitaet";

const BELEG_TYPEN: { typ: BelegTyp; label: string }[] = [
  { typ: "dokument_link", label: "Dokument/Link" },
  { typ: "gespraech", label: "Gespräch" },
  { typ: "angebot", label: "Angebot" },
  { typ: "absichtserklaerung", label: "Absichtserklärung" },
  { typ: "vertrag", label: "Vertrag" },
  { typ: "betriebsdaten", label: "Betriebsdaten" },
];

// Fester Enum output_vektor – Erweiterung braucht eine Migration, kein Add-Button.
const VEKTOREN: { wert: string; label: string }[] = [
  { wert: "waerme", label: "Wärme" },
  { wert: "h2", label: "H₂" },
  { wert: "co2", label: "CO₂" },
];

export function ErfassungFormular({
  art,
  action,
}: {
  art: "biomasse" | "output";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  // Beleg-Zustand fuer die Live-Vorschau der (read-only) Qualitaetsstufe.
  const [typ, setTyp] = useState<BelegTyp | "">("");
  const [extern, setExtern] = useState(false);
  const [amtlich, setAmtlich] = useState(false);
  const [quellenangabe, setQuellenangabe] = useState("");
  const [erhebungsdatum, setErhebungsdatum] = useState("");
  const [link, setLink] = useState("");
  const [dateiDa, setDateiDa] = useState(false);
  const [gueltigBis, setGueltigBis] = useState("");
  const [gespraechsdatum, setGespraechsdatum] = useState("");
  const [gespraechspartner, setGespraechspartner] = useState("");

  // Mengen fuer die read-only atro-Vorschau (nur Biomasse).
  const [roh, setRoh] = useState("");
  const [ts, setTs] = useState("");
  const [asche, setAsche] = useState("");
  const atro =
    roh && ts && asche
      ? (Number(roh) * (Number(ts) / 100) * (1 - Number(asche) / 100)).toLocaleString(
          "de-DE",
          { maximumFractionDigits: 1 },
        )
      : "—";

  const qualitaet = typ
    ? deriveQualitaet({
        typ,
        externNachvollziehbar: extern,
        erhebungsdatum: erhebungsdatum || null,
        dateiKey: dateiDa ? "x" : null,
        linkUrl: link || null,
        gueltigBis: typ === "angebot" ? gueltigBis || null : null,
        metadata: { amtlich, quellenangabe, gespraechsdatum, gespraechspartner },
      })
    : null;

  return (
    <form action={formAction} className="stack" style={{ gap: 16 }}>
      {/* Kopf */}
      <div className="card">
        <div className="row">
          <h2>
            {art === "biomasse" ? "Biomassestrom" : "Output-Bedarf"} anlegen
          </h2>
          <span className="spacer" />
          <span className="muted">Qualität (abgeleitet):</span>
          <QualitaetPill stufe={qualitaet} />
        </div>
      </div>

      {/* Quelle */}
      <div className="card">
        <div className="card-title">Quelle</div>
        <div className="field-row">
          <AkteurCombobox name="akteur_id" />
        </div>
        <div className="field-row">
          <div className="field">
            <label>Bezeichnung</label>
            <input type="text" name="bezeichnung" placeholder="z. B. Sägewerk Nord" />
          </div>
          <div className="field">
            <label>Ort</label>
            <input type="text" name="ort" />
          </div>
          <div className="field">
            <label>Landkreis</label>
            <input type="text" name="landkreis" />
          </div>
          <div className="field">
            <label>Kontaktperson</label>
            <input type="text" name="kontaktperson" />
          </div>
        </div>
        <p className="hint">
          Standort gehört zum einzelnen Strom, nicht zum Akteur – ein Akteur kann
          mehrere Sites haben. Die Region wird später räumlich aus dem Standort
          abgeleitet, nicht manuell gewählt. Geocoding/Karten-Pin folgt in AP1c.
        </p>
      </div>

      {/* Kategorie & Zeitraum */}
      <div className="card">
        <div className="card-title">
          {art === "biomasse" ? "Materialart & Zeitraum" : "Vektor & Zeitraum"}
        </div>
        <div className="field-row">
          {art === "biomasse" ? (
            <MaterialartCombobox name="materialart_code" />
          ) : (
            <div className="field">
              <label>Output-Vektor *</label>
              <select name="vektor" defaultValue="" required>
                <option value="" disabled>
                  wählen…
                </option>
                {VEKTOREN.map((v) => (
                  <option key={v.wert} value={v.wert}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Zeitraum von *</label>
            <input type="date" name="zeitraum_von" required />
          </div>
          <div className="field">
            <label>Zeitraum bis *</label>
            <input type="date" name="zeitraum_bis" required />
          </div>
        </div>
      </div>

      {/* Mengen */}
      <div className="card">
        <div className="card-title">
          {art === "biomasse" ? "Mengen" : "Bedarfsmenge"}
        </div>
        {art === "biomasse" ? (
          <>
            <div className="field-row">
              <div className="field">
                <label>Rohmenge (FM) *</label>
                <input
                  type="number"
                  name="menge_roh_fm"
                  step="0.01"
                  required
                  value={roh}
                  onChange={(e) => setRoh(e.target.value)}
                />
              </div>
              <div className="field">
                <label>TS-Anteil (%) *</label>
                <input
                  type="number"
                  name="ts_anteil_pct"
                  step="0.1"
                  required
                  value={ts}
                  onChange={(e) => setTs(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Aschegehalt (%) *</label>
                <input
                  type="number"
                  name="aschegehalt_pct"
                  step="0.1"
                  required
                  value={asche}
                  onChange={(e) => setAsche(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Trockenmasse (t atro)</label>
                <input className="readonly" type="text" value={atro} readOnly />
                <span className="hint">automatisch berechnet</span>
              </div>
            </div>
          </>
        ) : (
          <div className="field-row">
            <div className="field">
              <label>Bedarfsmenge *</label>
              <input type="number" name="menge_wert" step="0.01" required />
            </div>
            <div className="field">
              <label>Einheit *</label>
              <input type="text" name="menge_einheit" placeholder="MWh/a, t/a …" required />
            </div>
          </div>
        )}
      </div>

      {/* Saisonalitaet */}
      <div className="card">
        <div className="card-title">Saisonalität</div>
        <SaisonEditor />
      </div>

      {/* Preis (nur Biomasse) */}
      {art === "biomasse" && (
        <div className="card">
          <div className="card-title">Preis-Korridor (€/t)</div>
          <div className="field-row">
            <div className="field">
              <label>Min</label>
              <input type="number" name="preis_min" step="0.01" />
            </div>
            <div className="field">
              <label>Mittel</label>
              <input type="number" name="preis_mittel" step="0.01" />
            </div>
            <div className="field">
              <label>Max</label>
              <input type="number" name="preis_max" step="0.01" />
            </div>
            <div className="field">
              <label>Herkunft</label>
              <select name="preis_herkunft" defaultValue="">
                <option value="">—</option>
                <option value="eigene_datenbank">eigene Datenbank</option>
                <option value="marktdaten">Marktdaten</option>
                <option value="schaetzung">Schätzung</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Beleg */}
      <div className="card">
        <div className="card-title">Beleg</div>
        <input type="hidden" name="beleg_typ" value={typ} />
        <div className="pill-group" style={{ marginBottom: 14 }}>
          {BELEG_TYPEN.map((b) => (
            <button
              key={b.typ}
              type="button"
              className="pill-toggle"
              aria-pressed={typ === b.typ}
              onClick={() => setTyp(typ === b.typ ? "" : b.typ)}
            >
              {b.label}
            </button>
          ))}
        </div>

        {typ && (
          <>
            <div className="field-row">
              <div className="field">
                <label>Quellenangabe *</label>
                <input
                  type="text"
                  name="beleg_quellenangabe"
                  value={quellenangabe}
                  onChange={(e) => setQuellenangabe(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Erhebungsdatum *</label>
                <input
                  type="date"
                  name="beleg_erhebungsdatum"
                  value={erhebungsdatum}
                  onChange={(e) => setErhebungsdatum(e.target.value)}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Datei-Upload</label>
                <input
                  type="file"
                  name="beleg_datei"
                  onChange={(e) => setDateiDa(!!e.target.files?.length)}
                />
              </div>
              <div className="field">
                <label>oder Link</label>
                <input
                  type="url"
                  name="beleg_link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>

            {typ === "gespraech" && (
              <div className="field-row">
                <div className="field">
                  <label>Gesprächsdatum</label>
                  <input
                    type="date"
                    name="beleg_gespraechsdatum"
                    value={gespraechsdatum}
                    onChange={(e) => setGespraechsdatum(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Gesprächspartner</label>
                  <input
                    type="text"
                    name="beleg_gespraechspartner"
                    value={gespraechspartner}
                    onChange={(e) => setGespraechspartner(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Kernnotiz</label>
                  <input type="text" name="beleg_kernnotiz" />
                </div>
              </div>
            )}

            {typ === "angebot" && (
              <div className="field">
                <label>Gültig bis</label>
                <input
                  type="date"
                  name="beleg_gueltig_bis"
                  value={gueltigBis}
                  onChange={(e) => setGueltigBis(e.target.value)}
                />
              </div>
            )}

            <div className="row" style={{ gap: 20, marginTop: 6 }}>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  name="beleg_extern"
                  checked={extern}
                  onChange={(e) => setExtern(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Extern nachvollziehbar
              </label>
              {typ === "dokument_link" && (
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    name="beleg_amtlich"
                    checked={amtlich}
                    onChange={(e) => setAmtlich(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  Amtliche Quelle oder Betreiberdaten
                </label>
              )}
            </div>
          </>
        )}
      </div>

      {/* Begruendung + Status + Absenden */}
      <div className="card">
        <div className="field">
          <label>Begründung *</label>
          <textarea
            name="begruendung"
            required
            placeholder="Warum wird dieser Datensatz so erfasst?"
          />
          <span className="hint">
            Wird in der Änderungshistorie protokolliert.
          </span>
        </div>
        <div className="field" style={{ maxWidth: 260 }}>
          <label>Status</label>
          <select name="status" defaultValue="entwurf">
            <option value="entwurf">Entwurf</option>
            <option value="in_pruefung">in Prüfung</option>
            <option value="geprueft">geprüft</option>
          </select>
        </div>

        {state.error && <div className="error">{state.error}</div>}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn--primary" type="submit" disabled={pending}>
            {pending ? "Speichert…" : "Speichern"}
          </button>
          <Link className="btn btn--ghost" href={`/register?tab=${art}`}>
            Abbrechen
          </Link>
        </div>
      </div>
    </form>
  );
}
