/**
 * What this transport cannot prove.
 *
 * Not a disclaimer — a list, and a check an agent can run against the files a
 * change touched. It exists for one failure: a QA agent reporting "verified"
 * for a change it never exercised, on the strength of a Chrome run that
 * passed.
 *
 * Carried over from the research on firetower#338 rather than reconstructed.
 * Every line reference below is into the firetower checkout at the time that
 * research closed, and 'control-firetower limits --json' prints them so a
 * reviewer can check each one.
 *
 * Three columns, because they fail differently:
 *   chrome       what the frontend transport in this binary proves
 *   shell        what a WebdriverIO run against a real binary adds, in CI
 *   residual     what neither proves, and so nobody has measured
 */
import { reachesNative } from "./reach.mjs";

/** The native surface. Twelve bridge members, then everything past the bridge. */
export const BRIDGE = [
  {
    capability: "native",
    where: "desktop/src/bridge.ts:49",
    chrome: "no — false by construction (bridge.ts:164)",
    shell: "yes; the precondition for every other row",
    residual: null,
  },
  {
    capability: "setTitle",
    where: "desktop/src/bridge.ts:50",
    chrome: "no — sets document.title (:165), which is a different thing",
    shell: "partly, via tauri.execute() -> window.title()",
    residual: "whether the window manager displays it. decorations:false means it is not drawn",
  },
  {
    capability: "setBadge",
    where: "desktop/src/bridge.ts:51-52",
    chrome: "no — no-op (:166)",
    shell: "barely: the command returns, tray::waiting is reached (main.rs:48)",
    residual: "the badge itself. Dock on macOS, taskbar overlay plus tray on Windows, nothing on Linux. Not in the webview",
  },
  {
    capability: "notify",
    where: "desktop/src/bridge.ts:53",
    chrome: "no — no-op (:167)",
    shell: "barely",
    residual: "the notification arriving. A Linux runner has no notification daemon anyway",
  },
  {
    capability: "minimize",
    where: "desktop/src/bridge.ts:54",
    chrome: "no",
    shell: "yes — isMinimized()",
    residual: "how it animates or docks",
  },
  {
    capability: "zoom",
    where: "desktop/src/bridge.ts:55",
    chrome: "no",
    shell: "yes, and worth doing: maximise-or-restore both ways",
    residual: "the per-OS meaning of maximise needs a written expectation first",
  },
  {
    capability: "close",
    where: "desktop/src/bridge.ts:56",
    chrome: "no",
    shell: "yes, as session termination. Destructive: last step of a run",
    residual: "whether the process actually exits",
  },
  {
    capability: "save",
    where: "desktop/src/bridge.ts:67-72",
    chrome: "PARTLY, AND MISLEADINGLY — the browser branch is fetch + blob + <a download> (:175-194), which :62-65 is at pains to say is not the same gesture dressed differently",
    shell: "partly: the compressing -> downloading channel and asError unwrapping, with IPC mocking",
    residual: "the native save sheet. An OS modal outside the webview; no WebDriver can click it, so pick-a-path-and-stream-a-file is unreachable",
  },
  {
    capability: "shoot",
    where: "desktop/src/bridge.ts:81",
    chrome: "no — always null (:195)",
    shell: "yes, only here: real PNG bytes, assertable magic number and dimensions",
    residual: "whether the picture is of the right thing. That is assert-design.mjs's job",
  },
  {
    capability: "canShoot",
    where: "desktop/src/bridge.ts:93",
    chrome: "no — hardcoded false (:196)",
    shell: "yes: three legs read three values (capture.rs:277 true macOS, :375 true Windows, :501-503 false elsewhere)",
    residual: null,
  },
  {
    capability: "loadArtifact",
    where: "desktop/src/bridge.ts:103",
    chrome: "NO, AND THE REASON IS THE POINT — null (:197). The mixed-content refusal the native path exists to dodge never happens on Vite",
    shell: "yes, only here: a real binary is a secure origin with the CSP at tauri.conf.json:28 actually applied",
    residual: "needs a real artifact on plain http to point at — a Tier B/C fixture",
  },
  {
    capability: "secrets",
    where: "desktop/src/bridge.ts:104-105",
    chrome: "no — null (:198). Chrome proves the Said/Done switch against mocks and nothing about a keychain",
    shell: "yes, and it is the highest-value row: a round trip per leg hits macOS Keychain, Windows Credential Manager and Secret Service. On Windows it is the first measurement of a path main.rs:411-414 says has never been measured",
    residual: "the refusal cases — locked keyring, macOS prompt declined, policy-closed Credential Manager. Those need a configured machine, not a fresh runner",
  },
];

/** bridge.ts claims to be the entire differing surface. Four modules go past it. */
export const PAST_BRIDGE = [
  {
    capability: "system-browser links and external auth",
    where: "desktop/src/open.ts:11-19",
    chrome: "no — falls back to window.open (:18)",
    shell: "partly: that openUrl does not reject",
    residual: "that a browser or a settings pane actually opened. Automation cannot follow the URL out of the app",
  },
  {
    capability: "titlebar drag and double-click maximise",
    where: "desktop/src/drag.ts:60-91",
    chrome: "no — tauriWindow() is null",
    shell: "doubtful, and not to be promised: startDragging() hands the pointer to the window server, and drag.ts:33-38 records that the webview usually does not see the mouseup. Needs a spike",
    residual: "the four-attempt history at drag.ts:1-26 is per-platform by nature",
  },
  {
    capability: "the updater",
    where: "desktop/src/update.ts:80-146",
    chrome: "no — mocked",
    shell: "no, not meaningfully: it needs two signed versions, and CI builds with createUpdaterArtifacts:false",
    residual: "AppImage self-replacement, Windows elevation. Release-workflow territory",
  },
  {
    capability: "app version in telemetry",
    where: "desktop/src/telemetry.ts:92",
    chrome: "no — api/app getVersion is absent",
    shell: "yes",
    residual: null,
  },
  {
    capability: "resize strips",
    where: "desktop/src/ui/Resize.tsx",
    chrome: "no",
    shell: "doubtful, same reason as the titlebar drag",
    residual: "the top corners do not resize diagonally on Linux — an absence to assert",
  },
  {
    capability: "real OS file drops",
    where: "desktop/src/ui/drop.ts, desktop/src/skills.ts:168-181",
    chrome: "partly, synthetically: CDP can fake a DataTransfer, as the unit tests already do",
    shell: "no better. There is no WebDriver command to drop an OS file onto a window",
    residual: "a real folder from Finder, Explorer or Nautilus, across three webviews' webkitGetAsEntry. NEEDS A HUMAN",
  },
  {
    capability: "the Windows tray",
    where: "desktop/src-tauri/src/tray.rs",
    chrome: "no",
    shell: "no — outside the webview",
    residual: "all of it",
  },
  {
    capability: "window-state persistence",
    where: "desktop/src-tauri/src/main.rs:353",
    chrome: "no",
    shell: "yes: move, quit, relaunch, read the geometry back",
    residual: "multi-monitor",
  },
  {
    capability: "the Content-Security-Policy",
    where: "desktop/src-tauri/tauri.conf.json:28",
    chrome: "no, and it is a silent hole: Vite serves no CSP, so a resource the shipped app refuses loads fine here",
    shell: "yes, cheaply — log capture turns a violation into a failure",
    residual: null,
  },
  {
    capability: "platform detection",
    where: "desktop/src/platform.ts:28-38",
    chrome: "only by pretending (?platform=windows, dev builds only). Detection reads userAgentData then falls back to navigator.platform, and userAgentData is Chromium-only — so WKWebView and WebKitGTK take the fallback branch and Chrome never does",
    shell: "yes, genuinely, on three real webviews",
    residual: null,
  },
  {
    capability: "the titlebar mechanism",
    where: "desktop/src-tauri/tauri.conf.json:21, tauri.macos.conf.json:11-15",
    chrome: "no",
    shell: "yes, and it is a genuine per-OS fork: macOS runs a native overlay titlebar with real traffic lights, Windows and Linux run fully custom chrome. Two mechanisms, not one",
    residual: "whether it looks right is design reconciliation, not verification",
  },
  {
    capability: "the .dmg, .msi and .AppImage",
    where: "desktop/scripts/, .github/workflows/desktop.yml",
    chrome: "no",
    shell: "no — WebDriver drives a running app, not an installation",
    residual: "Gatekeeper, SmartScreen, and webviewInstallMode:downloadBootstrapper on a machine with no WebView2",
  },
];

/** True of the whole approach, whichever transport runs. */
export const STRUCTURAL = [
  "This transport can never be pointed at a production-shaped server. ft-server reaches AllowOrigin::any() only under --dev (crates/ft-server/src/lib.rs:631); otherwise only the three tauri:// origins pass CORS and every call from the driven page is refused. So nothing here says anything about the CORS posture a deployment actually ships.",
  "Chrome is one webview sample taken at the wrong end. Firetower ships on WKWebView (macOS), WebKitGTK 4.1 (Linux) and WebView2 (Windows). Chrome is nearest to Windows and furthest from macOS and Linux, which is where most development happens.",
  "A single-tenant database. Firetower is one organisation per database; there is no fresh-organisation-per-run, so nothing here exercises tenant separation.",
  "state:'Online' for a machine does not mean a session can run there. A host with no git and no tmux is Online with diagnosis:null. A run has to read GET /hosts/{id}/readiness and assert every required check is available.",
  "A worker built on macOS is darwin-only (justfile:138-139 passes no --target), so FIRETOWER_WORKER_ARTIFACTS never matches a Linux container machine and the install silently downloads a release instead. A run that does not assert which worker was installed may verify the released worker while believing it verified the branch.",
  "The shell transport is not this binary. Per firetower#338 it is a WebdriverIO run with a per-OS driver provider, invoked by CI on three platforms — official (tauri-driver) on Windows and Linux, embedded on macOS, which has no alternative. This CLI reads its evidence and says what it does not cover. It does not launch it, and a 'drive --target shell' is refused rather than faked.",
  "Whether a macOS CI runner can host a rendering WKWebView at all is unestablished, and it is the largest open risk in the shell route. If it fails, macOS gets no real-binary coverage.",
];

/**
 * Which changed paths are inside what a Chrome run can support a claim about.
 *
 * **This is an allowlist, and that is the whole point of it.** It used to be
 * twelve regular expressions with an open default, so every path that matched
 * none of them was declared provable — which made `desktop/src/api/download.ts`
 * (the only `bridge.save()` call site), `ui/Titlebar.tsx` (which imports the
 * denylisted `drag.ts`), a Rust crate and a SQL migration all read as safe. A
 * list of things that are forbidden, with everything else permitted, is the
 * exact shape `desktop/src/servers.ts:15-44` refuses: *not knowing that it is
 * forbidden is not permission.*
 *
 * So the default is closed and the reasoning runs the other way. A path is
 * inside only where that can be positively established:
 *
 *   1  outside `desktop/src/` is outside, full stop. Nothing else is loaded
 *      by the page this transport drives
 *   2  inside `desktop/src/`, walk the import graph. Reaching the native
 *      surface — `bridge.ts`, `open.ts`, `drag.ts`, `update.ts`,
 *      `telemetry.ts`, `platform.ts`, `ui/Resize.tsx`, `ui/drop.ts`,
 *      `skills.ts`, anything under `src-tauri/`, or `@tauri-apps/*` itself —
 *      at any distance is outside
 *   3  a graph that cannot be walked is outside. No checkout, a path that is
 *      not in it, a specifier that will not resolve: each is a thing that
 *      went wrong, not permission
 *   4  only a fully-read, native-free reachable set is inside
 *
 * Measured against firetower 0.55.0: 421 of 557 modules under `desktop/src/`
 * are inside, so this is a boundary rather than a wall — and the 136 that are
 * not include every file QA found the denylist calling safe.
 */
export function checkTouched(paths, checkout) {
  return paths.map((given) => {
    const seen = reachesNative(given, checkout);
    return {
      path: given,
      provable: !seen.outside,
      why: seen.why,
      how: seen.how,
      chain: seen.chain,
      ...(seen.modules ? { modules: seen.modules } : {}),
    };
  });
}

/** Everything nothing automated proves, flattened for the 'any' target. */
export function nothingProves() {
  return [...BRIDGE, ...PAST_BRIDGE]
    .filter((row) => row.residual)
    .map((row) => ({ capability: row.capability, residual: row.residual }));
}
