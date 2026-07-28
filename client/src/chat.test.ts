import { describe, expect, it } from "vitest";
import { shouldSubmitChatOnEnter } from "./chat";

describe("chat composer keyboard behavior", () => {
  it("submits on Enter", () => {
    expect(shouldSubmitChatOnEnter("Enter", false, false)).toBe(true);
  });

  it("keeps Shift+Enter available for line breaks", () => {
    expect(shouldSubmitChatOnEnter("Enter", true, false)).toBe(false);
  });

  it("does not submit while an input method is composing text", () => {
    expect(shouldSubmitChatOnEnter("Enter", false, true)).toBe(false);
  });
});
