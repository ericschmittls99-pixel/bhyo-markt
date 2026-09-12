import { RegisterInhalt, type SearchParams } from "./RegisterInhalt";

export const dynamic = "force-dynamic";

/** stroeme. — der Seitenrumpf lebt in RegisterInhalt (geteilt mit dem Deeplink). */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <RegisterInhalt sp={await searchParams} />;
}
