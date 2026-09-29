/**
 * Empfaengerregel „Aenderung an meinem Eintrag" als reine Funktion (Entscheidung
 * Eric, AP2.2): alle Beteiligten eines Stroms — abgeleitet aus dem Protokoll,
 * nichts gespeichert — ausser dem Ausloeser selbst, deaktivierten Nutzern und
 * Betrachtern. Sperren und Zuweisen zaehlen nicht als Beteiligung (das
 * regelt bereits `beteiligteAus`).
 */
export interface EmpfaengerKandidat {
  id: string;
  rolle: string;
  aktiv: boolean;
}

export function filtereEmpfaenger(
  beteiligte: readonly string[],
  benutzer: readonly EmpfaengerKandidat[],
  ausloeserId: string,
): string[] {
  const nachId = new Map(benutzer.map((b) => [b.id, b]));
  return beteiligte.filter((id) => {
    if (id === ausloeserId) return false;
    const b = nachId.get(id);
    return !!b && b.aktiv && b.rolle !== "betrachter";
  });
}
