import { describe, expect, it } from "vitest";
import { notificationFor, sameOriginPath } from "./push-notification.ts";

describe("notificationFor", () => {
  it("shows the payload and opens its inbox item", () => {
    const shown = notificationFor(JSON.stringify({ title: "Stretch", body: "Stand up", url: "/inbox?item=a", tag: "a" }));
    expect(shown.title).toBe("Stretch");
    expect(shown.options).toMatchObject({ body: "Stand up", tag: "a", data: { url: "/inbox?item=a" } });
  });

  it("still says something arrived when the payload can't be read", () => {
    expect(notificationFor(null)).toMatchObject({ title: "wiki-agents", options: { data: { url: "/inbox" } } });
    expect(notificationFor("not json").options.body).toBe("Something new in your inbox.");
  });

  it("never opens another site", () => {
    const shown = notificationFor(JSON.stringify({ title: "x", body: "", url: "https://evil.example/", tag: "x" }));
    expect(shown.options.data.url).toBe("/inbox");
    expect(sameOriginPath("//evil.example")).toBe("/inbox");
  });
});
