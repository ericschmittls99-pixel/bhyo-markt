import { notFound } from "next/navigation";

import { RegisterInhalt } from "../../RegisterInhalt";

export const dynamic = "force-dynamic";

/**
 * Deeplink zum Anlegen (bleibt laut Ansage 7 bestehen): rendert stroeme. mit
 * erzwungen offenem Formular-Panel. Abbrechen/X fuehren "Zurück zum Register"
 * (/register?tab=<art>).
 */
export default async function NeuPage({
  params,
}: {
  params: Promise<{ art: string }>;
}) {
  const { art } = await params;
  if (art !== "biomasse" && art !== "output") notFound();

  return (
    <RegisterInhalt
      sp={{ tab: art, form: "neu" }}
      zurueckHref={`/register?tab=${art}`}
    />
  );
}
