import { test } from "node:test";
import assert from "node:assert/strict";
import { legacyServiceCodes } from "@workspace/practice/hub";
import { compatibleReaderCapabilities } from "./reader-capabilities.ts";
const valid = () => ({ readerProtocol: "legacy-codes-late-cancellation-v1", packageFormat: "emc-practice-local-import-package", packageVersion: 1, cancellationSubtypes: ["late_cancelled"], billingCodeEncoding: "string-or-null", unclassifiedZero: { storedCode: "0", defaultMinutes: null, equivalentToFiveZeros: false }, serviceCodes: structuredClone(legacyServiceCodes) });
test("reader status requires the full supported protocol and code semantics", () => {
  assert.equal(compatibleReaderCapabilities(valid()), true);
  for (const value of [null, {}, "<html>login</html>", { ...valid(), readerProtocol: "old" }, { ...valid(), packageVersion: 2 }, { ...valid(), cancellationSubtypes: [] }, { ...valid(), billingCodeEncoding: "number" }, { ...valid(), serviceCodes: {} }]) assert.equal(compatibleReaderCapabilities(value), false);
});
test("zero cannot silently become 00000 and a wrong legacy duration cannot certify compatibility", () => {
  assert.equal(compatibleReaderCapabilities({ ...valid(), unclassifiedZero: { storedCode: "0", defaultMinutes: 15, equivalentToFiveZeros: true } }), false);
  for (const code of ["0", " 0 "]) assert.equal(compatibleReaderCapabilities({ ...valid(), serviceCodes: { ...valid().serviceCodes, [code]: { kind: "treatment", minutes: 15 } } }), false);
  const wrong = valid(); wrong.serviceCodes["4"].minutes = 15;
  assert.equal(compatibleReaderCapabilities(wrong), false);
});
