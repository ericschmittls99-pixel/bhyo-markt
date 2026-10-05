/**
 * Betriebs-PR (Eric, 05.10.2026): Die Job-Wache prueft zusaetzlich ueber die
 * GitHub-API (nur lesend), ob Backup und Restore-Test juengst erfolgreich
 * liefen: letzter erfolgreicher Backup-Lauf hoechstens 26 Stunden alt,
 * letzter erfolgreicher restore-woechentlich hoechstens 8 Tage. Sonst rot.
 *
 * Reine Pruefung ohne Netz: Der Workflow holt die Laeufe mit `gh api` als
 * JSON-Dateien, dieses Skript urteilt. So ist die Regel ohne Infrastruktur
 * testbar (laeufe-wache.test.ts).
 *
 * Aufruf: tsx src/laeufe-wache.ts <backup.json> <restore.json> [backupMaxStunden] [restoreMaxTage]
 *   Die Dateien sind die Antwort von
 *   GET /repos/{owner}/{repo}/actions/workflows/<datei>/runs?status=success&per_page=1
 *   Kleinere Grenzen als die Vorgabe dienen dem Rot-Nachweis.
 */
import { readFileSync } from "node:fs";

export const BACKUP_MAX_STUNDEN = 26;
export const RESTORE_MAX_TAGE = 8;

export interface LaufInfo {
  conclusion: string | null;
  updated_at: string;
  html_url?: string;
}

export interface Urteil {
  ok: boolean;
  letzter: string | null;
  alterStunden: number | null;
  grund: string | null;
}

/** Juengster erfolgreicher Lauf hoechstens maxStunden alt; kein Lauf = rot. */
export function pruefeAlter(laeufe: LaufInfo[], jetzt: Date, maxStunden: number): Urteil {
  const erfolg = laeufe
    .filter((l) => l.conclusion === "success")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const letzter = erfolg[0];
  if (!letzter) return { ok: false, letzter: null, alterStunden: null, grund: "kein erfolgreicher Lauf gefunden" };
  const alterStunden = (jetzt.getTime() - Date.parse(letzter.updated_at)) / 3_600_000;
  if (!Number.isFinite(alterStunden)) return { ok: false, letzter: letzter.updated_at, alterStunden: null, grund: "Zeitstempel nicht lesbar" };
  if (alterStunden > maxStunden) {
    return { ok: false, letzter: letzter.updated_at, alterStunden, grund: `letzter Erfolg vor ${alterStunden.toFixed(1)} h, erlaubt ${maxStunden} h` };
  }
  return { ok: true, letzter: letzter.updated_at, alterStunden, grund: null };
}

function laeufeAus(datei: string): LaufInfo[] {
  const json = JSON.parse(readFileSync(datei, "utf8")) as { workflow_runs?: LaufInfo[] };
  return json.workflow_runs ?? [];
}

if (process.argv[1]?.endsWith("laeufe-wache.ts")) {
  const [backupDatei, restoreDatei, backupMax, restoreMax] = process.argv.slice(2);
  if (!backupDatei || !restoreDatei) {
    console.error("::error::LAEUFE-WACHE ROT: Aufruf <backup.json> <restore.json> [backupMaxStunden] [restoreMaxTage]");
    process.exit(2);
  }
  const jetzt = new Date();
  const grenzen = {
    backupStunden: backupMax ? Number(backupMax) : BACKUP_MAX_STUNDEN,
    restoreStunden: (restoreMax ? Number(restoreMax) : RESTORE_MAX_TAGE) * 24,
  };
  const backup = pruefeAlter(laeufeAus(backupDatei), jetzt, grenzen.backupStunden);
  const restore = pruefeAlter(laeufeAus(restoreDatei), jetzt, grenzen.restoreStunden);
  console.log(`LAEUFE_WACHE jetzt=${jetzt.toISOString()} backup=${JSON.stringify(backup)} restore=${JSON.stringify(restore)} grenzen=${JSON.stringify(grenzen)}`);
  const rot: string[] = [];
  if (!backup.ok) rot.push(`Backup: ${backup.grund}`);
  if (!restore.ok) rot.push(`Restore-Test: ${restore.grund}`);
  if (rot.length) {
    console.error(`::error::LAEUFE-WACHE ROT: ${rot.join(" · ")}`);
    process.exit(1);
  }
  console.log(`LAEUFE_WACHE OK — Backup vor ${backup.alterStunden!.toFixed(1)} h, Restore-Test vor ${(restore.alterStunden! / 24).toFixed(1)} Tagen.`);
}
