import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  findEvents: vi.fn(), findConversation: vi.fn(), update: vi.fn(), link: vi.fn(), backup: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: (fn: (tx: unknown) => unknown) => fn({
      event: { findMany: mocks.findEvents, updateMany: mocks.link },
      conversation: { findFirst: mocks.findConversation, update: mocks.update },
    }),
  }),
}));
vi.mock("@/lib/backup", () => ({ createCaseBackupBestEffort: mocks.backup }));

describe("conversation linking", () => {
  it.each([
    ["a missing event", ["event-a", "event-b"]],
    ["a conversation in another case", ["event-a"]],
  ])("rejects %s without making partial changes", async (_, eventIds) => {
    mocks.findEvents.mockResolvedValue([{ id: "event-a", people: [] }]);
    mocks.findConversation.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/conversations", {
      method: "POST", body: JSON.stringify({ caseId: "case-a", conversationId: "conversation-b", eventIds }),
    }));
    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
    if (eventIds.length === 1) {
      expect(mocks.findConversation).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: "conversation-b", caseId: "case-a" },
      }));
    }
  });
});
