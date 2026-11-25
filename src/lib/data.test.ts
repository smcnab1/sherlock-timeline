import { expect, it, vi } from "vitest";
import { getCaseWorkspace } from "./data";

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    case: {
      findMany: async () => [{ id: "case-a" }],
      findUnique: async () => null,
    },
  }),
}));

it("does not read any private collections when the selected case is missing", async () => {
  const workspace = await getCaseWorkspace("unavailable-case");
  expect(workspace.activeCase).toBeNull();
  for (const [key, value] of Object.entries(workspace)) {
    if (key !== "activeCase" && key !== "cases") expect(value).toEqual([]);
  }
});
