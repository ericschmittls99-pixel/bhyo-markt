import { orbSrc } from "@/lib/farben";
import type { Strom } from "@/lib/stroeme-modell";

// orbSrc lebt seit PR 6 in lib/farben (pur, auch vom Karten-Datenpfad genutzt).
export { orbSrc };

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
