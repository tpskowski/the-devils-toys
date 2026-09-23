import { describe, expect, it, vi } from "vitest";
import { createGroupStateSaver } from "./group-state-saver";

describe("group state save queue", () => {
  it("flushes a final edit after the in-flight write supplies its revision", async () => {
    let finish!: (value: { revision: number }) => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ revision: number }>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValueOnce({ revision: 9 });
    const saver = createGroupStateSaver(write);
    saver.readRevision(7);
    const first = saver.save({ notes: "first" });
    await Promise.resolve();
    const final = saver.save({ notes: "last edit before leaving" });
    expect(write).toHaveBeenCalledTimes(1);
    finish({ revision: 8 });
    await Promise.all([first, final]);
    expect(write.mock.calls).toEqual([
      [{ notes: "first" }, 7],
      [{ notes: "last edit before leaving" }, 8]
    ]);
  });

  it("keeps different rooms' revisions separate and allows a retry after failure", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ revision: 4 });
    const oldRoom = createGroupStateSaver(write);
    oldRoom.readRevision(3);
    const newWrite = vi.fn().mockResolvedValue({ revision: 21 });
    const newRoom = createGroupStateSaver(newWrite);
    newRoom.readRevision(20);
    await expect(oldRoom.save({ notes: "draft" })).rejects.toThrow("offline");
    await Promise.all([oldRoom.save({ notes: "retry" }), newRoom.save({ notes: "other room" })]);
    expect(write).toHaveBeenLastCalledWith({ notes: "retry" }, 3);
    expect(newWrite).toHaveBeenCalledWith({ notes: "other room" }, 20);
  });
});
