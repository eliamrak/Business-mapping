import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const root=path.resolve(import.meta.dirname,"..");
const file="artifacts/comp-dashboard/src/components/tabs/export-tab.tsx";
const source=fs.readFileSync(path.join(root,file),"utf8");
const baseline=execFileSync("git",["show",`f55d10ff4513f6e99f4258e5cfcc2ae65b99eb40:${file}`],{cwd:root,encoding:"utf8"});
const require=createRequire(path.join(root,"package.json"));
const ts=require("typescript");
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
test("PDF runtime imports are dynamic; static jsPDF import is type-only",()=>{
  const imports=ast.statements.filter(ts.isImportDeclaration).filter(s=>["jspdf","jspdf-autotable"].includes(s.moduleSpecifier.text));
  assert.equal(imports.length,1);assert.equal(imports[0].importClause.isTypeOnly,true);
  const dynamic=[];function visit(node){if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)dynamic.push(node.arguments[0].text);ts.forEachChild(node,visit);}visit(ast);
  assert.deepEqual(dynamic.sort(),["jspdf","jspdf-autotable"]);
});
test("all three report construction/calculation bodies remain byte-identical",()=>{
  const bodies=text=>[...text.matchAll(/const doc = new jsPDF\(\);[\s\S]*?doc\.save\([^\n]+\);/g)].map(m=>m[0]);
  assert.equal(bodies(source).length,3);assert.deepEqual(bodies(source),bodies(baseline));
});
test("each action loads PDF tools inside its guarded async callback",()=>{
  assert.equal([...source.matchAll(/setTimeout\(async \(\) => \{\s+try \{\s+const \{ jsPDF, autoTable \} = await loadPdfTools\(\);/g)].length,3);
  assert.equal([...source.matchAll(/finally \{ setLoading\(null\); \}/g)].length,3);
});
test("loading prevents concurrent exports and failure explains refresh recovery",()=>{
  assert.equal([...source.matchAll(/disabled=\{loading !== null\}/g)].length,3);
  assert.equal([...source.matchAll(/Refresh the page and try again\./g)].length,3);
  assert.match(source,/role="alert"/);assert.match(source,/aria-busy=\{loading !== null\}/);
});
