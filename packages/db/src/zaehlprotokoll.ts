/**
 * Zaehlprotokoll eines Backups (E37-Nachtrag, 28.09.2026): Beim Erstellen
 * des Dumps werden im SELBEN Snapshot (repeatable read, pg_export_snapshot +
 * pg_dump --snapshot) die Zeilenzahlen je Tabelle und der Migrationsstand
 * festgehalten. Der Restore vergleicht gegen dieses Protokoll — nicht gegen
 * die laufende Production, die sich seit dem Dump veraendert haben darf.
 */
export interface Zaehlprotokoll {
  erstellt: string;
  dump: string;
  snapshot: string;
  migrationen: number;
  tabellen: Record<string, number>;
}

export interface Vergleich {
  fehler: string[];
  zeilen: { tabelle: string; protokoll: number; restore: number | null }[];
}

/** Reiner Vergleich: jede Abweichung ist ein Fehler, jede fehlende Tabelle auch. */
export function vergleicheMitProtokoll(
  protokoll: Zaehlprotokoll,
  restore: { migrationen: number; tabellen: Record<string, number> },
): Vergleich {
  const fehler: string[] = [];
  const zeilen: Vergleich["zeilen"] = [];
  for (const [tabelle, n] of Object.entries(protokoll.tabellen).sort()) {
    const r = restore.tabellen[tabelle];
    zeilen.push({ tabelle, protokoll: n, restore: r ?? null });
    if (r == null) fehler.push(`Tabelle fehlt im Restore: ${tabelle}`);
    else if (r !== n) fehler.push(`${tabelle}: Protokoll ${n}, Restore ${r}`);
  }
  if (restore.migrationen !== protokoll.migrationen)
    fehler.push(`Migrationsstand: Protokoll ${protokoll.migrationen}, Restore ${restore.migrationen}`);
  return { fehler, zeilen };
}

/** Dateiname des Protokolls neben dem Dump. */
export function protokollName(dump: string): string {
  return dump.replace(/\.dump$/, "") + ".zaehlung.json";
}
