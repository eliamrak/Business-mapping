# October 20 macOS Practice Delivery Reconciliation

Audit date: October 20, 2026. This document records the preceding read-only local audit and supplied author evidence. It does not certify the currently running app's loaded web release or implement a delivery change.

## Scope and Execution Boundary

The installed wrapper is `/Users/eliam/Applications/Practice.app`. Wrapper sources and retained build artifacts are in `/Users/eliam/Documents/Codex/2026-10-13/task-7`.

The audit read local source, metadata, archive entries, executable symbols and existing verification records; calculated SHA-256 hashes; and inspected and verified the installed code signature. ZIP entries were streamed without extracting files. No build or app executable was run. No launch, focus change, reload, restart, replacement, network/browser access, or inspection of cookies, private caches, authentication data or credentials occurred. The owner live call had ended; that did not authorize app interaction.

The sole subsequent write is this requested documentation file. No runtime, source, configuration, existing documentation or application artifact was changed.

## Verified Installed Identity

[Installed Info.plist](/Users/eliam/Applications/Practice.app/Contents/Info.plist:13) reports:

| Field | Value |
| --- | --- |
| Bundle identifier | `com.local.practice.nativeweb` |
| Short version | `1.0.0` |
| Build | `1` |
| Executable | `Contents/MacOS/Practice` |
| Start URL | `https://compensation-calculater-app.replit.app/` |
| Signature | Ad hoc; no TeamIdentifier |
| Architecture | Mach-O arm64 |

The installed bundle contains the executable, plist, `practice.icns` and signature-resource file; no embedded JavaScript files were found. `codesign --verify --deep --strict --verbose=2` passed for the installed bundle, reporting valid on disk and satisfaction of its designated requirement. This verifies local bundle integrity, not source provenance, notarization or the running web release.

## Artifact Hash Evidence

All hashes below are SHA-256. Archive names are relative to the wrapper workspace's `dist/` directory unless otherwise stated.

| Artifact | SHA-256 |
| --- | --- |
| Installed `Contents/MacOS/Practice` | `c031f884ddcdae25508a919220b2c88bc92e3a4e22430597884cb5fa0994e44d` |
| `Practice.app.zip`, streamed executable | `c031f884ddcdae25508a919220b2c88bc92e3a4e22430597884cb5fa0994e44d` |
| `Practice.app.zip`, whole archive | `8873656d4867bcb0c0478678f8964acadaba09fc8cb4ac87953a792e0e3e1e2b` |
| `Practice.app 2.zip`, streamed executable | `d8f16e96eafd1a37755f6c2779068bc56e122095980c4bb7f041ddb20d9ca708` |
| `Practice.app 2.zip`, whole archive | `e121daee609663c0bd2ef6dd1c75f90d8023e853e7c45691b15c5ce552107a59` |
| Installed plist; current ZIP plist; source `Config/Practice.plist` | `ea66c5954796e3631925acf283f268f0a2a32781332ac765e0f8000b5371d064` |
| Installed icon; current ZIP icon | `230db6e40a7edb5cf9b5140a7d63b8807351f6133f7f93e125524598d0ac87a3` |
| Installed `CodeResources`; current ZIP `CodeResources` | `eaf943db3908942b4d9ad3e84473e4b49a413fdef4705b9cfc2a4ae40c694ccf` |

Archive references: [current Practice.app.zip](/Users/eliam/Documents/Codex/2026-10-13/task-7/dist/Practice.app.zip) and [Practice.app 2.zip](</Users/eliam/Documents/Codex/2026-10-13/task-7/dist/Practice.app 2.zip>).

The installed executable matches the current ZIP's executable. All four regular bundle files listed in that ZIP have matching installed hashes. This is an actual installed-to-archive match established without rebuilding. It does not identify the exact source bytes used by the compiler or prove which executable is mapped by a running process.

## Native Version Ambiguity and README Divergence

Both retained ZIPs declare `1.0.0`, build `1`, despite having different executable hashes. The installed plist also declares `1.0.0`, build `1`. Native version labels alone therefore cannot distinguish these builds.

[README.md:59](/Users/eliam/Documents/Codex/2026-10-13/task-7/README.md:59) assigns hash `e121daee...` to `dist/Practice.app.zip`. At audit time that hash instead belongs to `Practice.app 2.zip`; the current named archive hashes to `8873656d...` and matches the installed executable. The README's recorded archive identity is out of date.

The README [staging description](/Users/eliam/Documents/Codex/2026-10-13/task-7/README.md:55) and `dist/Practice.app` symlink point to `/tmp/task-7-native-apps/dist/Practice.app`. That staged bundle and `/tmp/task-7-native-apps/extracted/Practice.app` existed as directories but contained no regular files at audit time. They could not supply an executable comparison. The retained ZIP supplied the match instead.

The [installation plan](/Users/eliam/Documents/Codex/2026-10-13/task-7/README.md:64) refers to an existing canceled shortcut awaiting replacement. The currently installed bundle is the native wrapper described above; that plan does not describe the present installed state.

## Source and Build Provenance Limits

[scripts/build.sh:35](/Users/eliam/Documents/Codex/2026-10-13/task-7/scripts/build.sh:35) compiles `NativeWebPolicy.swift`, `WindowSizing.swift`, `NativeWebApp.swift` and `main.swift` with `swiftc -O`, AppKit and WebKit. It copies the static configuration plist, ad-hoc signs, verifies and archives the bundles. It does not emit a source revision/hash manifest or compiler/toolchain manifest, or automatically distinguish native builds through version increments. The script was inspected, not executed.

Current source hashes, recorded for identification rather than claimed compilation provenance:

| Wrapper workspace file | SHA-256 |
| --- | --- |
| `Sources/NativeWebApp.swift` | `3dd166d54103b9b15cb22bd16e0d1ad34f5a9c58029f6f2a9a43fef7669f5cdf` |
| `Sources/NativeWebPolicy.swift` | `dc2f5446071999e5fb97e7db78ebc3d44ec4b1b6670c9f3d1b6801e11a77d00f` |
| `Sources/WindowSizing.swift` | `56e2e63b017dbadf2eab85070eb332b14c9f63028b9431ee6db333b6b71a2efd` |
| `Sources/main.swift` | `19fd8292cdcacbcb98c9fb5f22b7b9b4105739af4ee89f4041c450e43452dffd` |
| `scripts/build.sh` | `1331bec942790eea7aa718fcedbbd57fcc0a0810949b050d0afaa557834af8bd` |

The installed executable's symbol table contains `WindowSizing.contentRect`, `WindowSizing.minimumSize`, `BrowserWindowController.windowWillResize`, `reload` and `printConfigAndExit`, consistent with the current source structure. Source and executable modification timestamps are compatible: `NativeWebApp.swift` was modified October 13 at 15:11:45 -0400, `WindowSizing.swift` at 15:11:42 -0400, and the installed executable at 15:12:23 -0400. Symbols and timestamps support correspondence but do not prove exact-source compilation. Exact installed-binary-to-current-Swift-source attestation remains unverified from the inspected artifacts.

## Update Mechanism and Running Web State

The source [enables JavaScript and uses the default WebKit data store](/Users/eliam/Documents/Codex/2026-10-13/task-7/Sources/NativeWebApp.swift:141). It [loads the configured start URL](/Users/eliam/Documents/Codex/2026-10-13/task-7/Sources/NativeWebApp.swift:222) during window construction and provides a [manual Reload command](/Users/eliam/Documents/Codex/2026-10-13/task-7/Sources/NativeWebApp.swift:238) calling `webView.reload()`.

No native updater, update feed, web-release comparison, pinned web asset or automatic native/web synchronization mechanism was found in the inspected wrapper source, config or build script. Native shell delivery requires a separately built and installed bundle. Hosted web delivery is obtained through web navigation/loading behavior; publishing a web release does not itself establish which JavaScript an already-open window has loaded. The wrapper's `1.0.0` is a native version, not a web-release identifier.

Supplied author evidence, not fetched again during this audit: the fresh public web asset `B5r4xObK` has SHA-256 `cda7aa9f342081b07597e3d7f1e0b0ece3f0ed3495a1be2fb2b807f0ba445c95` and matches the October 19 release. Both trailing options also appear in that public web release. This supports a requirement omission in the confirmed public release; it does not prove stale delivery to the wrapper. No stale-running-asset diagnosis is established.

The currently running app's loaded asset, release and behavior remain unverified. The audit did not inspect the running process or its page, navigate it, or read its persistent data.

The retained [native acceptance record](/Users/eliam/Documents/Codex/2026-10-13/task-7/verification/native-live-release/practice-native-acceptance.json:2) is dated October 13, expects release `47af84f`, and explicitly describes an isolated nonpersistent WKWebView. Its records report `containsExpectedRelease: false` and `appLikeSelectorsPresent: false`. It is neither current installed-app acceptance nor evidence of the October 20 running app's release.

## Proposed Synchronized Delivery Acceptance

This is a proposal only. No implementation or owner-app interaction is authorized by this document.

1. Record a paired delivery manifest with a distinguishable native version/build, native executable and archive hashes, exact wrapper source revision/hashes and compiler/toolchain, and the corresponding public web release and asset hash. Record the intended compatible pair without implying native and web version strings must be identical.
2. Reconcile README hashes, retained archive names and actual installation evidence in a separately requested change. Use the current installed-to-archive match as the baseline; do not assume a native replacement is required for a web requirement change.
3. Schedule an explicit owner-coordinated acceptance window. If the app is open, have the owner save or finish pending work and confirm a safe reload or quit/relaunch point before any interaction. An ended call does not establish that pending work is saved. The wrapper has no demonstrated native unsaved-work coordination. Its [Save Page As handler](/Users/eliam/Documents/Codex/2026-10-13/task-7/Sources/NativeWebApp.swift:257) opens the URL in an external browser; it is not application-data saving.
4. During that separately authorized window, establish the loaded web release inside the installed wrapper using an agreed non-sensitive release diagnostic. Compare it to the expected public asset/release. Preserve authentication and stored data; do not clear cookies or caches as a diagnostic shortcut.
5. Run the same scoped requirement acceptance in public web and installed wrapper against the identified release, including the agreed expected treatment of both trailing options. Record expected versus observed behavior, native identity, loaded web identity, time and result. If identities match but the requirement fails, report a requirement failure without labeling it stale delivery.
6. For any separately authorized native replacement, retain the prior verified artifact for rollback and coordinate installation only after the owner has safely exited. Accept the paired delivery only after identity and behavior checks pass.

## Outcome and Remaining Blockers

Verified: the installed native executable and regular bundle files match the current retained ZIP; its strict signature verification passes. Confirmed ambiguity: two different native executables share version `1.0.0`, build `1`, and the README names an outdated archive hash.

Unverified: exact current-source compilation provenance, the running process's executable identity, the currently loaded wrapper web asset, and current installed-wrapper requirement acceptance. Resolving runtime acceptance requires a separately authorized owner-coordinated session. No implementation, rebuild, app interaction or private-data inspection was performed.
