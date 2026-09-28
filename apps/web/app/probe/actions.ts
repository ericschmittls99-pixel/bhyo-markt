"use server";

/**
 * PROBE (Wegwerf-Branch): exportierte Server-Action AUSSERHALB von lib/ ohne
 * Wache — rechte-check muss sie melden. Wird nie gemergt.
 */
export async function probeOhneWache(): Promise<{ ok: true }> {
  return { ok: true };
}
