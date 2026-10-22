import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const src = "artifacts/comp-dashboard/src/";
const base = "5cb154e2";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const req = createRequire(path.join(root, "artifacts/comp-dashboard/package.json"));
const ts = req("typescript");
const postcss = createRequire(req.resolve("vite/package.json"))("postcss");
const sheets = ["pages/practice.css", "pages/hub.css", "pages/practice-workspace.css", "pages/practice-approved.css",
  ...["historical-period-values", "metric-comparison", "overview-historical-summary", "percentage-kpi", "profit-first-planning", "section-widget-grid"].map(n => `components/practice/${n}.css`)];
// Independent baseline contract, deliberately not imported from the migrator.
const originals = {
  canvas: "#090c10", navigation: "#0d1116", panel: "#12171d", shade: "#182028",
  depth: "#10161c", widget: "#20272c", input: "#19232b", action: "#1b252e",
  border: "#303842", "border-strong": "#46515a", "border-action": "#46535f", "border-input": "#52616d",
  track: "#3b454b", text: "#f2f4f5", "text-secondary": "#d7e4e9", "text-detail": "#c2cbd1",
  "text-muted": "#a8b3be", positive: "#9fd8c2", goal: "#76dda4", negative: "#ee8c84",
  "text-quiet": "#7f939d", "text-quiet-nav": "#7f949f",
};
const tokenAst = postcss.parse(read(src + "pages/practice-tokens.css"));
const defaults = {};
tokenAst.walkRules(rule => {
  if (rule.selector === ":root") rule.walkDecls(decl => {
    if (decl.prop.startsWith("--pw-tone-")) defaults[decl.prop.slice(10)] = decl.value;
  });
});

test("22 owned dark defaults equal independent original hex contract", () => {
  assert.deepEqual(defaults, originals);
  const tidal = tokenAst.nodes.find(n => n.type === "rule" && n.selectors.includes(':root[data-practice-material="tidal"]'));
  assert.ok(tidal, "Tidal root selector exists");
  assert.deepEqual(tidal.nodes.filter(n => n.type === "decl").map(n => n.prop).sort(), Object.keys(defaults).map(n => `--pw-tone-${n}`).sort());
});

for (const sheet of sheets) test(`reverse tokens reproduce original CSS bytes: ${sheet}`, () => {
  const current = read(src + sheet);
  const restored = current.replace(/var\(--pw-tone-([a-z-]+)\)/g, (_, name) => {
    assert.ok(Object.hasOwn(defaults, name), `Undefined token ${name}`);
    return defaults[name];
  });
  assert.equal(restored, git("show", `${base}:${src}${sheet}`));
});

test("retained app PNG has exact immutable selected-artwork SHA-256", () => {
  const expected = "72e88725981c904549ec0ba12bedee9ab3684e55ec2aef8c70aaf5049554082b";
  const file = src + "assets/practice-tidal-art.png";
  assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"), expected, file);
});

test("workspace bytes differ only by declared presentation import, attribute and child", () => {
  const file = src + "pages/practice-workspace.tsx";
  const original = git("show", `${base}:${file}`);
  const expected = original
    .replace('import "@/components/practice/historical-period-values.css";\n', 'import "@/components/practice/historical-period-values.css";\nimport { TidalMaterial } from "@/components/practice/tidal-material";\n')
    .replace('    <div className="practice-theme pw-app" data-appearance="dark">', '    <div className="practice-theme pw-app" data-appearance="dark" data-material="tidal">\n      <TidalMaterial section={`${mode}:${section}:${visibleTool ?? ""}`} />');
  assert.notEqual(expected, original, "Presentation anchors must exist");
  assert.equal(read(file), expected);
});

test("all changed/new files stay within reviewed theme, PDF and mobile scope", () => {
  const allowed = new Set([...sheets.map(s => src + s), src + "pages/practice-workspace.tsx",
    src + "pages/practice-tokens.css", src + "components/practice/tidal-material.tsx",
    src + "components/practice/tidal-material.css", src + "assets/practice-tidal-art.png", src + "assets/practice-tidal-art.jpg",
    "verification/tidal-theme.test.mjs", "verification/TIDAL-INDEPENDENT-REVIEW.md",
    "verification/fixtures/tidal-workspace.json", "verification/tidal-preview-server.mjs", "verification/tidal-render-acceptance.mjs",
    "verification/tidal-encoding-check.mjs", "verification/tidal-performance.mjs",
    "verification/tidal-interactions.mjs", "verification/tidal-fidelity-board.mjs", "verification/tidal-motion-tour.mjs",
    "verification/OCTOBER22-TIDAL-OWNED-RECEIPT.md"]);
  // Existing publisher history only; its separate before/after hash guard owns preservation.
  const publisherHistory = new Set([".agents/memory/MEMORY.md", ".agents/memory/release-evidence-temp-files.md"]);
  // Separately reviewed PDF-loading follow-up; report bodies have their own
  // byte-parity contract. Keep this exact list rather than a broad path exemption.
  const reviewedPdfFollowup = new Set([src + "components/tabs/export-tab.tsx",
    "verification/lazy-pdf-build.mjs", "verification/lazy-pdf-build-results.json",
    "verification/lazy-pdf-export-acceptance.mjs", "verification/lazy-pdf-export-results.json",
    "verification/lazy-pdf-export.test.mjs", "verification/OCTOBER22-LAZY-PDF-RECEIPT.md"]);
  // Accepted mobile readiness e30725e5 is a separate runtime change, not part of
  // the theme. Permit its exact reviewed bytes, never a mobile-directory waiver.
  const reviewedMobileReadiness = new Map([
    ["artifacts/comp-mobile/server/serve.js", "d0161767d8de2ed7320e982faa5e484ad455bbe3cc2a18dea591567320c78be4"],
    ["verification/OCTOBER22-MOBILE-READINESS-RECEIPT.md", "1ffa0d30c418575dfff1a8b001bf731df1b57781b9d13f95145db872d0d189ae"],
    ["verification/mobile-readiness.test.cjs", "794a0f9fa5b8a8e18fae4270b712d312e449c4c74a0bb123c2ee42669d42aab1"],
  ]);
  const reviewedDataFollowup = new Set([
    src + "components/practice/local-retention-workspace.tsx",
    src + "components/practice/billing-resolution-review.tsx",
    src + "lib/practice-package-file.ts", src + "lib/practice-package-file.test.ts",
    "verification/data-import-readability.mjs", "verification/data-import-readability-results.json",
    "verification/OCTOBER22-DATA-READABILITY-RECEIPT.md",
  ]);
  const reviewedIconFollowup = new Set([
    "artifacts/comp-dashboard/index.html",
    ...["apple-touch-icon.png", "favicon-16.png", "favicon-32.png", "favicon.svg", "favicon.ico",
      "icon-192.png", "icon-256.png", "icon-512.png", "logo.svg", "maskable-512.png", "site.webmanifest"].map(name => "artifacts/comp-dashboard/public/" + name),
    src + "assets/tpa-horizon-lens-refined.original.png", "artifacts/comp-mobile/app.json",
    ...["icon.png", "favicon-32.png", "tpa-adaptive-foreground.png"].map(name => "artifacts/comp-mobile/assets/images/" + name),
    "tools/practice-converter/Resources/converter.icns",
    ...["prepare-tpa-icons.mjs", "render-tpa-icons.swift", "tpa-icon-manifest.json", "tpa-icon-visual-qa.mjs",
      "tpa-icons.test.mjs", "tpa-icon-visual-results.json", "OCTOBER22-TPA-HORIZON-ICON-RECEIPT.md"].map(name => "verification/" + name),
  ]);
  const changes = [...git("diff", base, "--name-only", "-z").split("\0"), ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0")].filter(Boolean);
  for (const file of changes.filter(file => reviewedMobileReadiness.has(file))) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"), reviewedMobileReadiness.get(file), `Reviewed mobile bytes changed: ${file}`);
  }
  assert.deepEqual(changes.filter(file => !allowed.has(file) && !publisherHistory.has(file) && !reviewedPdfFollowup.has(file) && !reviewedMobileReadiness.has(file) && !reviewedDataFollowup.has(file) && !reviewedIconFollowup.has(file)), [], "Unexpected edits (including schema/API/dependencies) require separate review");
});

test("token defaults are statically imported by the eagerly loaded workspace", () => {
  assert.match(read(src + "App.tsx"), /import PracticeWorkspace from "@\/pages\/practice-workspace"/);
  assert.match(read(src + "pages/practice-workspace.tsx"), /import \{ TidalMaterial \} from "@\/components\/practice\/tidal-material"/);
  assert.match(read(src + "components/practice/tidal-material.tsx"), /import "\.\.\/\.\.\/pages\/practice-tokens.css"/);
  for (const sheet of sheets) {
    for (const [, name] of read(src + sheet).matchAll(/var\(--pw-tone-([a-z-]+)/g)) assert.ok(Object.hasOwn(defaults, name), name);
  }
});

// Execute only the real hook bodies, using in-memory TypeScript erasure and a
// minimal React/DOM scheduler double. No React render, browser, build or files emitted.
function harness({ reduced = false, previous = null } = {}) {
  let hook = 0;
  let nextFrame = 1;
  let paints = 0;
  const refs = [], effects = [], pending = [], frames = new Map(), events = new Map(), mediaEvents = new Map();
  const attrs = new Map(previous === null ? [] : [["data-practice-material", previous]]);
  const animations = [];
  const media = { matches: reduced, addEventListener: (n, f) => mediaEvents.set(n, f), removeEventListener: (n, f) => { if (mediaEvents.get(n) === f) mediaEvents.delete(n); } };
  const surface = { animate() {
    let reject;
    const animation = { cancelled: false, finished: new Promise((_, r) => { reject = r; }), cancel() { this.cancelled = true; reject(new Error("AbortError")); } };
    animations.push(animation);
    return animation;
  } };
  const art = { style: new Proxy({}, { set(target, prop, value) { paints++; target[prop] = value; return true; } }), closest: () => ({ querySelectorAll(selector) { assert.equal(selector, ".pw-content:not([hidden])"); return [surface]; } }) };
  const win = {
    scrollY: 1000, matchMedia: () => media,
    addEventListener: (n, f) => events.set(n, f), removeEventListener: (n, f) => { if (events.get(n) === f) events.delete(n); },
    requestAnimationFrame: fn => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const react = {
    useRef(value) { const i = hook++; return refs[i] ??= { current: value }; },
    useEffect(fn, deps) {
      const i = hook++, old = effects[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
    },
  };
  const source = ts.transpileModule(read(src + "components/practice/tidal-material.tsx"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, window: win, document: { documentElement: {
      getAttribute: n => attrs.get(n) ?? null, setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n),
    } },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected dependency ${name}`);
    },
  }, { timeout: 1000 });
  function render(section = "practice:summary:") {
    hook = 0;
    const element = exports.TidalMaterial({ section });
    element.props.ref.current = art;
    while (pending.length) pending.shift()();
  }
  function unmount() { for (const effect of effects) effect?.cleanup?.(); }
  function flush() { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(fn => fn()); }
  return { render, unmount, flush, art, attrs, frames, animations, events, mediaEvents,
    paints: () => paints, scroll: () => events.get("scroll")?.(),
    preference(value) { media.matches = value; mediaEvents.get("change")?.(); },
  };
}

test("section changes cancel prior transitions; same section does not restart; unmount restores theme", async () => {
  const h = harness({ previous: "previous-material" });
  h.render();
  assert.equal(h.attrs.get("data-practice-material"), "tidal");
  assert.equal(h.animations.length, 1);
  h.render();
  assert.equal(h.animations.length, 1);
  h.render("practice:money:");
  assert.equal(h.animations[0].cancelled, true);
  assert.equal(h.animations.length, 2);
  h.unmount();
  assert.equal(h.attrs.get("data-practice-material"), "previous-material");
  assert.ok(h.animations.every(a => a.cancelled));
  assert.equal(h.events.size + h.mediaEvents.size, 0);
  await Promise.resolve();
});

test("reduced motion suppresses entry animations and parallax; dynamic changes cancel active transitions", async () => {
  const h = harness({ reduced: true });
  h.render();
  assert.equal(h.art.style.transform, "none");
  assert.equal(h.animations.length, 0);
  h.preference(false);
  assert.equal(h.art.style.transform, "translate3d(0,-140px,0)");
  h.render("practice:money:");
  assert.equal(h.animations.length, 1);
  h.preference(true);
  assert.ok(h.animations.every(a => a.cancelled));
  assert.equal(h.art.style.transform, "none");
  h.unmount();
  assert.equal(h.attrs.has("data-practice-material"), false);
  await Promise.resolve();
});

test("ordinary scroll coalesces frames and unmount cancels queued paint", async () => {
  const h = harness(); h.render(); h.scroll(); h.scroll();
  assert.equal(h.frames.size, 1);
  h.unmount();
  assert.equal(h.frames.size, 0);
  await Promise.resolve();
});

test("preference change between scroll and unmount leaves no queued paint", async () => {
  const h = harness(); h.render(); h.scroll(); h.preference(true);
  h.unmount();
  const queued = h.frames.size;
  const paints = h.paints();
  h.flush();
  await Promise.resolve();
  assert.deepEqual({ queued, detachedPaints: h.paints() - paints }, { queued: 0, detachedPaints: 0 },
    "Preference paint must retain/cancel the outstanding frame; no detached artwork mutation after unmount");
});

test("reduced-motion CSS is scoped to the owned Tidal surface", () => {
  const ast = postcss.parse(read(src + "components/practice/tidal-material.css"));
  const unscoped = [];
  ast.walkAtRules("media", media => {
    if (!media.params.includes("prefers-reduced-motion")) return;
    media.walkRules(rule => {
      if (rule.selectors.some(selector => !/^\.pw-app\[data-material="tidal"\](?:$|\s|::)/.test(selector))) unscoped.push(rule.selector);
    });
  });
  assert.deepEqual(unscoped, [], "Global motion overrides leak onto non-Tidal routes because App eagerly imports the workspace");
  const artworkRules = [];
  ast.walkRules('.pw-app[data-material="tidal"] .pw-tidal-art', rule => artworkRules.push(rule));
  const reduced = artworkRules.find(rule => rule.parent.type === "atrule" && rule.parent.params.includes("prefers-reduced-motion"));
  assert.ok(reduced, "Reduced-motion artwork override retained");
  assert.ok(reduced.nodes.some(n => n.prop === "transform" && n.value === "none" && n.important));
  assert.ok(reduced.nodes.some(n => n.prop === "will-change" && n.value === "auto"));
  const mobile = artworkRules.find(rule => rule.parent.type === "atrule" && rule.parent.params === "(max-width:760px)");
  assert.ok(mobile, "Mobile artwork crop override retained");
  assert.ok(mobile.nodes.some(n => n.prop === "background-position" && n.value === "64% top"));
  assert.ok(mobile.nodes.some(n => n.prop === "background-size" && n.value === "auto 1100px"));
});

test("CSS references the bounded JPEG derivative, with original PNG dimensions and PNG retained", () => {
  const cssPath = src + "components/practice/tidal-material.css";
  const ast = postcss.parse(read(cssPath));
  const backgrounds = [];
  ast.walkRules(".pw-tidal-art", rule => rule.walkDecls("background", decl => backgrounds.push(decl.value)));
  assert.equal(backgrounds.length, 1);
  const urls = [...backgrounds[0].matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
  assert.deepEqual(urls, ["../../assets/practice-tidal-art.jpg"]);
  const jpeg = fs.readFileSync(path.resolve(root, path.dirname(cssPath), urls[0]));
  const png = fs.readFileSync(path.join(root, src, "assets/practice-tidal-art.png"));
  assert.equal(jpeg.length, 434287, "Review snapshot JPEG byte count");
  assert.ok(jpeg.length < png.length, "Derivative is smaller than retained PNG");
  assert.equal(jpeg.readUInt16BE(0), 0xffd8, "JPEG SOI");
  assert.equal(jpeg.readUInt16BE(jpeg.length - 2), 0xffd9, "JPEG EOI");
  // Inspect metadata only; decoding and rendered fidelity belong to the main task.
  let dimensions;
  for (let offset = 2; offset < jpeg.length;) {
    assert.equal(jpeg[offset++], 0xff, "JPEG marker boundary");
    while (jpeg[offset] === 0xff) offset++;
    const marker = jpeg[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = jpeg.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= jpeg.length, "Bounded JPEG segment");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      assert.ok(length >= 8);
      dimensions = [jpeg.readUInt16BE(offset + 5), jpeg.readUInt16BE(offset + 3)];
      break;
    }
    offset += length;
  }
  assert.deepEqual(dimensions, [png.readUInt32BE(16), png.readUInt32BE(20)]);
  assert.deepEqual(dimensions, [1486, 1059]);
});
