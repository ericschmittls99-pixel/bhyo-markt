import { expect, it } from "vitest";
// TEMPORAER: bewusst roter Check fuer die Probe von scripts/merge-sicher.sh.
it("ist absichtlich rot", () => {
  expect(1).toBe(2);
});
