import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * E77 R6: Die eigene Akteur-Seite entfaellt — der Akteur ist eine Sidebar
 * ueber akteure. (`/akteure?akteur=<id>`). Alte Links (Inbox, Import,
 * Dubletten, Lesezeichen) leiten hierher um; `?reiter=kontaktpersonen`
 * bleibt als Parameter erhalten und rollt dort zum Abschnitt. Die Kennung
 * einer zusammengefuehrten Quelle loest akteure. ueber das Protokoll auf.
 * Die Auskunft-Seite (`/akteure/<id>/kontaktpersonen/<pid>/auskunft`) bleibt.
 */
export default async function AkteurSeite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const reiter = (Array.isArray(sp.reiter) ? sp.reiter[0] : sp.reiter) === "kontaktpersonen" ? "&reiter=kontaktpersonen" : "";
  redirect(`/akteure?akteur=${encodeURIComponent(id)}${reiter}`);
}
