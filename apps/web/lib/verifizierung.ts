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
  // AP1j PR 5 (Beschluss 22.09.2026): Reservierungen laufen ueber DENSELBEN
  // Mechanismus — 12 Monate Gueltigkeit ab reserviert_seit, kein Sonderweg.
  reservierung: 12,
};

function plusMonate(iso: string, monate: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + monate);
  return d.toISOString().slice(0, 10);
}

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
  return plusMonate(beleg.erhebungsdatum, monate);
}

/**
 * Verifikations-Kopplung (AP1j PR 5, Handoff): Faelligkeit = das frueheste
 * von bisheriger Verifikationsfrist und den Ablaufdaten — verfuegbar-bis,
 * jedes befristete vergeben-bis (Zweck: beim Freiwerden nachfassen) und dem
 * Reservierungs-Ende (reserviert_seit + Typ-Gueltigkeit). Offene
 * Vergabe-Enden zaehlen nicht: sie laufen bis zum Verfuegbarkeitsende, das
 * bereits Kandidat ist. Funktioniert auch ohne Beleg.
 */
export function verifikationsFaelligkeit(
  beleg: { typ: string; gueltigBis: string | null; erhebungsdatum: string | null } | null,
  strom: { zeitraumBis: string | null; reserviertSeit: string | null },
  vergaben: { vergebenBis: string | null }[],
): string | null {
  const kandidaten: string[] = [];
  const frist = beleg ? naechsteVerifizierung(beleg) : null;
  if (frist) kandidaten.push(frist);
  if (strom.zeitraumBis) kandidaten.push(strom.zeitraumBis);
  for (const v of vergaben) if (v.vergebenBis) kandidaten.push(v.vergebenBis);
  if (strom.reserviertSeit)
    kandidaten.push(plusMonate(strom.reserviertSeit, BELEG_MONATE.reservierung!));
  return kandidaten.length ? kandidaten.sort()[0]! : null;
}
