import { readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = resolve(root, "apps/server/src");
const gitModule = resolve(source, "features/projects/git");
const gitEntry = resolve(gitModule, "index.js");
const shared = resolve(source, "shared");
const isWithin = (directory, path) => path.startsWith(directory + sep);
const launchers = new Set(["make", "spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]);

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) yield path;
  }
}

function problems(path) {
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const inside = isWithin(gitModule, path);
  const found = [];
  const add = (node, message) => found.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, message });
  const checkImport = (specifier) => {
    if (specifier === undefined || !ts.isStringLiteralLike(specifier) || !specifier.text.startsWith(".")) return;
    const target = resolve(dirname(path), specifier.text);
    if (inside && !isWithin(gitModule, target) && !isWithin(shared, target)) add(specifier, "projects/git may import only itself and shared/");
    if (!inside && isWithin(gitModule, target) && target !== gitEntry) add(specifier, "import projects/git through its index.js");
    if (!isWithin(resolve(source, "features/projects"), path) && isWithin(gitModule, target)) add(specifier, "only the projects feature may import projects/git");
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) checkImport(node.moduleSpecifier);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) checkImport(node.arguments[0]);
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const [program] = node.arguments;
      if (!inside && launchers.has(name) && program !== undefined && ts.isStringLiteralLike(program) && /^git(\s|$)/.test(program.text)) {
        add(program, "only projects/git may run git");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

let failed = false;
for (const path of sourceFiles(source)) {
  for (const { line, message } of problems(path)) {
    console.error(`${relative(root, path)}:${line}: ${message}; see docs/adr/0011-git-boundary.md`);
    failed = true;
  }
}
if (failed) process.exit(1);
