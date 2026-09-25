/**
 * Filter „Vergeben ab / bis" (F5 PR B). Reine Funktion.
 *
 * **Die Auslegung: gewöhnliche Überschneidung.** Der Filter beantwortet
 * „was ist in diesem Zeitraum vergeben", nicht „was ändert sich darin"
 * (Entscheidung Eric, 25.09.2026). Ein Strom, der von 2020 bis 2099 vergeben
 * ist, ist im Fenster 2027 durchgehend vergeben — er ist der wichtigste
 * Treffer, nicht der einzige Nicht-Treffer.
 *
 * | Fall | Vergabe | Treffer |
 * | --- | --- | --- |
 * | 1 | beginnt davor, endet im Fenster | ja |
 * | 2 | liegt vollständig im Fenster | ja |
 * | 3 | beginnt im Fenster, endet danach | ja |
 * | 4 | umschließt das Fenster | ja |
 * | 5 | liegt ganz davor oder ganz danach | **nein** |
 *
 * **Offene Enden** werden wie in `verfuegbarkeit.ts` ersetzt: ein fehlendes
 * `vergebenVon` durch den Verfügbarkeitsbeginn, ein fehlendes `vergebenBis`
 * durch das Verfügbarkeitsende. Kein zweites Regelwerk für dieselbe Sache.
 *
 * Bleibt ein Ende auch danach offen, trifft die Vergabe **jedes** Fenster:
 * Wir wissen nicht, wann sie endet, also können wir sie nicht ausschließen.
 * Ein geratenes Ende wäre schlechter als ein weiter Treffer.
 */

export interface VergabeFenster {
  /** Untergrenze (JJJJ-MM) oder "". */
  von: string;
  /** Obergrenze (JJJJ-MM) oder "". */
  bis: string;
  /**
   * Benannter Zustand: Ströme ganz **ohne** Vergabe mitnehmen. Ohne ihn
   * fielen sie bei gesetztem Fenster heraus — still, und ohne dass man sie
   * gezielt hätte suchen können (E24-Haltung).
   */
  nichtVergeben: boolean;
}

export interface VergabeZeile {
  vergebenVon: string | null;
  vergebenBis: string | null;
}

export interface FensterStrom {
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  vergaben?: VergabeZeile[];
}

/** Fensteruntergrenze als Datum, oder null für „offen nach unten". */
function fensterVon(f: VergabeFenster): string | null {
  return f.von ? `${f.von}-01` : null;
}

/** Fensterobergrenze; der ganze Endmonat zählt dazu. */
function fensterBis(f: VergabeFenster): string | null {
  return f.bis ? `${f.bis}-31` : null;
}

export function istLeer(f: VergabeFenster): boolean {
  return !f.von && !f.bis && !f.nichtVergeben;
}

/** Trifft der Strom das Vergabefenster? */
export function trifftVergabefenster(s: FensterStrom, f: VergabeFenster): boolean {
  if (istLeer(f)) return true;

  const vergaben = s.vergaben ?? [];
  if (vergaben.length === 0) {
    // „nicht vergeben" ist ein Zustand, den man gezielt waehlen kann — und
    // nur dann trifft er.
    return f.nichtVergeben;
  }

  // Ist nur der Zustand gewaehlt und kein Fenster, zaehlen ausschliesslich
  // die unvergebenen Stroeme.
  if (!f.von && !f.bis) return false;

  const fv = fensterVon(f);
  const fb = fensterBis(f);

  return vergaben.some((v) => {
    const beginn = v.vergebenVon ?? s.zeitraumVon;
    const ende = v.vergebenBis ?? s.zeitraumBis;
    // Ueberschneidung: Die Vergabe beginnt nicht NACH dem Fenster und endet
    // nicht DAVOR. Ein offenes Ende kann nichts ausschliessen — null zaehlt
    // deshalb als "reicht in diese Richtung unbegrenzt".
    if (fb && beginn && beginn > fb) return false;
    if (fv && ende && ende < fv) return false;
    return true;
  });
}
