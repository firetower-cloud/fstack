/**
 * Every `file:line` this bundle cites, and what the cited line has to say.
 *
 * ---
 *
 * **Why this exists.** `drive audit` re-drives every *handle* against the
 * running application, so a selector that stops matching is caught on the
 * next run. Nothing re-read the bundle's *citations* — the hundred-odd
 * `file:line` references in its prose and its comments that are the whole
 * evidence for why a handle is what it is, why a rule exists, and what this
 * transport cannot prove.
 *
 * That gap shipped a false claim. The map's one rule was justified by saying
 * that `desktop/e2e/cursor-live.mjs` "still clicks `Connect`" and that the
 * checkout's two harnesses "disagree with each other". The `Connect` →
 * `Continue` fix had landed upstream **five hours before this bundle was
 * committed**: the file contained no `"Connect"` at all, the five sign-in
 * handles cited import statements, and `drive audit` printed the false
 * sentence on every single run. A reviewer who checked would have found it in
 * a minute. Nobody checked, because nothing made them.
 *
 * So: a citation is a claim, and a claim that nothing re-reads is a claim
 * that rots. This module re-reads all of them.
 *
 * **What it checks, per citation.**
 *
 *   1. the file resolves to exactly one path in the checkout
 *   2. the cited line or range exists in it
 *   3. where the citation quotes something, that string is still there
 *
 * **And what it checks about the bundle as a whole**: that every `file:line`
 * appearing anywhere in the shipped prose or code is registered here.
 * Without that, the next uncited claim is invisible again — the ledger would
 * only be as good as whoever remembered to add to it. `test/citations.test.mjs`
 * fails on an unregistered citation and names the file and line that has to
 * be added, which is the one maintenance step this carries.
 *
 * `expect` is:
 *   a string     the cited range must contain it
 *   an array     the cited range must contain every one of them
 *   null         the citation points at a location and quotes nothing. The
 *                file and the line still have to exist
 *
 * Keep `expect` to the part of the line that carries the claim — a literal, a
 * name, a declaration. Quoting a whole line of formatting makes the test fail
 * on a reflow, which trains people to delete it.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Bare `:NNN` that are ports rather than lines.
 *
 * The three forbidden addresses come up constantly in this bundle's prose —
 * "the second address could be :4400" — and a port is not a citation. They
 * are listed rather than guessed at, because the alternative is a heuristic
 * about number size that would quietly skip a real citation.
 */
export const PORTS_NOT_LINES = new Set([4400, 5433, 5273, 5464]);

/** The files whose citations are checked: everything this bundle ships. */
export function shippedFiles(skill) {
  return [
    "SKILL.md",
    "control-firetower",
    ...readdirSync(path.join(skill, "lib")).filter((f) => f.endsWith(".mjs")).map((f) => `lib/${f}`),
    ...readdirSync(path.join(skill, "references", "features")).filter((f) => f.endsWith(".md")).map((f) => `references/features/${f}`),
  ];
}

export const CITATIONS = [
  /* ── The first-run screens, which the three journeys drive ───────────── */
  { cite: "desktop/src/ui/Connect.tsx:204", expect: "Where is your Firetower?", claim: "the address screen's heading" },
  { cite: "desktop/src/ui/Connect.tsx:214", expect: 'placeholder="ft-e1.tail9c2b.ts.net"', claim: "the address field" },
  { cite: "desktop/src/ui/Connect.tsx:224", expect: "Continue", claim: "the address screen's button — read as Connect, driven as Continue" },
  { cite: "desktop/src/ui/Connect.tsx:162", expect: 'stage.at === "who"', claim: "the screen the address step lands on" },
  { cite: "desktop/src/ui/Connect.tsx:434", expect: "Who are you here?", claim: "the sign-in screen's heading" },
  { cite: "desktop/src/ui/Connect.tsx:453", expect: 'placeholder="Username"', claim: "the username field" },
  { cite: "desktop/src/ui/Connect.tsx:466", expect: 'placeholder="Password"', claim: "the password field" },
  { cite: "desktop/src/ui/Connect.tsx:481", expect: "Sign in", claim: "the sign-in button" },
  {
    cite: "desktop/src/ui/Connect.tsx:151-159",
    expect: ["ReplacePassword", 'retryLabel="Sign in again"', 'backLabel="Use a different address"'],
    claim: "the locked stage renders ReplacePassword with those two labels",
  },
  { cite: "desktop/src/ui/Connect.tsx:398-402", expect: "mustChangePassword", claim: "signing in answers mustChangePassword and the locked stage follows" },
  { cite: "desktop/src/ui/Connect.tsx:169-177", expect: ["remember(", "serverId"], claim: "a successful sign-in remembers the server" },
  { cite: "desktop/src/ui/ReplacePassword.tsx:1-10", expect: "Replacing a password happens once", claim: "why the desktop carries no password form" },
  { cite: "desktop/src/ui/Gate.tsx:46", expect: "<Setup", claim: "the setup wizard stands until setup is complete" },
  { cite: "desktop/src/ui/Setup.tsx:40", expect: "Name this Firetower", claim: "the wizard's heading" },
  { cite: "desktop/src/ui/Setup.tsx:43", expect: 'placeholder="Westlabs"', claim: "the organisation field" },
  { cite: "desktop/src/ui/Setup.tsx:46", expect: "Continue", claim: "the wizard's button — the same word as the address screen, a different screen" },
  { cite: "desktop/src/ui/Setup.tsx:56", expect: "is set up", claim: "the screen after naming" },
  { cite: "desktop/src/ui/Setup.tsx:71", expect: "Open Firetower", claim: "the button that finishes setup" },

  /* ── The router, and the screens the states name ─────────────────────── */
  { cite: "desktop/src/Routes.tsx:1-8", expect: "The screens, behind the hash router", claim: "the app is behind a hash router" },
  { cite: "desktop/src/Routes.tsx:32", expect: '"/tasks"', claim: "the tasks route" },
  { cite: "desktop/src/Routes.tsx:36", expect: '"/artifacts"', claim: "the artifacts route" },
  { cite: "desktop/src/Routes.tsx:40", expect: '"/schedules"', claim: "the schedules route" },
  { cite: "desktop/src/Routes.tsx:45", expect: '"/updates"', claim: "the updates route" },
  { cite: "desktop/src/Routes.tsx:46", expect: '"/account"', claim: "the account route" },
  { cite: "desktop/src/Routes.tsx:54", expect: "<Home", claim: "the fallthrough, which is the home" },
  { cite: "desktop/src/ui/destinations.ts:79", expect: ['label: "Customize"', "/configuration/skills"], claim: "where the rail's Customize goes" },
  { cite: "desktop/src/ui/destinations.ts:81", expect: ['label: "Repositories"', "/configuration/repositories"], claim: "the repositories destination" },
  { cite: "desktop/src/ui/config/panes.ts:50", expect: 'label: "Profiles"', claim: "the configuration index's word for the profiles pane" },
  {
    cite: "desktop/src/ui/RailPanel.tsx:497",
    expect: 'label="Agent profiles"',
    claim: "the rail panel's row is Agent profiles, not Profiles — which the map got the wrong way round",
  },

  /* ── The screens the feature map drives ──────────────────────────────── */
  { cite: "desktop/src/ui/config/Roles.tsx:261", expect: 'label="New profile"', claim: "the button that opens the create menu" },
  { cite: "desktop/src/ui/config/Roles.tsx:283", expect: 'title="Agent profiles"', claim: "the screen's own heading at /configuration/roles" },
  { cite: "desktop/src/ui/config/Roles.tsx:995", expect: "New profile", claim: "the draft's heading" },
  { cite: "desktop/src/ui/config/CreateMenu.tsx:43-48", expect: 'role="menu"', claim: "what New profile opens" },
  {
    cite: "desktop/src/ui/TasksPage.tsx:304-315",
    expect: ["No tracker connected", "Connect your task tracker", "/configuration/trackers"],
    claim: "the empty tasks screen and where its button goes",
  },
  { cite: "desktop/src/ui/config/Repos.tsx:71", expect: 'const PASTE = "paste"', claim: "the picker's paste-a-remote choice" },
  { cite: "desktop/src/ui/config/Repos.tsx:137-141", expect: "Pick a git host to start from", claim: "the onboarding copy a dead server used to draw" },
  { cite: "desktop/src/ui/config/Repos.tsx:143-149", expect: "const bare", claim: "when the repositories screen counts as bare" },
  { cite: "desktop/src/ui/config/Repos.tsx:520-531", expect: ["Paste a remote", "All hosts"], claim: "the host picker" },
  { cite: "desktop/src/ui/config/Repos.tsx:575-588", expect: "Paste a remote", claim: "the Paste a remote row" },
  { cite: "desktop/src/ui/config/Repos.tsx:821", expect: 'placeholder="git@github.com:acme/web.git"', claim: "the remote field" },
  { cite: "desktop/src/ui/config/Repos.tsx:795-860", expect: "function Paste(", claim: "the paste-a-remote form" },
  { cite: "desktop/src/ui/config/Repos.tsx:849", expect: ["Add it", "Save it anyway"], claim: "the button, which is Add it only once a machine has answered" },
  { cite: "desktop/src/ui/config/Machines.tsx:636-640", expect: "WorkerMissing", claim: "the probe's answer decides what the dialog offers" },
  { cite: "desktop/src/ui/Configuration.tsx:98-110", expect: "from this Mac?", claim: "the disconnect confirmation" },
  { cite: "desktop/src/ui/Configuration.tsx:103-110", expect: "from this Mac?", claim: "the disconnect confirmation's question" },
  { cite: "desktop/src/ui/Confirm.tsx:81-83", expect: ['role="dialog"', "{q.title}"], claim: "the dialog's heading is its title" },

  /* ── The checkout's own harnesses, where this bundle still points at
       them. Line-pinned citations into these two were the whole of D2; what
       is left is the doctrine comment and the handles that were re-driven
       and found correct. ──────────────────────────────────────────────── */
  { cite: "desktop/scripts/states.mjs:11-13", expect: "A state this build cannot reach is the finding", claim: "the doctrine this bundle follows" },
  { cite: "desktop/scripts/states.mjs:35", expect: ["viewport", "deviceScaleFactor"], claim: "the viewport every capture is taken at" },
  { cite: "desktop/scripts/states.mjs:72", expect: "const at = (page, path", claim: "hash navigation" },
  { cite: "desktop/scripts/states.mjs:85", expect: 'at(page, "/tasks", 1500)', claim: "the settle for the tasks screen" },
  { cite: "desktop/scripts/states.mjs:111", expect: '"/configuration/machines", 1400', claim: "the settle for the machines screen" },
  { cite: "desktop/scripts/states.mjs:110-117", expect: ["probeMachine", 'getByPlaceholder("192.0.2.10")'], claim: "the add-a-machine dialog's handles" },
  { cite: "desktop/scripts/states.mjs:484", expect: "/^Connect$/", claim: "the git-hosts screen's Connect, which is current and correct" },

  /* ── The control plane ───────────────────────────────────────────────── */
  { cite: "crates/ft-server/src/api.rs:194-196", expect: "server_id", claim: "/bootstrap has no serverId until setup finishes" },
  { cite: "crates/ft-server/src/api/setup.rs:26-30", expect: "needs_password", claim: "the server's own word for the password gate" },
  { cite: "crates/ft-server/src/accounts.rs:47", expect: "MINIMUM_PASSWORD", claim: "the shortest password the server accepts" },
  { cite: "crates/ft-server/src/accounts.rs:117-128", expect: "named_at", claim: "being named is what set up means" },
  { cite: "crates/ft-server/src/accounts.rs:193-201", expect: "must_change_password", claim: "the first administrator is created with the flag set" },
  { cite: "crates/ft-server/src/accounts.rs:743-775", expect: ["set_password", "must_change_password = FALSE"], claim: "passwd clears the flag in the same statement" },
  { cite: "crates/ft-server/src/lib.rs:383-391", expect: ["ensure_admin", "any_user"], claim: "ADMIN_INITIAL_PASSWORD is read only while no user exists" },
  { cite: "crates/ft-server/src/lib.rs:383-427", expect: "ensure_admin", claim: "how the seeded administrator is made" },
  { cite: "crates/ft-server/src/lib.rs:402-426", expect: "MINIMUM_PASSWORD", claim: "a short seeded password warns rather than refusing" },
  { cite: "crates/ft-server/src/lib.rs:631", expect: "fn cors", claim: "--dev is the only branch that reaches AllowOrigin::any()" },
  { cite: "crates/ft-server/src/api/auth.rs:195", expect: "restart", claim: "tokens do not survive a restart" },
  { cite: "crates/ft-server/src/api/repos.rs:634-647", expect: "no_machine", claim: "the remote probe is answered by a machine, not the control plane" },
  { cite: "crates/ft-worker/src/lib.rs:941", expect: "remove_dir_all", claim: "the workspace is deleted when the session ends" },
  { cite: "crates/ft-worker/src/docker.rs:206", expect: "SESSION_LABEL", claim: "Firetower's own teardown sweeps by the session label" },
  { cite: "compose.yaml:71-72", expect: "refuses to bind", claim: "why the compose file sets what it sets" },

  /* ── The native surface, which is what `limits` is about ─────────────── */
  { cite: "desktop/src/servers.ts:15-44", expect: "Not knowing that it is forbidden is not permission", claim: "the rule this bundle's ownership model is taken from" },
  { cite: "desktop/src/bridge.ts:49", expect: "native: boolean", claim: "the bridge member a browser answers false for" },
  { cite: "desktop/src/bridge.ts:50", expect: "setTitle", claim: "a bridge member that differs by running anyway" },
  { cite: "desktop/src/bridge.ts:51-52", expect: "setBadge", claim: "the dock badge" },
  { cite: "desktop/src/bridge.ts:53", expect: "notify", claim: "OS notifications" },
  { cite: "desktop/src/bridge.ts:54", expect: "minimize", claim: "window controls" },
  { cite: "desktop/src/bridge.ts:55", expect: "zoom", claim: "window controls" },
  { cite: "desktop/src/bridge.ts:56", expect: "close()", claim: "window controls" },
  { cite: "desktop/src/bridge.ts:62-65", expect: "not* the same gesture dressed differently", claim: "the file's own warning about save" },
  { cite: "desktop/src/bridge.ts:67-72", expect: "save(", claim: "the save signature" },
  { cite: "desktop/src/bridge.ts:81", expect: "shoot", claim: "screenshots" },
  { cite: "desktop/src/bridge.ts:93", expect: "canShoot", claim: "whether screenshots are available" },
  { cite: "desktop/src/bridge.ts:103", expect: "loadArtifact", claim: "the mixed-content path a browser never takes" },
  { cite: "desktop/src/bridge.ts:104-105", expect: "secrets", claim: "the keychain" },
  { cite: "desktop/src/bridge.ts:164", expect: "native: false", claim: "the browser implementation says so by construction" },
  { cite: "desktop/src/bridge.ts:165", expect: "document.title", claim: "setTitle in a browser sets document.title, a different thing" },
  { cite: "desktop/src/bridge.ts:166", expect: "setBadge: () => {}", claim: "setBadge is a no-op in a browser" },
  { cite: "desktop/src/bridge.ts:167", expect: "notify: () => {}", claim: "notify is a no-op in a browser" },
  { cite: "desktop/src/bridge.ts:175-194", expect: ["createObjectURL", "a.download"], claim: "the browser save branch: fetch, a blob and an a download" },
  { cite: "desktop/src/bridge.ts:195", expect: "shoot: async () => null", claim: "shoot answers null in a browser" },
  { cite: "desktop/src/bridge.ts:196", expect: "canShoot: async () => false", claim: "canShoot answers false in a browser" },
  { cite: "desktop/src/bridge.ts:197", expect: "loadArtifact: null", claim: "loadArtifact is null in a browser, so the mixed-content refusal never happens" },
  { cite: "desktop/src/bridge.ts:198", expect: "secrets: null", claim: "no keychain in a browser" },
  { cite: "desktop/src/open.ts:11-19", expect: "openExternal", claim: "a module that imports @tauri-apps past the bridge" },
  { cite: "desktop/src/open.ts:18", expect: "window.open(", claim: "the browser falls back to window.open" },
  { cite: "desktop/src/drag.ts:1-26", expect: "app-region", claim: "why titlebar drag is not drivable" },
  { cite: "desktop/src/drag.ts:33-38", expect: "mouseup", claim: "the webview usually never sees the mouseup" },
  { cite: "desktop/src/drag.ts:60-91", expect: "tauriWindow", claim: "the drag implementation" },
  { cite: "desktop/src/update.ts:80-146", expect: "plugin-updater", claim: "the updater" },
  { cite: "desktop/src/telemetry.ts:92", expect: "@tauri-apps/api/app", claim: "the app version comes from a native import" },
  { cite: "desktop/src/platform.ts:28-38", expect: "function detect()", claim: "platform detection" },
  { cite: "desktop/src/skills.ts:168-181", expect: "readDrop", claim: "the HTML5 file-drop path" },
  { cite: "desktop/src/ui/Titlebar.tsx:29", expect: '"~/drag"', claim: "nothing in the name says native, and line 29 imports drag" },
  { cite: "desktop/src-tauri/src/capture.rs:277", expect: "SUPPORTED: bool = true", claim: "canShoot's macOS value" },
  { cite: "desktop/src-tauri/src/capture.rs:375", expect: "SUPPORTED: bool = true", claim: "canShoot's Windows value" },
  { cite: "desktop/src-tauri/src/capture.rs:501-503", expect: "SUPPORTED: bool = false", claim: "canShoot's value everywhere else" },
  { cite: "desktop/src-tauri/src/main.rs:48", expect: "tray::waiting", claim: "the tray is reached" },
  { cite: "desktop/src-tauri/src/main.rs:353", expect: "window_state", claim: "window state and its persistence" },
  { cite: "desktop/src-tauri/src/main.rs:411-414", expect: "Windows", claim: "the keychain on Windows has never been measured" },
  { cite: "desktop/src-tauri/tauri.conf.json:21", expect: '"decorations": false', claim: "custom chrome" },
  { cite: "desktop/src-tauri/tauri.conf.json:28", expect: '"csp"', claim: "the CSP that only a real binary applies" },
  { cite: "desktop/src-tauri/tauri.macos.conf.json:11-15", expect: '"dragDropEnabled": false', claim: "Tauri's own drag-drop handler is off" },

  /* ── The build, and the ports nothing may derive ─────────────────────── */
  { cite: "desktop/vite.config.ts:15", expect: ["5273", "strictPort"], claim: "the renderer port is hardcoded, so --port is a flag only" },
  { cite: "desktop/vite.config.ts:17", expect: "alias", claim: "how ~ resolves, which the import walk has to follow" },
  { cite: "desktop/tsconfig.json:15", expect: '"paths"', claim: "the other half of how ~ resolves" },
  { cite: "web/playwright.config.ts:13", expect: "reuseExistingServer", claim: "the failure this bundle refuses to repeat, one line long" },
];

/** Index by basename and line span, which is how prose spells a citation. */
const key = (file, a, b) => `${path.basename(file)}:${a}${b && b !== a ? `-${b}` : ""}`;

export function ledgerIndex() {
  const index = new Map();
  for (const entry of CITATIONS) {
    const [file, lines] = split(entry.cite);
    const [a, b] = span(lines);
    index.set(key(file, a, b), entry);
  }
  return index;
}

function split(cite) {
  const at = cite.lastIndexOf(":");
  return [cite.slice(0, at), cite.slice(at + 1)];
}

function span(lines) {
  const [a, b] = lines.split("-");
  return [Number(a), b ? Number(b) : Number(a)];
}

/**
 * Every file in the checkout, indexed by basename.
 *
 * `target/` and `node_modules/` are skipped: a build directory holds copies
 * that would make half these citations ambiguous.
 */
export function indexCheckout(checkout) {
  const byName = new Map();
  const skip = new Set(["node_modules", ".git", "target", "dist", "build", ".next"]);
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(checkout, full);
        if (!byName.has(entry.name)) byName.set(entry.name, []);
        byName.get(entry.name).push(rel);
      }
    }
  })(checkout);
  return byName;
}

/**
 * Re-read every citation in the ledger against a checkout.
 *
 * Returns `{ checked, findings }`. A finding is one of:
 *   unresolved   the file is not in the checkout, or more than one matches
 *   past-eof     the cited line is beyond the end of the file
 *   missing      the cited range no longer contains what is claimed
 */
export function checkCitations(checkout, { index } = {}) {
  const byName = index ?? indexCheckout(checkout);
  const findings = [];
  const cache = new Map();
  let checked = 0;

  for (const entry of CITATIONS) {
    const [file, lines] = split(entry.cite);
    const [a, b] = span(lines);
    const candidates = (byName.get(path.basename(file)) ?? []).filter(
      (p) => p === file || p.endsWith(`/${file}`) || path.basename(p) === file,
    );
    const exact = candidates.filter((p) => p === file);
    const resolved = exact.length ? exact : candidates;
    if (resolved.length !== 1) {
      findings.push({
        kind: "unresolved",
        cite: entry.cite,
        claim: entry.claim,
        why: resolved.length === 0
          ? `no file at ${file} in the checkout`
          : `${resolved.length} files match ${file}: ${resolved.slice(0, 4).join(", ")}`,
      });
      continue;
    }
    const at = resolved[0];
    if (!cache.has(at)) cache.set(at, readFileSync(path.join(checkout, at), "utf8").split("\n"));
    const all = cache.get(at);
    if (a > all.length) {
      findings.push({
        kind: "past-eof",
        cite: entry.cite,
        claim: entry.claim,
        why: `${at} has ${all.length} lines, and line ${a} is cited`,
      });
      continue;
    }
    checked++;
    if (entry.expect === null) continue;
    const text = all.slice(a - 1, Math.min(b, all.length)).join("\n");
    for (const want of [entry.expect].flat()) {
      if (!text.includes(want)) {
        findings.push({
          kind: "missing",
          cite: entry.cite,
          claim: entry.claim,
          want,
          why: `${at}:${lines} no longer contains ${JSON.stringify(want)}`,
          saw: all[a - 1]?.trim().slice(0, 120) ?? "",
        });
      }
    }
  }
  return { checked, findings };
}

/**
 * Find every citation written in the bundle's own prose and code.
 *
 * Two shapes, because the bundle writes both:
 *
 *   `desktop/src/ui/Connect.tsx:224`   a file and a line
 *   `..., :214 (field), :224 (button)` a continuation, belonging to the last
 *                                      file cited before it
 *
 * The continuation form is how both the vocabulary's `from` strings and
 * `limits`' tables are written — `where: "desktop/src/bridge.ts:50"` on one
 * line and `chrome: "... (:165)"` two lines below it — so the anchor is the
 * most recent file citation within `WINDOW` lines, which is the same thing a
 * reader does. A continuation with nothing to anchor to is reported as
 * `unanchored`: a reader cannot resolve it either, so it is a defect in the
 * prose rather than something to guess at.
 *
 * `lib/citations.mjs` is not swept. It is the ledger: every `file:line` in it
 * is by definition registered, and its own prose quotes the citation form to
 * explain it.
 */
const FILE_CITE = /([A-Za-z0-9_./-]+\.(?:tsx|ts|mjs|rs|json|yml|yaml|toml)):(\d+)(?:-(\d+))?/g;
/**
 * A continuation.
 *
 * The character in front has to be a space, an opening bracket, a comma or a
 * backtick. That is what excludes the addresses this bundle is full of —
 * `::1`, `editor@<host>:22`, `...${port}:5432` — which are not lines and
 * whose numbers would otherwise be looked up in a source file.
 */
const BARE_CITE = /(^|[\s(,[`]):(\d+)(?:-(\d+))?/g;
/**
 * A path with no line on it, which can still anchor a continuation.
 *
 * `["desktop/src/skills.ts", "... the file-drop path (:168-181) ..."]` names
 * its file without citing a line in it, and the `(:168-181)` beside it is
 * still a citation into that file.
 */
const PATH_ONLY = /([A-Za-z0-9_./-]+\.(?:tsx|ts|mjs|rs|json|yml|yaml|toml))/g;
const WINDOW = 8;

export function discover(skill) {
  const found = [];
  for (const file of shippedFiles(skill)) {
    if (file === "lib/citations.mjs") continue;
    const text = readFileSync(path.join(skill, file), "utf8");
    const lines = text.split("\n");
    /* The last file cited, and how far back it was. */
    let anchor = null;
    lines.forEach((line, i) => {
      const anchors = [...line.matchAll(FILE_CITE)];
      for (const m of anchors) {
        found.push({
          in: file,
          at: i + 1,
          spelling: `${m[1]}:${m[2]}${m[3] ? `-${m[3]}` : ""}`,
          key: key(m[1], Number(m[2]), m[3] ? Number(m[3]) : Number(m[2])),
        });
      }
      for (const m of line.matchAll(BARE_CITE)) {
        const a = Number(m[2]);
        if (PORTS_NOT_LINES.has(a)) continue;
        /* Already counted as part of a file citation on this line. */
        const index = m.index + m[1].length;
        if (anchors.some((f) => index >= f.index && index < f.index + f[0].length)) continue;
        const onThisLine = anchors.filter((f) => f.index < index).pop();
        const named = [...line.matchAll(PATH_ONLY)].filter((p) => p.index < index).pop();
        const to = onThisLine
          ? onThisLine[1]
          : named
            ? named[1]
            : anchor && i - anchor.line <= WINDOW
              ? anchor.file
              : null;
        if (!to) {
          found.push({ in: file, at: i + 1, spelling: m[0].trim(), key: null, unanchored: true });
          continue;
        }
        found.push({
          in: file,
          at: i + 1,
          spelling: `${to}:${a}${m[3] ? `-${m[3]}` : ""}`,
          key: key(to, a, m[3] ? Number(m[3]) : a),
        });
      }
      if (anchors.length) anchor = { file: anchors[anchors.length - 1][1], line: i };
    });
  }
  return found;
}
