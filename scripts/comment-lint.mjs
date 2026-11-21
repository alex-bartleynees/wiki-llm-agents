import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parser as nixParser } from "@replit/codemirror-lang-nix";
import { parse, parseCss } from "svelte/compiler";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const baselinePath = resolve(root, "scripts/comment-baseline.json");
const extensions = /\.(?:[cm]?[jt]s|svelte|css|html|svg|nix|sql)$/;
const excluded = new Set(["design", "node_modules", "dist", "build", "result", "test-results", "playwright-report"]);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (entry.name.startsWith(".") || excluded.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.isFile() && extensions.test(entry.name)) yield path;
  }
}

function scriptComments(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) {
    throw new Error(ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, "\n"));
  }

  const comments = new Map();
  const visit = (node) => {
    const start = node.getFullStart();
    for (const range of ts.getLeadingCommentRanges(source, start) ?? []) comments.set(range.pos, { start: range.pos, end: range.end });
    for (const range of ts.getTrailingCommentRanges(source, start) ?? []) comments.set(range.pos, { start: range.pos, end: range.end });
    for (const child of node.getChildren(file)) {
      if (child.kind !== ts.SyntaxKind.JSDocComment) visit(child);
    }
  };
  visit(file);
  return [...comments.values()];
}

function componentComments(path, source) {
  const ast = parse(source, { modern: true });
  const comments = [...ast.comments, ...(ast.css?.comments ?? [])];

  function visit(node) {
    if (node.type === "Comment") comments.push(node);
    if (node.type === "RegularElement" && (node.name === "script" || node.name === "style")) {
      const [body] = node.fragment.nodes;
      if (body?.type !== "Text") return;
      const ranges = node.name === "style" ? parseCss(body.raw).comments : scriptComments(path + ".js", body.raw);
      for (const { start, end } of ranges) comments.push({ start: start + body.start, end: end + body.start });
      return;
    }
    for (const child of node.fragment?.nodes ?? []) visit(child);
    for (const key of ["body", "consequent", "alternate", "fallback", "pending", "then", "catch"]) {
      for (const child of node[key]?.nodes ?? []) visit(child);
    }
  }

  visit(ast);
  return comments;
}

function nixComments(source) {
  const comments = [];
  nixParser.parse(source).iterate({
    enter(node) {
      if (node.name === "LineComment" || node.name === "BlockComment") {
        comments.push({ start: node.from, end: node.to });
      }
    },
  });
  return comments;
}

function sqlComments(source) {
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;
  return [...source.matchAll(tokens)]
    .filter(([token]) => (token.startsWith("--") || token.startsWith("/*")) && token !== "--> statement-breakpoint")
    .map(({ 0: token, index: start }) => ({ start, end: start + token.length }));
}

function commentRanges(path, source) {
  if (/\.(?:svelte|html|svg)$/.test(path)) return componentComments(path, source);
  if (path.endsWith(".css")) return parseCss(source).comments;
  if (path.endsWith(".nix")) return nixComments(source);
  if (path.endsWith(".sql")) return sqlComments(source);
  return scriptComments(path, source);
}

function inventory() {
  const files = new Map();
  for (const path of sourceFiles(root)) {
    const name = relative(root, path);
    const source = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    let ranges;
    try {
      ranges = commentRanges(name, source);
    } catch (error) {
      throw new Error(name + ": " + error.message, { cause: error });
    }
    const unique = new Map(ranges.map(({ start, end }) => [start, end]));
    const comments = [...unique].sort(([a], [b]) => a - b).map(([start, end]) => {
      const text = source.slice(start, end);
      const line = source.slice(0, start).split(/\r\n|[\n\r]/).length;
      const lastLine = line + text.split(/\r\n|[\n\r]/).length - 1;
      const fingerprint = createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("base64url").slice(0, 16);
      return { line, lastLine, start, end, text, fingerprint };
    });
    let stripped = source;
    for (const { start, end } of comments.toReversed()) {
      stripped = stripped.slice(0, start) + stripped.slice(start, end).replace(/[^\r\n]/g, " ") + stripped.slice(end);
    }
    const lines = stripped.split(/\r\n|[\n\r]/);
    const touched = new Set();
    for (const { line, lastLine } of comments) {
      for (let number = line; number <= lastLine; number++) touched.add(number);
    }
    const removableLines = [...touched].filter((number) => !lines[number - 1].trim()).length;
    if (comments.length) files.set(name, { comments, removableLines });
  }
  return files;
}

function ratchet(files, baseline, prune) {
  const next = {};
  let failed = false;
  for (const [path, { comments }] of files) {
    const remaining = (baseline[path] ?? "").split(" ");
    const matched = [];
    for (const { fingerprint, line } of comments) {
      const index = remaining.indexOf(fingerprint);
      if (index < 0) {
        console.error(path + ":" + line + ": new or edited comment");
        failed = true;
      } else {
        remaining.splice(index, 1);
        matched.push(fingerprint);
      }
    }
    if (matched.length) next[path] = matched.sort().join(" ");
  }
  if (failed) return false;
  const output = JSON.stringify(next, null, 2) + "\n";
  if (prune) writeFileSync(baselinePath, output);
  else if (output !== JSON.stringify(baseline, null, 2) + "\n") {
    console.error("Run npm run lint:comments -- --prune to remove unused baseline entries.");
    return false;
  }
  return true;
}

const [mode, ...paths] = process.argv.slice(2);
if (mode !== undefined && mode !== "--inventory" && mode !== "--prune") {
  throw new Error("Expected --inventory or --prune");
}
if (mode !== "--inventory" && paths.length) throw new Error("Paths require --inventory");

const files = inventory();
if (mode === "--inventory") {
  const prefixes = paths.map((path) => relative(root, resolve(root, path)));
  const selected = [...files].filter(([path]) =>
    !prefixes.length || prefixes.some((prefix) => prefix === "" || path === prefix || path.startsWith(prefix + "/")),
  );
  console.log(JSON.stringify(Object.fromEntries(selected), null, 2));
} else {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  if (!ratchet(files, baseline, mode === "--prune")) process.exitCode = 1;
}
