import type { Strom } from "@/lib/stroeme-modell";

/**
 * Orb-Quelle eines Stroms: Biomasse traegt den Cluster-Orb, Outputs den
 * Gruppen-Orb; Add-Ons haben je Produkt einen eigenen (waerme/co2/asche).
 */
export function orbSrc(s: Pick<Strom, "art" | "cluster" | "gruppe" | "produktCode">): string {
  if (s.art === "biomasse")
    return `/orbs/cluster/${s.cluster ?? "organische_rest_abfallstoffe"}.webp`;
  if (s.gruppe === "add_ons" && s.produktCode)
    return `/orbs/output/${s.produktCode}.webp`;
  return `/orbs/output/${s.gruppe ?? "primaerprodukte"}.webp`;
}

export function Orb({
  strom,
  size,
}: {
  strom: Pick<Strom, "art" | "cluster" | "gruppe" | "produktCode">;
  size: number;
}) {
  return (
    <img
      src={orbSrc(strom)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className="orb"
      loading="lazy"
    />
  );
}
