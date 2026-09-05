import Link from "next/link";
import { notFound } from "next/navigation";

import { ErfassungFormular } from "@/components/ErfassungFormular";
import { createBiomasse, createOutput } from "@/lib/actions";
import { listOutputProdukte } from "@/lib/register";

export const dynamic = "force-dynamic";

export default async function NeuPage({
  params,
}: {
  params: Promise<{ art: string }>;
}) {
  const { art } = await params;
  if (art !== "biomasse" && art !== "output") notFound();

  const outputProdukte =
    art === "output" ? await listOutputProdukte() : [];

  return (
    <main className="app-main">
      <div className="toolbar">
        <Link className="btn btn--ghost" href={`/register?tab=${art}`}>
          ← Zurück zum Register
        </Link>
      </div>
      <ErfassungFormular
        art={art}
        action={art === "biomasse" ? createBiomasse : createOutput}
        outputProdukte={outputProdukte}
      />
    </main>
  );
}
