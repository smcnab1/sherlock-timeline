import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH, POST } from "./route";

const tx = vi.hoisted(() => ({
  event: { findMany: vi.fn() },
  relationship: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) }),
}));

const link = { id: "link-a", sourceId: "event-a", targetId: "event-b", relationshipType: "linked-to" };
const reverse = { sourceId: "event-b", targetId: "event-a", relationshipType: "linked-to" };
function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/relationships?id=link-a", { method, body: JSON.stringify(body) });
}

describe("event relationships", () => {
  beforeEach(() => vi.clearAllMocks());
  it("rejects links between cases before writing either direction", async () => {
    tx.event.findMany.mockResolvedValue([{ caseId: "case-a" }, { caseId: "case-b" }]);
    expect((await POST(request("POST", link))).status).toBe(400);
    expect(tx.relationship.upsert).not.toHaveBeenCalled();
  });
  it("replaces the reverse link when the relationship type changes", async () => {
    const updated = { ...link, relationshipType: "Parent Event" };
    tx.relationship.findUnique.mockResolvedValue(link);
    tx.relationship.update.mockResolvedValue(updated);
    await PATCH(request("PATCH", updated));
    expect(tx.relationship.deleteMany).toHaveBeenCalledWith({ where: reverse });
    expect(tx.relationship.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { ...reverse, relationshipType: "Child Event" },
    }));
  });
  it("removes only the matching inverse when a relationship is deleted", async () => {
    tx.relationship.delete.mockResolvedValue(link);
    await DELETE(request("DELETE"));
    expect(tx.relationship.deleteMany).toHaveBeenCalledWith({ where: reverse });
  });
});
