import type { InboxZeile } from "@/lib/inbox/server";

/**
 * E77 R5: Die Kurzform einer Mitteilung — EIN Ursprung fuer die Liste in inbox.
 * und das Pop-up an der Glocke: Kurztitel des Typs, Kennung des Objekts, bei
 * Buendeln der Zaehler; darunter klein/grau der Akteur und bei Aufgabe bzw.
 * Zugriffsanfrage der mitgegebene Text. Die volle Info traegt der Aufrufer
 * als Tooltip (title) und das Detail.
 */
export function InboxKurztext({
  z,
}: {
  z: Pick<InboxZeile, "typ" | "kurz" | "anzahl" | "aufgabe" | "notiz">;
}) {
  const zitat =
    z.typ === "aufgabe"
      ? z.aufgabe
      : z.typ === "zugriffsanfrage"
        ? z.notiz
        : null;
  const neben = [z.kurz.akteur, zitat ? `„${zitat}"` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="ib-kurz">
      <span className="ib-kurz-zeile">
        <span className="ib-titel">{z.kurz.titel}</span>
        {z.kurz.kennung && (
          <>
            <span className="ib-trenner" aria-hidden>
              {" · "}
            </span>
            <span className="ib-kennung">{z.kurz.kennung}</span>
          </>
        )}
        {z.anzahl > 1 && (
          <span
            className="pill pill--muted ib-anzahl"
            title={`${z.anzahl} gebündelt`}
          >
            {z.anzahl}×
          </span>
        )}
      </span>
      {neben && <span className="ib-neben">{neben}</span>}
    </span>
  );
}
