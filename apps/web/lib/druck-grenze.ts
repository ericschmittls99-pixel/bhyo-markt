/**
 * F6 PR B, Nachtrag (28.09.2026): Obergrenze für den Druck-Abzug.
 *
 * Lasttest auf der Preview: 128 Datenblätter brauchten 673 ms CPU je Aufruf.
 * Der Worker läuft im Free-Plan mit 10 ms CPU-Budget je Anfrage (Bursts
 * werden geduldet, Dauerüberschreitung nicht) — nach zwei Aufrufen stand der
 * gesamte Preview-Worker mit 1102 „exceeded resource limits", auch /api/health.
 * Der Druck darf die Anwendung nicht mitreißen: oberhalb der Grenze gibt es
 * Kopf, Zusammenfassung und einen klaren Hinweis statt Datenblätter.
 *
 * 50 Blätter ≈ 250 ms CPU (5 ms je Blatt gemessen) — deutlich unter dem, was
 * den Worker gekippt hat, und mehr, als auf einen Kommunen-Abzug gehört.
 */
export const DRUCK_OBERGRENZE = 50;

export function druckErlaubt(anzahl: number): boolean {
  return anzahl <= DRUCK_OBERGRENZE;
}

export function druckHinweis(anzahl: number): string {
  return `Zu viele Ströme für den Druck: ${anzahl} Datenblätter, Obergrenze ${DRUCK_OBERGRENZE}. Bitte Filter setzen (Cluster, Landkreis, Verfügbarkeit …) oder die CSV nutzen — sie kennt keine Obergrenze.`;
}

/**
 * Testschalter für den Lasttest: `?grenze=aus` hebt die Obergrenze auf —
 * AUSSCHLIESSLICH auf der Preview (ENVIRONMENT = "preview"). Production kennt
 * keinen Weg an der Grenze vorbei; ein 128-seitiger Ausdruck nützt niemandem.
 */
export function grenzeAusgesetzt(param: string | null | undefined, umgebung: string): boolean {
  return umgebung === "preview" && param === "aus";
}
