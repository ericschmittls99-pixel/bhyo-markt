"use client";

import type { ReactNode } from "react";

import { Orb } from "@/components/stroeme/Orb";
import {
  KonfidenzPill,
  StatusPillV2,
  VerfuegbarkeitsPill,
} from "@/components/stroeme/Pillen";
import { useUrlZustand } from "@/components/stroeme/useUrlZustand";
import { fmtOutputPreis } from "@/lib/energie";
import { fmtPreis, fmtMenge, fmtZeitraum } from "@/lib/format";
import { CLUSTER_LABEL } from "@/lib/farben";
import { BELEG_LABEL, KATEGORIE_LABEL, kreisAnzeige, type Strom } from "@/lib/stroeme-modell";

interface Spalte {
  /** Ohne sortKey ist die Spalte nicht sortierbar (z. B. abgeleiteter Status). */
  sortKey?: string;
  label: string;
  align?: "right";
  render: (s: Strom) => ReactNode;
}

function zweizeilig(a: ReactNode, b: ReactNode) {
  return (
    <span className="zelle2">
      <span className="haupt">{a}</span>
      <span className="neben">{b}</span>
    </span>
  );
}

function spalten(art: "biomasse" | "output"): Spalte[] {
  const feed = art === "biomasse";
  const basis: Spalte[] = [
    {
      sortKey: "titel",
      label: feed ? "Quelle" : "Abnehmer",
      render: (s) =>
        zweizeilig(
          s.akteurName ?? s.bezeichnung ?? "–",
          [s.ort, kreisAnzeige(s)].filter(Boolean).join(", "),
        ),
    },
    feed
      ? {
          sortKey: "materialart",
          label: "Materialart",
          render: (s) => (
            <span className="zelle-orb">
              <Orb strom={s} size={16} />
              {zweizeilig(
                s.materialartLabel ?? "–",
                s.cluster ? (CLUSTER_LABEL[s.cluster] ?? s.cluster) : "–",
              )}
            </span>
          ),
        }
      : {
          sortKey: "produkt",
          label: "Output",
          render: (s) => (
            <span className="zelle-orb">
              <Orb strom={s} size={16} />
              {zweizeilig(
                s.produktLabel ?? "–",
                [s.gruppeLabel, s.kategorie ? KATEGORIE_LABEL[s.kategorie] : null]
                  .filter(Boolean)
                  .join(" · ") || "–",
              )}
            </span>
          ),
        },
    {
      sortKey: "region",
      label: "Region",
      render: (s) => s.regionNamen.join(", ") || "–",
    },
    {
      sortKey: "menge",
      label: feed ? "Menge (t FM/a)" : "Menge",
      align: "right",
      render: (s) =>
        feed
          ? s.mengeFm != null
            ? fmtMenge(s.mengeFm)
            : "–"
          : s.mengeWert != null
            ? `${fmtMenge(s.mengeWert)} ${s.mengeEinheit ?? ""}`.trim()
            : "–",
    },
  ];
  if (feed)
    basis.push({
      // Eigener Sortierschluessel: nach atro sortieren, nicht nach Rohmenge —
      // sonst truegen Koepfe und aria-sort (Mockup nutzte hier "menge").
      sortKey: "atro",
      label: "t atro/a",
      align: "right",
      render: (s) => (
        <strong>{s.mengeAtro != null ? fmtMenge(s.mengeAtro) : "–"}</strong>
      ),
    });
  basis.push(
    {
      sortKey: "preis",
      label: feed ? "Preis (€/t)" : "Preis",
      align: "right",
      render: (s) =>
        feed
          ? s.preisMin != null || s.preisMax != null
            ? `${s.preisMin != null ? fmtPreis(s.preisMin) : "–"}–${s.preisMax != null ? fmtPreis(s.preisMax) : "–"}`
            : "–"
          : // E20: umgerechnet in die Anzeigeeinheit statt erfasster Einheit roh.
            fmtOutputPreis(s.produktCode, s.preis, s.preisEinheit),
    },
    {
      sortKey: "von",
      label: "Verfügbar",
      render: (s) => fmtZeitraum(s.zeitraumVon, s.zeitraumBis),
    },
    {
      sortKey: "qualitaet",
      label: "Qualität",
      render: (s) => <KonfidenzPill stufe={s.qualitaet} />,
    },
    {
      sortKey: "status",
      label: "Status",
      render: (s) => <StatusPillV2 status={s.status} />,
    },
    {
      // Abgeleiteter Verfuegbarkeitsstatus (AP1j PR 3); bewusst ohne sortKey.
      label: "Verfügbarkeit",
      render: (s) =>
        s.verfuegbarkeit ? (
          <VerfuegbarkeitsPill art={s.art} ergebnis={s.verfuegbarkeit} />
        ) : (
          "–"
        ),
    },
    {
      sortKey: "belegtyp",
      label: "Beleg",
      render: (s) => (s.beleg ? (BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ) : "–"),
    },
  );
  return basis;
}

/** Listen-Ansicht von stroeme. (V2): DataTable mit sortierbaren Koepfen. */
export function Tabelle({
  art,
  stroeme,
  sortKey,
  richtung,
  detailId,
}: {
  art: "biomasse" | "output";
  stroeme: Strom[];
  sortKey: string;
  richtung: "auf" | "ab";
  detailId: string | undefined;
}) {
  const { setze } = useUrlZustand();
  const cols = spalten(art);

  function sortiere(key: string) {
    const neueRichtung = key === sortKey ? (richtung === "auf" ? "ab" : "auf") : "auf";
    setze({ sort: key, richtung: neueRichtung });
  }

  return (
    <div className="card card--tabelle">
      <div className="table-wrap">
        <table className="st-tabelle">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={i}
                  className={c.align === "right" ? "rechts" : undefined}
                  aria-sort={
                    c.sortKey != null && c.sortKey === sortKey
                      ? richtung === "auf"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {c.sortKey != null ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => sortiere(c.sortKey!)}
                    >
                      {c.label}
                      {c.sortKey === sortKey && (
                        <i
                          className={`ph-bold ph-arrow-${richtung === "auf" ? "up" : "down"}`}
                          aria-hidden
                        />
                      )}
                    </button>
                  ) : (
                    <span className="th-sort">{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stroeme.map((s) => (
              <tr
                key={s.id}
                className="klickbar"
                data-aktiv={s.id === detailId ? "" : undefined}
                tabIndex={0}
                onClick={() => setze({ detail: s.id }, "push")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setze({ detail: s.id }, "push");
                  }
                }}
              >
                {cols.map((c, i) => (
                  <td key={i} className={c.align === "right" ? "rechts" : undefined}>
                    {c.render(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
