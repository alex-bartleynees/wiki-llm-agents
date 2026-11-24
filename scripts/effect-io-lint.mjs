import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "apps/server/src");
const exceptions = JSON.parse(readFileSync(resolve(root, "scripts/effect-io-exceptions.json"), "utf8"));
const replacements = new Map([
  ["fs", "FileSystem from effect"],
  ["fs/promises", "FileSystem from effect"],
  ["child_process", "ChildProcess from effect/process"],
  ["fetch", "HttpClient from effect/http"],
]);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) yield path;
  }
}

function isTypeOnlyImport(node) {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function directIo(path) {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (api, node) => {
    if (replacements.has(api)) found.push({ api, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
  };
  const addModule = (specifier) => {
    if (specifier !== undefined && ts.isStringLiteralLike(specifier)) add(specifier.text.replace(/^node:/, ""), specifier);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && !isTypeOnlyImport(node)) addModule(node.moduleSpecifier);
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) addModule(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) addModule(node.arguments[0]);
      if (ts.isIdentifier(callee) && callee.text === "fetch") add("fetch", callee);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "fetch" && callee.expression.getText(file) === "globalThis") add("fetch", callee);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const unused = new Map(Object.entries(exceptions).map(([path, apis]) => [path, new Set(apis)]));
let failed = false;
for (const path of sourceFiles(source)) {
  const name = relative(root, path);
  for (const { api, line } of directIo(path)) {
    if (exceptions[name]?.includes(api)) {
      unused.get(name).delete(api);
      continue;
    }
    console.error(`${name}:${line}: ${api} is used directly; use ${replacements.get(api)}, or record an exception in docs/adr/0009-effect-io.md`);
    failed = true;
  }
}
for (const [path, apis] of unused) {
  for (const api of apis) {
    console.error(`${path}: the ${api} exception is no longer needed; remove it from scripts/effect-io-exceptions.json`);
    failed = true;
  }
}
if (failed) process.exit(1);
