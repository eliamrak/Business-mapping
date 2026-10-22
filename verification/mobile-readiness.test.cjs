const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const original = require("node:child_process").execFileSync("git", ["show", "5cb154e2a9db6d142c83b98f179050316ef57fa7:artifacts/comp-mobile/server/serve.js"], { cwd: root, encoding: "utf8" });
const candidate = fs.readFileSync(path.join(root, "artifacts/comp-mobile/server/serve.js"), "utf8");
const template = fs.readFileSync(path.join(root, "artifacts/comp-mobile/server/templates/landing-page.html"));

function fixture(t, basePath = "/comp-mobile/", overrides = {}) {
  const root = fs.mkdtempSync(path.join(__dirname, ".fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = path.join(root, "static-build");
  const prefix = basePath.replace(/\/+$/, "");
  const manifests = {};
  const assets = {};
  fs.mkdirSync(path.join(root, "server/templates"), { recursive: true });
  fs.writeFileSync(path.join(root, "server/templates/landing-page.html"), template);
  fs.writeFileSync(path.join(root, "app.json"), JSON.stringify({ expo: { name: "Fixture Mobile" } }));
  for (const platform of ["ios", "android"]) {
    const relative = `/123/_expo/static/js/${platform}/bundle.js`;
    assets[platform] = path.join(build, relative);
    fs.mkdirSync(path.dirname(assets[platform]), { recursive: true });
    fs.writeFileSync(assets[platform], `console.log('${platform}');`);
    manifests[platform] = path.join(build, platform, "manifest.json");
    fs.mkdirSync(path.dirname(manifests[platform]), { recursive: true });
    fs.writeFileSync(manifests[platform], JSON.stringify({
      id: `fixture-${platform}`,
      launchAsset: { url: `https://deployment.invalid${prefix}${relative}` },
    }));
  }
  const listens = [];
  function load(source) {
    let handler;
    vm.runInNewContext(source, {
      require(name) {
        if (name === "http") return {
          createServer(callback) {
            handler = callback;
            return { listen(...args) { listens.push(args.slice(0, 2)); } };
          },
        };
        if (name === "fs") return { ...fs, ...overrides };
        if (name === "path") return path;
        throw new Error(`Unexpected dependency: ${name}`);
      },
      __dirname: path.join(root, "server"),
      process: { env: { BASE_PATH: basePath, PORT: "8081" } },
      URL,
      console: { log() {} },
    }, { filename: "serve.js" });
    return (url, headers = {}) => {
      let status;
      let responseHeaders;
      let body;
      handler({ url, headers: { host: "fixture.invalid", ...headers } }, {
        writeHead(value, values = {}) { status = value; responseHeaders = values; },
        end(value = "") { body = Buffer.isBuffer(value) ? value.toString("utf8") : value; },
      });
      return { status, headers: { ...responseHeaders }, body };
    };
  }
  const before = load(original);
  const after = load(candidate);
  function manifest(platform, value) {
    fs.writeFileSync(manifests[platform], typeof value === "string" ? value : JSON.stringify(value));
  }
  return { root, build, assets, manifests, listens, before, after, manifest };
}

function expectReady(f, ready) {
  for (const route of ["/healthcheck", "/comp-mobile/healthcheck", "/comp-mobile/healthcheck?probe=1"]) {
    const result = f.after(route, { "expo-platform": "ios" });
    assert.equal(result.status, ready ? 200 : 503, route);
    assert.deepEqual(JSON.parse(result.body), { ready });
    assert.equal(result.headers["content-type"], "application/json");
    assert.equal(result.headers["cache-control"], "no-store");
  }
}

test("healthy build accepts prefixed and already-stripped healthchecks, retaining port", (t) => {
  const f = fixture(t);
  expectReady(f, true);
  assert.deepEqual(f.listens, [[8081, "0.0.0.0"], [8081, "0.0.0.0"]]);
  for (const platform of ["ios", "android"]) {
    const served = JSON.parse(f.after("/manifest", { "expo-platform": platform }).body);
    assert.equal(served.launchAsset.url, JSON.parse(fs.readFileSync(f.manifests[platform])).launchAsset.url);
    const assetPath = new URL(served.launchAsset.url).pathname;
    assert.equal(f.after(assetPath).body, fs.readFileSync(f.assets[platform], "utf8"));
  }
});

for (const platform of ["ios", "android"]) {
  for (const [name, mutate] of Object.entries({
    "missing manifest": (f) => fs.unlinkSync(f.manifests[platform]),
    "corrupt manifest": (f) => f.manifest(platform, "{broken"),
    "empty manifest": (f) => f.manifest(platform, ""),
    "null manifest": (f) => f.manifest(platform, "null"),
    "missing launch asset": (f) => f.manifest(platform, {}),
    "empty launch URL": (f) => f.manifest(platform, { launchAsset: { url: "" } }),
    "non-string launch URL": (f) => f.manifest(platform, { launchAsset: { url: 42 } }),
    "unsupported URL": (f) => f.manifest(platform, { launchAsset: { url: "file:///etc/passwd" } }),
    "missing bundle": (f) => fs.unlinkSync(f.assets[platform]),
    "empty bundle": (f) => fs.writeFileSync(f.assets[platform], ""),
    "directory bundle": (f) => { fs.unlinkSync(f.assets[platform]); fs.mkdirSync(f.assets[platform]); },
    "outside-build symlink bundle": (f) => {
      const outside = path.join(f.root, "outside.js");
      fs.writeFileSync(outside, "console.log('outside');");
      fs.unlinkSync(f.assets[platform]);
      fs.symlinkSync(outside, f.assets[platform]);
    },
    "outside-build symlink manifest": (f) => {
      const outside = path.join(f.root, "outside.json");
      fs.copyFileSync(f.manifests[platform], outside);
      fs.unlinkSync(f.manifests[platform]);
      fs.symlinkSync(outside, f.manifests[platform]);
    },
  })) {
    test(`${platform}: ${name} returns 503`, (t) => {
      const f = fixture(t);
      mutate(f);
      expectReady(f, false);
    });
  }
}

test("missing entire build returns 503, and readiness recovers after repair", (t) => {
  const f = fixture(t);
  const saved = fs.readFileSync(f.manifests.android);
  fs.unlinkSync(f.manifests.android);
  expectReady(f, false);
  fs.writeFileSync(f.manifests.android, saved);
  expectReady(f, true);
  fs.rmSync(f.build, { recursive: true });
  expectReady(f, false);
});

test("unreadable manifest and launch asset return 503 (deterministic EACCES injection)", (t) => {
  for (const suffix of ["ios/manifest.json", "android/bundle.js"]) {
    const f = fixture(t, "/comp-mobile/", {
      accessSync(file, mode) {
        if (file.endsWith(suffix)) throw Object.assign(new Error("Unreadable"), { code: "EACCES" });
        return fs.accessSync(file, mode);
      },
    });
    expectReady(f, false);
  }
});

test("sibling-directory symlinks and traversal URLs cannot satisfy readiness", (t) => {
  const f = fixture(t);
  const sibling = `${f.build}-outside`;
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, "bundle.js"), "console.log('outside');");
  fs.unlinkSync(f.assets.ios);
  fs.symlinkSync(path.join(sibling, "bundle.js"), f.assets.ios);
  expectReady(f, false);
  for (const url of [
    "https://deployment.invalid/comp-mobile/../outside.js",
    "https://deployment.invalid/comp-mobile/%2e%2e/outside.js",
    "https://deployment.invalid/comp-mobile/%2e%2e%2foutside.js",
  ]) {
    fs.writeFileSync(path.join(f.root, "outside.js"), "console.log('outside');");
    f.manifest("ios", { launchAsset: { url } });
    expectReady(f, false);
  }
});

test("root BASE_PATH and root-relative launch URLs work", (t) => {
  const f = fixture(t, "/");
  f.manifest("ios", { launchAsset: { url: "/123/_expo/static/js/ios/bundle.js" } });
  assert.equal(f.after("/healthcheck").status, 200);
});

test("landing, manifest, static, headers, and missing routes match the original byte-for-byte", (t) => {
  const f = fixture(t);
  for (const prefix of ["", "/comp-mobile"]) {
    for (const url of ["/", "/manifest", "/123/_expo/static/js/ios/bundle.js", "/absent", "/healthcheck/"]) {
      for (const headers of [
        {}, { "expo-platform": "ios" }, { "expo-platform": "android" },
        { "expo-platform": "web" },
        { "x-forwarded-host": "public.invalid", "x-forwarded-proto": "http" },
      ]) {
        assert.deepEqual(f.after(prefix + url, headers), f.before(prefix + url, headers), prefix + url);
      }
    }
  }
  assert.match(f.after("/").body, /Fixture Mobile/);
  fs.unlinkSync(f.manifests.android);
  assert.deepEqual(f.after("/manifest", { "expo-platform": "android" }), f.before("/manifest", { "expo-platform": "android" }));
  assert.deepEqual(f.after("/"), f.before("/"));
  assert.equal(f.before("/healthcheck").status, 404);
});
