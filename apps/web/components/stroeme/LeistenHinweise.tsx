/**
 * Die beiden Ehrlichkeits-Hinweise der Filterleiste, geteilt zwischen
 * stroeme., karte. und auswertung. (vorher stand die zurueckgehalten-Span
 * dreimal im Code):
 *
 * - E32: gesetzte Filter, die hier nicht gelten — sie wirken nicht, bleiben
 *   aber sichtbar, sonst haelt man eine Liste fuer ungefiltert, die
 *   anderswo gefiltert ist.
 * - F5 PR B: Stroeme, die eine gesetzte Bereichsgroesse nicht besitzen
 *   (z. B. "ohne Energieäquivalent") — sie werden nicht mitverglichen und
 *   die Leiste sagt das, statt sie lautlos verschwinden zu lassen.
 */
export function LeistenHinweise({
  zurueckgehalten,
  hinweise,
}: {
  /** Beschriftungen der gesetzten, hier nicht geltenden Filter. */
  zurueckgehalten: string[];
  /** Fertige Saetze aus nichtBeruecksichtigtText(). */
  hinweise: string[];
}) {
  return (
    <>
      {zurueckgehalten.length > 0 && (
        <span className="st-zurueckgehalten" title={zurueckgehalten.join(", ")}>
          <i className="ph ph-funnel-simple" aria-hidden />
          {zurueckgehalten.length === 1
            ? "1 Filter gilt hier nicht"
            : `${zurueckgehalten.length} Filter gelten hier nicht`}
        </span>
      )}
      {hinweise.map((text) => (
        <span key={text} className="st-zurueckgehalten" title={text}>
          <i className="ph ph-info" aria-hidden />
          {text}
        </span>
      ))}
    </>
  );
}
