import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outDir = mkdtempSync(join(tmpdir(), "practice-responsive-"));
const css = [
  readFileSync("artifacts/comp-dashboard/src/pages/practice.css", "utf8"),
  readFileSync(
    "artifacts/comp-dashboard/src/pages/practice-workspace.css",
    "utf8",
  ),
].join("\n");

const longClientId =
  "CLIENT-SYNTHETIC-000000000000000000000000000000000000000000000000000000000000";

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Practice responsive overflow fixture</title>
    <style>${css}</style>
  </head>
  <body>
    <main class="pw-app">
      <aside class="pw-rail">
        <div class="pw-brand"><span class="pw-brand-mark">TPA</span><span>Practice<small>Responsive fixture</small></span></div>
        <nav><button aria-current="page">Retention</button><button>Sessions</button><button>Money</button></nav>
      </aside>
      <section class="pw-main">
        <header class="pw-header">
          <div><p class="pw-eyebrow">Synthetic fixture</p><h1>Practice workspace</h1></div>
          <div class="pw-actions"><button class="pw-button">Export</button><button class="pw-button pw-primary">Save</button></div>
        </header>
        <div class="pw-sections"><button aria-current="page">Retention</button><button>Marketing</button><button>Budgets</button><button>Summary</button></div>
        <div class="pw-content">
          <section class="pw-local-retention">
            <div class="pw-local-retention-hero">
              <div><h2>Local retention</h2><p>Long synthetic identifiers should wrap inside rows without forcing the native window wider.</p></div>
            </div>
            <div class="pw-retention-summary">
              <div><span>Derived shows</span><strong>1,248</strong><small>Fixture rows only</small></div>
              <div><span>Active clients</span><strong>742</strong><small>Fixture rows only</small></div>
              <div><span>Billed fees</span><strong>$128,400</strong><small>Fixture rows only</small></div>
            </div>
            <div class="pw-local-tables">
              <section>
                <h3>Matching review</h3>
                <table>
                  <thead><tr><th>Date</th><th>Clinician</th><th>Client ID</th><th>Status</th><th>Attendance</th><th>Billing</th><th>Billed fee</th></tr></thead>
                  <tbody>
                    <tr>
                      <td data-label="Date">2026-10-13</td>
                      <td data-label="Clinician">Synthetic Clinician With A Very Long Name</td>
                      <td data-label="Client ID">${longClientId}</td>
                      <td data-label="Status">Ambiguous same-day pairing</td>
                      <td data-label="Attendance">2</td>
                      <td data-label="Billing">1</td>
                      <td data-label="Billed fee">$240</td>
                    </tr>
                  </tbody>
                </table>
              </section>
              <section>
                <h3>Attendance and retention</h3>
                <table>
                  <thead><tr><th>Clinician</th><th>Derived shows</th><th>Client cancel</th><th>No-show</th><th>Clinician cancel</th><th>Active clients</th><th>First observed</th><th>Retained</th></tr></thead>
                  <tbody>
                    <tr>
                      <td data-label="Clinician">Synthetic Clinician With A Very Long Name</td>
                      <td data-label="Derived shows">120</td>
                      <td data-label="Client cancel">12</td>
                      <td data-label="No-show">4</td>
                      <td data-label="Clinician cancel">3</td>
                      <td data-label="Active clients">38</td>
                      <td data-label="First observed">44 (6 immature)</td>
                      <td data-label="Retained">31</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
            <div class="pw-table-scroll">
              <table class="pw-table pw-edit-table">
                <thead><tr><th>Expense</th><th>Category</th><th>Amount / rate</th><th>Frequency</th><th>Forecast from</th><th>Billing day</th><th>First bill date</th></tr></thead>
                <tbody><tr><th>Synthetic long fixed table row</th><td>Operations</td><td>$1,250</td><td>Monthly</td><td>2026-10-01</td><td>15</td><td>2026-10-15</td></tr></tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
    <script>
      const doc = document.documentElement;
      const body = document.body;
      const wrappers = [...document.querySelectorAll('.pw-table-scroll, .pw-local-tables section')].map((el, index) => ({
        index,
        className: el.className,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth
      }));
      const payload = {
        innerWidth,
        docClientWidth: doc.clientWidth,
        docScrollWidth: doc.scrollWidth,
        bodyScrollWidth: body.scrollWidth,
        wrappers,
        hasPageOverflow: doc.scrollWidth > innerWidth + 1 || body.scrollWidth > innerWidth + 1
      };
      const output = document.createElement('pre');
      output.id = 'metrics';
      output.textContent = JSON.stringify(payload);
      document.body.append(output);
    </script>
  </body>
</html>`;

const htmlPath = join(outDir, "fixture.html");
writeFileSync(htmlPath, html);

const viewports = [
  [1280, 820],
  [900, 720],
  [760, 720],
  [600, 720],
  [390, 760],
];

const results = [];
for (const [width, height] of viewports) {
  const metricsPath = join(outDir, `metrics-${width}.json`);
  const screenshotPath = join(outDir, `practice-responsive-${width}.png`);
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=${width},${height}`,
    `--screenshot=${screenshotPath}`,
    `file://${htmlPath}`,
  ]);
  const dom = execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      `--window-size=${width},${height}`,
      "--dump-dom",
      "--virtual-time-budget=1000",
      `file://${htmlPath}`,
    ],
    { encoding: "utf8" },
  );
  const matches = [
    ...dom.matchAll(new RegExp('<pre id="metrics">([^<]+)</pre>', "g")),
  ];
  const match = matches.at(-1);
  if (!match) {
    throw new Error(`No metrics emitted for ${width}px viewport`);
  }
  const metrics = JSON.parse(match[1]);
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  results.push({ width, height, screenshotPath, metricsPath, metrics });
}

for (const result of results) {
  const { metrics } = result;
  console.log(
    `${result.width}x${result.height}: doc=${metrics.docScrollWidth}/${metrics.innerWidth} body=${metrics.bodyScrollWidth}/${metrics.innerWidth} overflow=${metrics.hasPageOverflow}`,
  );
  if (metrics.hasPageOverflow) {
    throw new Error(`Page overflow at ${result.width}px`);
  }
}
console.log(`Artifacts: ${outDir}`);
