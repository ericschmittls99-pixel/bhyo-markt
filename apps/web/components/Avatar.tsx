import type { SperrNutzer } from "@/lib/stroeme-modell";

/**
 * E44 (AP2.1 PR b): Avatar aus Initialen, Farbe deterministisch aus der
 * Nutzer-ID ueber Design-Tokens (--av-1 … --av-8, Light/Dark in globals.css),
 * Groessen s (24 px) und m (32 px). Kein Foto-Upload. Wiederverwendbar fuer
 * Inbox und Kommentare (AP2.2 ff.).
 */
export function initialen(n: { name: string | null; email: string }): string {
  const quelle = (n.name ?? "").trim();
  if (quelle) {
    const teile = quelle.split(/\s+/).filter(Boolean);
    return (teile.length >= 2 ? teile[0]![0]! + teile[teile.length - 1]![0]! : quelle.slice(0, 2)).toUpperCase();
  }
  return n.email.split("@")[0]!.slice(0, 2).toUpperCase();
}

/** Stabile Farbnummer 1–8 aus der ID (FNV-1a, damit dieselbe Person überall dieselbe Farbe hat). */
export function farbNummer(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 8) + 1;
}

export function anzeigeName(n: { name: string | null; email: string }): string {
  return n.name ?? n.email;
}

export function Avatar({
  nutzer,
  groesse = "s",
  title,
  badge,
}: {
  nutzer: SperrNutzer;
  groesse?: "s" | "m";
  title?: string;
  /** Kleines Zeichen unten rechts, z. B. das Schloss des Sperrinhabers. */
  badge?: "schloss";
}) {
  return (
    <span
      className={`av av--${groesse} av-c${farbNummer(nutzer.id)}`}
      title={title ?? anzeigeName(nutzer)}
      aria-label={anzeigeName(nutzer)}
      role="img"
    >
      {initialen(nutzer)}
      {badge === "schloss" && <i className="ph-fill ph-lock av-badge" aria-hidden />}
    </span>
  );
}

/** Stapel: Sperrinhaber zuerst (mit Schloss), dann Zugewiesene. */
export function AvatarStapel({
  inhaber,
  zugewiesene,
  gesperrtSeit,
  groesse = "s",
}: {
  inhaber: SperrNutzer;
  zugewiesene: SperrNutzer[];
  gesperrtSeit: string;
  groesse?: "s" | "m";
}) {
  const tooltip = [
    `Gesperrt von ${anzeigeName(inhaber)} · gesperrt seit ${gesperrtSeit}`,
    ...zugewiesene.map((z) => `Zugewiesen: ${anzeigeName(z)}`),
  ].join("\n");
  return (
    <span className="av-stapel" title={tooltip}>
      <Avatar nutzer={inhaber} groesse={groesse} badge="schloss" title={tooltip} />
      {zugewiesene.map((z) => (
        <Avatar key={z.id} nutzer={z} groesse={groesse} title={tooltip} />
      ))}
    </span>
  );
}
