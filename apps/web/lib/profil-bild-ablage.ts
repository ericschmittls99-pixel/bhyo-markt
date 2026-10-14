/**
 * Eric 14.10.2026: Das Profilbild ist ein Personendatum — beim Entfernen, beim
 * Ersetzen und bei der Deaktivierung des Nutzers wird die Datei SOFORT aus R2
 * geloescht, in derselben Transaktion wie die Zeile. Schlaegt das Loeschen
 * fehl, rollt die Zeile zurueck und der Nutzer sieht einen Fehler statt einer
 * herrenlosen Datei. Ein Ursprung fuer alle drei Schreibpfade (profil-actions,
 * benutzer-actions); keine "use server"-Datei, damit Klasse und Konstante
 * exportiert werden duerfen.
 */
export class BildLoeschenFehlgeschlagen extends Error {}

export const LOESCH_FEHLER = "Die alte Bilddatei konnte nicht gelöscht werden; nichts wurde geändert. Bitte noch einmal versuchen.";

export async function loescheBild(bucket: { delete: (key: string) => Promise<void> }, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (e) {
    throw new BildLoeschenFehlgeschlagen(e instanceof Error ? e.message : String(e));
  }
}
