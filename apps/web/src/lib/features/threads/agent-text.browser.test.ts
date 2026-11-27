import { mount, flushSync, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postJson = vi.hoisted(() => vi.fn());
vi.mock("#lib/api/client.ts", async () => {
  const actual = await vi.importActual<typeof import("#lib/api/client.ts")>("#lib/api/client.ts");
  return { ...actual, postJson };
});

const streams = vi.hoisted(() => [] as Array<{ onEvent: (event: unknown) => void; closed: boolean }>);
vi.mock("#lib/api/sse.ts", () => ({
  listen: (_topic: unknown, _schema: unknown, handlers: { onEvent: (event: unknown) => void }) => {
    const stream = { onEvent: handlers.onEvent, closed: false };
    streams.push(stream);
    return () => {
      stream.closed = true;
    };
  },
}));

const { vaultEvents } = await import("#lib/features/indexing/vault-events.svelte.ts");
const { default: AgentText } = await import("./AgentText.svelte");

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("AgentText citation cache", () => {
  let target: HTMLDivElement;
  let mounted: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
    postJson.mockReset();
    streams.length = 0;
  });

  afterEach(() => {
    if (mounted !== undefined) {
      void unmount(mounted);
      mounted = undefined;
    }
    target.remove();
    vaultEvents.disconnect();
  });

  it("caches resolved citations across streaming updates and invalidates on vault revision", async () => {
    const vaultId = `v-cache-${crypto.randomUUID()}`;
    vaultEvents.connect(vaultId);
    const stream = streams[0]!;

    postJson.mockImplementation(async (_url: string, _req: unknown, body: { links: ReadonlyArray<{ link: string }> }) => ({
      links: body.links.map((item) => ({ link: item.link, href: `/vaults/${vaultId}?note=${encodeURIComponent(item.link)}.md` })),
    }));

    const state = new SvelteMap<string, string>([["text", "See [[Alpha]]"]]);
    const props = {
      vaultId,
      get text() {
        return state.get("text")!;
      },
    };
    mounted = mount(AgentText, { target, props });
    flushSync();
    await settle();

    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]![2]).toEqual({ links: [{ link: "Alpha" }] });
    expect(target.querySelector("a")?.getAttribute("href")).toBe(`/vaults/${vaultId}?note=Alpha.md`);

    state.set("text", "See [[Alpha]] and more streamed tokens without new citations");
    flushSync();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(1);

    state.set("text", "See [[Alpha]] and [[Beta]]");
    flushSync();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(2);
    expect(postJson.mock.calls[1]![2]).toEqual({ links: [{ link: "Beta" }] });
    expect(target.querySelectorAll("a")).toHaveLength(2);

    stream.onEvent({ type: "vault.changed", vaultId, paths: ["Unrelated.md"], structureChanged: false });
    flushSync();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(2);

    stream.onEvent({ type: "vault.changed", vaultId, paths: ["Alpha.md"], structureChanged: true });
    flushSync();
    await settle();
    expect(postJson).toHaveBeenCalledTimes(3);
    expect(postJson.mock.calls[2]![2]).toEqual({ links: [{ link: "Alpha" }, { link: "Beta" }] });
  });
});
