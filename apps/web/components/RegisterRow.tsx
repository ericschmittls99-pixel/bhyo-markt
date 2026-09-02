"use client";

import { useRouter } from "next/navigation";

import { BelegLink, QualitaetPill, StatusPill } from "@/components/Pills";
import type { RegisterZeile } from "@/lib/register";

/**
 * Klickbare Tabellenzeile: oeffnet das read-only Detail-Panel (URL-getrieben).
 * Der Klick auf die Beleg-Zelle wird gestoppt, damit dort der Beleg-Link greift.
 */
export function RegisterRow({
  zeile,
  detailHref,
  aktiv,
}: {
  zeile: RegisterZeile;
  detailHref: string;
  aktiv: boolean;
}) {
  const router = useRouter();
  const z = zeile;
  return (
    <tr
      className={`klickbar${aktiv ? " aktiv" : ""}`}
      tabIndex={0}
      role="button"
      onClick={() => router.push(detailHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(detailHref);
        }
      }}
    >
      <td>
        <div className="stack">
          <strong>{z.bezeichnung ?? z.akteurName ?? "—"}</strong>
          <span className="muted">
            {[z.akteurName, z.ort, z.landkreis].filter(Boolean).join(" · ") || "—"}
          </span>
        </div>
      </td>
      <td>{z.kategorie ?? "—"}</td>
      <td className="muted">
        {z.zeitraumVon && z.zeitraumBis
          ? `${z.zeitraumVon} – ${z.zeitraumBis}`
          : "—"}
      </td>
      <td>{z.menge ?? "—"}</td>
      <td>
        <QualitaetPill stufe={z.qualitaet} />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <BelegLink beleg={z.beleg} />
      </td>
      <td>
        <StatusPill status={z.status} />
      </td>
    </tr>
  );
}
