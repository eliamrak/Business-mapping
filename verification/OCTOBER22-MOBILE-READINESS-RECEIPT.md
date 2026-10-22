# Mobile Readiness Route — Reviewed Source Candidate

Base: `5cb154e2a9db6d142c83b98f179050316ef57fa7`.
One runtime file: `artifacts/comp-mobile/server/serve.js`; 50 added lines.
No artifact, .replit, port, dependency, schema, API or business-data changes.

Before SHA-256: `10f4fe022fb71187c53fe43408306fe6d493c0fba28ae58862f83027397a08c7`.

The existing `/comp-mobile/healthcheck` had no handler. Landing, freshly generated
iOS/Android manifests and launch assets responded, while healthcheck returned 404.
This explains a missing readiness contract, not the platform's undocumented
translation to transient rollout 500 responses or all possible rollout failures.

Dedicated readiness runs after existing prefix stripping. It parses both served
manifests and verifies nonempty readable regular local launch files within the
real build root; 200 when ready, 503 otherwise. No external request or application
record is involved. Existing landing/manifest/static handlers remain unchanged.

Independent author Planck prepared the isolated patch and 32 VM tests. Main task
read and reviewed the full delta and reran those tests: 32/32 passed. Tests now
also run against this exact source file, not only a copied candidate. Syntax and
patch preimage checks passed. No real server/device or deployment was exercised.

Run `node --test verification/mobile-readiness.test.cjs` and
`node --check artifacts/comp-mobile/server/serve.js`.

Limit: readiness checks file availability, not complete manifest schema, valid
JavaScript content, secondary asset coverage, remote DNS/TLS or device runtime.
Future integration must preserve current publisher history/configuration, compare
this exact preimage, rebuild with the existing mobile artifact contract and verify
the real readiness URL. This commit is separate from Tidal and not deployed.
