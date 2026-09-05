import { OUTPUT_LABEL } from "@/lib/farben";
import type {
  MaterialartOption,
  RegionOption,
  RegisterFilter,
} from "@/lib/register";

const STATUS = ["entwurf", "in_pruefung", "geprueft", "verworfen"];

/**
 * Gemeinsame Filterleiste fuer Register, Karte und Auswertung (Wiederverwendung
 * laut AP1c/AP1d). Progressive GET-Form: sendet an die aktuelle URL. `hidden`
 * traegt view-spezifische Felder (z. B. Register-Tab).
 */
export function FilterBar({
  filter,
  regionen,
  materialarten,
  hidden = {},
  kategorie = "materialart",
}: {
  filter: RegisterFilter;
  regionen: RegionOption[];
  materialarten: MaterialartOption[];
  hidden?: Record<string, string>;
  /** Kategorie-Filter: Materialart (Biomasse) oder Output-Gruppe (Output). */
  kategorie?: "materialart" | "outputgruppe";
}) {
  return (
    <div className="card">
      <form method="get" className="field-row" style={{ marginBottom: 4 }}>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="field">
          <label>Region</label>
          <select name="region" defaultValue={filter.regionId ?? ""}>
            <option value="">Alle Regionen</option>
            {regionen.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Suche</label>
          <input
            type="search"
            name="q"
            defaultValue={filter.suche ?? ""}
            placeholder="Quelle, Akteur, Landkreis"
          />
        </div>
        {kategorie === "outputgruppe" ? (
          <div className="field">
            <label>Gruppe</label>
            <select name="outputgruppe" defaultValue={filter.outputGruppe ?? ""}>
              <option value="">Alle</option>
              {Object.entries(OUTPUT_LABEL).map(([wert, label]) => (
                <option key={wert} value={wert}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="field">
            <label>Materialart</label>
            <select name="materialart" defaultValue={filter.materialart ?? ""}>
              <option value="">Alle</option>
              {materialarten.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Qualität</label>
          <select name="qualitaet" defaultValue={filter.qualitaet ?? ""}>
            <option value="">Alle</option>
            {["A", "B", "C", "D"].map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Datenjahr</label>
          <input
            type="number"
            name="jahr"
            min={2000}
            max={2100}
            defaultValue={filter.jahr ?? ""}
            placeholder="z. B. 2025"
          />
        </div>
        <div className="field">
          <label>Landkreis</label>
          <input
            type="text"
            name="landkreis"
            defaultValue={filter.landkreis ?? ""}
          />
        </div>
        <div className="field">
          <label>Status</label>
          <select name="status" defaultValue={filter.status ?? ""}>
            <option value="">Alle</option>
            {STATUS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <label>&nbsp;</label>
          <button className="btn" type="submit">
            Filtern
          </button>
        </div>
      </form>
    </div>
  );
}
