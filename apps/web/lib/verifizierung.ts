// Verifizierungs-Fristen je Beleg-Typ (AP1i, Entscheidung E3): die Mockup-Werte
// sind von Eric als VORLAEUFIGE reine Anzeige-Regel freigegeben — keine
// Fachfreigabe, kein Schema-Feld. Ein gespeichertes beleg.gueltig_bis (Angebot,
// Betriebsdaten) hat Vorrang; fuer alle anderen Typen wird die Frist nur zur
// Anzeige aus dem Erhebungsdatum gerechnet.

export const BELEG_MONATE: Record<string, number> = {
  vertrag: 36,
  betriebsdaten: 12,
  absichtserklaerung: 12,
  angebot: 3,
  dokument_link: 12,
  gespraech: 6,
};

/** Anzeigedatum der naechsten Verifizierung (ISO) oder null. */
export function naechsteVerifizierung(beleg: {
  typ: string;
  gueltigBis: string | null;
  erhebungsdatum: string | null;
}): string | null {
  if (beleg.gueltigBis) return beleg.gueltigBis;
  if (!beleg.erhebungsdatum) return null;
  const monate = BELEG_MONATE[beleg.typ];
  if (!monate) return null;
  const d = new Date(`${beleg.erhebungsdatum}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
}
