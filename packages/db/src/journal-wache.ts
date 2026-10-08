/**
 * Journal-Waechter (Eric 08.10.2026): Der Drizzle-Migrator wendet nur
 * Migrationen an, deren Journal-`when` GROESSER ist als `created_at` der
 * zuletzt angewendeten Zeile. Eine umnummerierte Migration aus einem
 * aelteren Branch (Nummer neu, `when` alt) wuerde still uebersprungen —
 * schema-gate meldet dann Rueckstand, migrate-production tut nichts.
 * Deshalb: idx lueckenlos aufsteigend ab 0, tag beginnt mit der
 * vierstelligen idx, `when` strikt groesser als das vorige, und zu jedem tag
 * liegt die SQL-Datei. Reine Funktion; der Test fuettert das echte Journal
 * und eine vertauschte Kopie (Rot-Nachweis).
 */
export interface JournalEintrag {
  idx: number;
  when: number;
  tag: string;
}

export function pruefeJournal(eintraege: readonly JournalEintrag[], sqlDateien: readonly string[]): string[] {
  const fehler: string[] = [];
  const dateien = new Set(sqlDateien);
  eintraege.forEach((e, i) => {
    if (e.idx !== i) fehler.push(`Eintrag ${i}: idx ${e.idx} statt ${i} (Luecke oder Reihenfolge)`);
    const praefix = String(e.idx).padStart(4, "0");
    if (!e.tag.startsWith(`${praefix}_`)) fehler.push(`Eintrag ${i}: tag „${e.tag}" beginnt nicht mit ${praefix}_`);
    if (i > 0 && !(e.when > eintraege[i - 1]!.when)) fehler.push(`Eintrag ${i} (${e.tag}): when ${e.when} ist nicht groesser als ${eintraege[i - 1]!.when} (${eintraege[i - 1]!.tag}) — der Migrator wuerde sie ueberspringen`);
    if (!dateien.has(`${e.tag}.sql`)) fehler.push(`Eintrag ${i}: Datei ${e.tag}.sql fehlt`);
  });
  for (const d of sqlDateien) {
    if (d.endsWith(".sql") && !eintraege.some((e) => `${e.tag}.sql` === d)) fehler.push(`Datei ${d} steht nicht im Journal`);
  }
  return fehler;
}
