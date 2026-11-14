import { describe, expect, it } from "vitest";
import type { TurnImage } from "../port.js";
import { turnInput } from "./adapter.js";

const shot: TurnImage = { path: "/data/attachments/abc/shot.png", name: "shot.png", mime: "image/png", size: 10 };

describe("Codex turn input", () => {
  it("is the text alone without images, even when empty", () => {
    expect(turnInput("Hi", [])).toEqual([{ type: "text", text: "Hi", text_elements: [] }]);
    expect(turnInput("", [])).toEqual([{ type: "text", text: "", text_elements: [] }]);
  });

  it("puts images first, by path, and leaves out empty text", () => {
    expect(turnInput("What is this?", [shot])).toEqual([
      { type: "localImage", path: shot.path },
      { type: "text", text: "What is this?", text_elements: [] },
    ]);
    expect(turnInput("", [shot])).toEqual([{ type: "localImage", path: shot.path }]);
  });
});
