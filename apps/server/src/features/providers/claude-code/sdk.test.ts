import { describe, expect, it } from "vitest";
import { userMessage } from "./sdk.js";

const image = { mime: "image/png", data: "iVBORw0KGgo=" } as const;
const block = { type: "image", source: { type: "base64", media_type: "image/png", data: image.data } };

describe("Claude Code user message", () => {
  it("is plain text without images", () => {
    expect(userMessage("Hi").message.content).toBe("Hi");
  });

  it("puts image blocks before the text, and leaves out empty text", () => {
    expect(userMessage("What is this?", [image]).message.content).toEqual([block, { type: "text", text: "What is this?" }]);
    expect(userMessage("", [image]).message.content).toEqual([block]);
  });
});
