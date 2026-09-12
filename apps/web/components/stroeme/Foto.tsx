"use client";

import { useState } from "react";

import { Orb, orbSrc } from "@/components/stroeme/Orb";
import type { Strom } from "@/lib/stroeme-modell";

/**
 * Materialart-/Output-Foto (Ansage 6): public/fotos/<art>/<groesse>/<code>.webp.
 * Fehlt die Datei, greift der Orb-/Flachfarben-Fallback — die
 * Cluster-Stimmungsfotos des Mockups existieren im Repo bewusst nicht.
 */
export function fotoSrc(
  s: Pick<Strom, "art" | "materialartCode" | "produktCode">,
  groesse: "lg" | "sm",
): string | null {
  const code = s.art === "biomasse" ? s.materialartCode : s.produktCode;
  if (!code) return null;
  return `/fotos/${s.art === "biomasse" ? "feedstock" : "output"}/${groesse}/${code}.webp`;
}

export function Foto({
  strom,
  groesse,
  alt,
}: {
  strom: Pick<Strom, "art" | "cluster" | "gruppe" | "materialartCode" | "produktCode">;
  groesse: "lg" | "sm";
  alt: string;
}) {
  const src = fotoSrc(strom, groesse);
  const [fehlt, setFehlt] = useState(false);
  if (!src || fehlt) {
    return (
      <span
        className="foto-fallback"
        data-cluster={strom.art === "biomasse" ? strom.cluster : strom.gruppe}
        role="img"
        aria-label={alt}
      >
        <Orb strom={strom} size={groesse === "lg" ? 48 : 24} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="foto"
      loading="lazy"
      onError={() => setFehlt(true)}
    />
  );
}

export { orbSrc };
