import { describe, expect, it } from "vitest";
import { diffLines } from "./diff-lines.ts";
import { diffSyntax, type Grammar, grammarFor, highlightDiff, MAX_LINES } from "./syntax.ts";

const grammar = async (path: string): Promise<Grammar> => {
  const found = await grammarFor(path);
  if (found === null) throw new Error(`no grammar for ${path}`);
  return found;
};

/** Each line's coloured text, as `style:text`. */
const coloured = async (path: string, diff: string) => {
  const lines = diffLines(diff);
  const syntax = await highlightDiff(lines, await grammar(path));
  return lines.map(({ line }, index) => syntax[index]!.map(({ from, to, style }) => `${style}:${line.slice(1).slice(from, to)}`));
};

describe("highlightDiff", () => {
  it("colours removed and added lines each as their own side of the file", async () => {
    expect(await coloured("src/app.ts", "@@ -1 +1 @@\n-const a = 1;\n+let b = 'two';")).toEqual([
      [],
      ["keyword:const", "literal:1"],
      ["keyword:let", "string:'two'"],
    ]);
  });

  it("follows a comment across lines, on both sides", async () => {
    const lines = await coloured("src/app.ts", "@@ -1,3 +1,3 @@\n /* start\n-old\n+new\n end */");
    expect(lines.slice(1)).toEqual([["comment:/* start"], ["comment:old"], ["comment:new"], ["comment:end */"]]);
  });

  it("recolours unchanged lines an edit changes the meaning of", async () => {
    // The added line opens a comment: the unchanged lines after it are comment text now.
    const lines = await coloured("src/app.ts", "@@ -1,3 +1,3 @@\n-const a = 1;\n+/* const a = 1;\n const b = 2;\n const c = 3; */");
    expect(lines[1]).toEqual(["keyword:const", "literal:1"]);
    expect(lines.slice(2)).toEqual([["comment:/* const a = 1;"], ["comment:const b = 2;"], ["comment:const c = 3; */"]]);
  });

  it("parses each hunk on its own", async () => {
    const lines = await coloured("src/app.ts", "@@ -1 +1 @@\n+/* never closed\n@@ -9 +9 @@\n+const x = 1;");
    expect(lines[3]).toEqual(["keyword:const", "literal:1"]);
  });

  it("reads a C# hunk from the middle of a method as statements", async () => {
    const lines = await coloured("src/Orders.cs", '@@ -10,2 +10,2 @@\n-    var s = $"total {count}";\n+    return await _db.Orders.CountAsync(ct);');
    expect(lines[1]).toEqual(["keyword:var", 'string:$"total ', 'string:"']);
    expect(lines[2]).toEqual(["keyword:return", "keyword:await", "function:CountAsync"]);
  });

  it("colours C# declarations with their own types", async () => {
    const lines = await coloured("src/Order.cs", "@@ -1 +1 @@\n+public sealed record Order(Guid Id, string Name) : IEntity");
    expect(lines[1]).toEqual(["keyword:public", "keyword:sealed", "keyword:record", "type:Order", "type:Guid", "keyword:string", "type:IEntity"]);
  });

  it("gives the main thread back during a long parse, with the same colours", async () => {
    const code = Array.from({ length: 3000 }, (_, index) => `+    var total${index} = await orders.CountAsync(ct); // ${index}`);
    const lines = diffLines(`@@ -0,0 +1,3000 @@\n${code.join("\n")}`);
    const csharp = await grammar("Orders.cs");
    let pauses = 0;
    const sliced = await highlightDiff(lines, csharp, async () => {
      pauses++;
    });
    expect(pauses).toBeGreaterThan(0);
    expect(sliced).toEqual(await highlightDiff(lines, csharp));
  });

  it("colours .NET project files as XML, and Nix and Svelte with their own grammars", async () => {
    expect((await coloured("Api.csproj", '@@ -1 +1 @@\n+<PackageReference Include="Effect" />'))[1]).toEqual([
      "type:PackageReference",
      "property:Include",
      'string:"Effect"',
    ]);
    expect((await coloured("flake.nix", "@@ -1 +1 @@\n+  default = pkgs.hello; # hi"))[1]).toContain("comment:# hi");
    expect((await coloured("App.svelte", "@@ -1 +1 @@\n+<script>let a = 1;</script>"))[1]).toContain("keyword:let");
  });
});

describe("diffSyntax", () => {
  it("leaves files without a known language plain", async () => {
    const diff = "@@ -1 +1 @@\n+anything";
    expect(await diffSyntax("notes.unknownextension", diff, diffLines(diff))).toBeNull();
  });

  it("leaves diffs that are too large plain", async () => {
    const diff = `@@ -1 +1,${MAX_LINES + 1} @@\n${"+x\n".repeat(MAX_LINES + 1)}`;
    expect(await diffSyntax("big.ts", diff, diffLines(diff))).toBeNull();
  });

  it("colours a known file and caches the result", async () => {
    const diff = "@@ -1 +1 @@\n+const a = 1;";
    const first = await diffSyntax("a.ts", diff, diffLines(diff));
    expect(first?.[1]?.[0]).toEqual({ from: 0, to: 5, style: "keyword" });
    expect(await diffSyntax("a.ts", diff, diffLines(diff))).toBe(first);
  });
});
