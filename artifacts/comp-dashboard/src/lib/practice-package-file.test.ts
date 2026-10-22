import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {readPracticePackageFile, MAX_PRACTICE_PACKAGE_BYTES} from "./practice-package-file.ts";
import {importLocalPackage} from "./retention-local.ts";
const golden=readFileSync(new URL("../../../../docs/practice-local-import-package-v1.golden.json",import.meta.url),"utf8");
for(const name of ["practice-package.json","practice-package 10.22","practice-package.txt","practice-package.JSON"])
  test(`valid converter contents survive filename ${name}`,async()=>{
    const value=await readPracticePackageFile(new File([golden],name,{type:"text/plain"}));
    assert.equal(importLocalPackage(value).snapshots.length,2);
  });
test("empty files fail before reading",async()=>{
  await assert.rejects(readPracticePackageFile({size:0,text:async()=>{throw Error("Should not read");}}),/non-empty/);
});
test("files over 10 MB fail before reading with a specific size message",async()=>{
  await assert.rejects(readPracticePackageFile({size:MAX_PRACTICE_PACKAGE_BYTES+1,text:async()=>{throw Error("Should not read");}}),/larger than 10 MB/);
});
test("the exact 10 MB boundary remains accepted",async()=>{
  const value=await readPracticePackageFile({size:MAX_PRACTICE_PACKAGE_BYTES,text:async()=>golden});
  assert.equal(importLocalPackage(value).snapshots.length,2);
});
test("malformed JSON has a clear error without echoing source content",async()=>{
  await assert.rejects(readPracticePackageFile(new File(['SYNTHETIC_PRIVATE_MARKER'],"example.json")),e=>e instanceof Error&&e.message.includes("not valid JSON")&&!e.message.includes("SYNTHETIC_PRIVATE_MARKER"));
});
test("valid JSON is still subject to the unchanged package schema",async()=>{
  const value=await readPracticePackageFile(new File(['{}'],"example.json"));
  assert.throws(()=>importLocalPackage(value),/not a supported Practice import package/);
});
test("unexpected identifying fields remain rejected by the package validator",async()=>{
  const value=JSON.parse(golden);value.patientName="Synthetic prohibited field";
  const parsed=await readPracticePackageFile(new File([JSON.stringify(value)],"no-extension"));
  assert.throws(()=>importLocalPackage(parsed));
});
