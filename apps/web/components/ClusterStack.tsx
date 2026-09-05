"use client";

import { useEffect, useRef, useState } from "react";

import { CLUSTER_LABEL } from "@/lib/farben";

/**
 * Cluster-Vielfalt einer Menge von Stroemen als ueberlappend gestapelte Orbs
 * (apps/web/public/orbs/cluster/<code>.webp). Aufrufer liefert `verteilung`
 * bereits absteigend nach Anteil (%) sortiert. Max. 4 Orbs, danach "+N"-Pille.
 * Hover/Klick oeffnet ein Popover (Label + Prozent), Klick ausserhalb schliesst.
 */
export function ClusterStack({
  verteilung,
}: {
  verteilung: { cluster: string; anteil: number }[];
}) {
  const [offen, setOffen] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOffen(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!verteilung.length) return null;
  const sichtbar = verteilung.slice(0, 4);
  const rest = verteilung.length - sichtbar.length;

  return (
    <div className="cluster-stack" ref={box}>
      {sichtbar.map((v, i) => (
        <span
          className="cluster-orb-wrap"
          key={v.cluster}
          style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="cluster-orb"
            src={`/orbs/cluster/${v.cluster}.webp`}
            alt={CLUSTER_LABEL[v.cluster] ?? v.cluster}
            width={26}
            height={26}
            onMouseEnter={() => setOffen(i)}
            onClick={() => setOffen(offen === i ? null : i)}
          />
          {offen === i && (
            <span className="cluster-popover card">
              {CLUSTER_LABEL[v.cluster] ?? v.cluster} · {v.anteil}&thinsp;%
            </span>
          )}
        </span>
      ))}
      {rest > 0 && <span className="pill cluster-plus">+{rest}</span>}
    </div>
  );
}
