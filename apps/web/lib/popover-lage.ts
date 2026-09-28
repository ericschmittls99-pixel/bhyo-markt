/**
 * Lage eines Popovers relativ zu seinem Anker (Rückmeldung 1, 28.09.2026):
 * Ein Popover darf nie über den rechten Fensterrand hinausragen. Reicht der
 * Platz rechts vom Anker nicht, öffnet es nach links (rechte Kante am Anker);
 * reicht auch das nicht (schmales Fenster), wird es so weit verschoben, dass
 * es in das Fenster passt, und in der Breite gedeckelt. EIN Ursprung für
 * ströme., auswertung. und karte. — angewendet über usePopoverLage.
 */
export interface PopoverLage {
  /** links: linke Kante am Anker; rechts: rechte Kante am Anker. */
  seite: "links" | "rechts";
  /** Zusätzliche Verschiebung in px (≤ 0 = nach links), wenn beides zu eng ist. */
  versatz: number;
  /** Deckel für die Breite: Fensterbreite minus beidseitigem Rand. */
  maxBreite: number;
}

export interface PopoverMasse {
  ankerLinks: number;
  ankerRechts: number;
  popBreite: number;
  fensterBreite: number;
  /** Mindestabstand zum Fensterrand, voreingestellt 8 px. */
  rand?: number;
}

export function popoverLage(m: PopoverMasse): PopoverLage {
  const rand = m.rand ?? 8;
  const maxBreite = Math.max(0, m.fensterBreite - 2 * rand);
  const breite = Math.min(m.popBreite, maxBreite);
  const passt = (links: number) => links >= rand && links + breite <= m.fensterBreite - rand;
  // 1. Regelfall: linke Kante am Anker, es passt nach rechts.
  // 2. Rechts kein Platz: nach links öffnen (rechte Kante am Anker).
  // 3. Beides zu eng (schmales Fenster): links öffnen und so weit
  //    verschieben, dass das Popover im Fenster liegt.
  const seite: PopoverLage["seite"] =
    passt(m.ankerLinks) || !passt(m.ankerRechts - breite) ? "links" : "rechts";
  const links = seite === "links" ? m.ankerLinks : m.ankerRechts - breite;
  const versatz =
    links < rand ? rand - links : Math.min(0, m.fensterBreite - rand - (links + breite));
  return { seite, versatz, maxBreite };
}

/** Linke und rechte Kante, die aus einer Lage folgen — für Tests und Prüfung. */
export function popoverKanten(m: PopoverMasse, l: PopoverLage): { links: number; rechts: number } {
  const breite = Math.min(m.popBreite, l.maxBreite);
  const links = (l.seite === "links" ? m.ankerLinks : m.ankerRechts - breite) + l.versatz;
  return { links, rechts: links + breite };
}
