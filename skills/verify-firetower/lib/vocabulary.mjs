/**
 * The selector vocabulary and the sign-in sequence — COPIED, NOT IMPORTED.
 *
 * ---
 *
 * **Why this file is a copy, and what that costs.** firetower#335 decided
 * this bundle is self-contained: one directory, liftable into another
 * repository, with no dependency on the firetower checkout's `pnpm` tree and
 * no import from `desktop/scripts/`. The selectors and the sign-in sequence
 * still have to come from somewhere, and the somewhere is two files in that
 * checkout. So they are copied here, and **every entry carries the file and
 * line it came from**.
 *
 * That is a real cost of the decision rather than a tidy outcome: these
 * copies can drift from the app, and when they do, the thing that drifts is
 * the thing nobody is looking at. The attribution comments are what make the
 * drift traceable, and `control-firetower drive states --json` prints each
 * origin so a reviewer can diff them against the checkout in one pass. If
 * you are reading this because a selector stopped matching, the origin line
 * is where to look first, and updating the copy *and* the origin together is
 * the whole maintenance procedure.
 *
 * Sources, as of the commit this bundle was written against:
 *   desktop/scripts/states.mjs      — viewport, hash navigation, handles
 *   desktop/e2e/cursor-live.mjs     — the live sign-in sequence
 *   desktop/src/Routes.tsx          — which hash paths are real screens
 *
 * **What is deliberately NOT copied.** `states.mjs` seeds `localStorage`
 * with a fake server registry and posts to `POST /__reset?scene=`. Both are
 * mock-bound: `desktop/scripts/mock-server.mjs` says of itself that it is
 * "not a test double and not part of any build", and `__reset` has no
 * counterpart on a real `ft-server`. This bundle drives a real server, so it
 * signs in the way a person does.
 */

/**
 * The viewport every capture is taken at.
 *
 * COPIED FROM desktop/scripts/states.mjs:36
 *   `browser.newPage({ viewport: { width: 1280, height: 824 }, deviceScaleFactor: 2 })`
 * Kept identical so a capture from this bundle is comparable with one from
 * the design-reconciliation harness.
 */
export const VIEWPORT = { width: 1280, height: 824 };
export const SCALE = 2;

/**
 * The sign-in sequence, against a real server.
 *
 * COPIED FROM desktop/e2e/cursor-live.mjs:28-34, which is the closest thing
 * to this CLI that exists in the checkout — a "Live Cursor smoke test
 * against an isolated Firetower server and worker" whose header states "No
 * API route is mocked".
 *
 *   await page.getByPlaceholder("ft-e1.tail9c2b.ts.net").fill(server);
 *   await page.getByRole("button", { name: "Connect", exact: true }).click();   // STALE, see below
 *   await page.getByPlaceholder("Username").fill("admin");
 *   await page.getByPlaceholder("Password", { exact: true }).fill(password);
 *   await page.getByRole("button", { name: "Sign in" }).click();
 *
 * Typing an address into that placeholder is the production first-run
 * journey, not a test hook: the app's first screen is "type a control plane
 * address and Connect".
 *
 * **AND IT IS ALREADY STALE.** Running the copy is what established that:
 * the address step's button is now "Continue", not "Connect"
 * (Connect.tsx:224). The copy below is corrected and records what it was
 * corrected from. Do not "fix" it back by trusting the source file.
 *
 * TWO GATES THAT SCRIPT DOES NOT HANDLE, and this bundle has to. Pointed at
 * a genuinely virgin database, cursor-live.mjs clicks "Sign in" and then
 * immediately "Configuration", but `desktop/src/ui/Connect.tsx:398-402`
 * renders ReplacePassword while `mustChangePassword` is set, and
 * `desktop/src/ui/Gate.tsx:47` renders the setup wizard until setup is
 * complete. `control-firetower up` clears both over the API before anything
 * is driven (steps 4 and 6), and `drive` asserts neither is on screen rather
 * than assuming it.
 */
export const SIGNIN = {
  address: { how: "placeholder", handle: "ft-e1.tail9c2b.ts.net", from: "cursor-live.mjs:29" },
  /* DRIFT, FOUND BY RUNNING THIS: cursor-live.mjs:30 clicks a button named
     "Connect" and the app's address step now renders **Continue**
     (desktop/src/ui/Connect.tsx:224, after the commit "Say what the connect
     screen is asking for, and stop there"). So the in-repo live script is
     already stale on its second line, and copying it verbatim fails with a
     30s locator timeout. Measured 2026-11-17 against desktop @ 0adaa3f0.
     Carried here as the corrected handle, with the original recorded, which
     is the whole point of the attribution: a copy whose origin is written
     down can be diffed; one that is not drifts silently. */
  connect: { how: "role", role: "button", handle: "Continue", exact: true, from: "desktop/src/ui/Connect.tsx:224 — cursor-live.mjs:30 still says \"Connect\" and no longer matches" },
  username: { how: "placeholder", handle: "Username", from: "cursor-live.mjs:31" },
  password: { how: "placeholder", handle: "Password", exact: true, from: "cursor-live.mjs:32" },
  submit: { how: "role", role: "button", handle: "Sign in", from: "cursor-live.mjs:33" },
};

/** Screens that would mean the sign-in did not finish. Asserted absent. */
export const GATES = [
  { name: "the forced password change", handle: "Replace this password", from: "desktop/src/ui/ReplacePassword.tsx via Connect.tsx:398-402" },
  { name: "the setup wizard", handle: "Name this Firetower", from: "desktop/src/ui/Setup.tsx via Gate.tsx:47" },
];

/**
 * The states this build can be driven into.
 *
 * Hash paths, because the desktop app is behind a hash router
 * (`desktop/src/Routes.tsx:1-8`: "The screens, behind the hash router").
 * Navigation is COPIED FROM states.mjs:68-70:
 *   `page.goto(`${APP}/#${path}`, { waitUntil: "networkidle" })`
 *
 * `settle` is the pause after arrival, in ms, and the values come from the
 * same table: states.mjs uses 1100 by default, 1400 for the machines screen
 * and 1800 for a workspace.
 */
export const STATES = {
  home: { path: "/", settle: 1100, expect: "Firetower", from: "Routes.tsx:57 (the fallthrough)" },
  tasks: { path: "/tasks", settle: 1500, expect: "Tasks", from: "states.mjs:81 `at(page, \"/tasks\", 1500)`" },
  artifacts: { path: "/artifacts", settle: 1100, expect: "Artifacts", from: "Routes.tsx:36" },
  schedules: { path: "/schedules", settle: 1100, expect: "Schedules", from: "Routes.tsx:41" },
  configuration: { path: "/configuration", settle: 1400, expect: "Configuration", from: "Routes.tsx:45" },
  machines: { path: "/configuration/machines", settle: 1400, expect: "Machines", from: "states.mjs:115 `at(page, \"/configuration/machines\", 1400)`" },
  repositories: { path: "/configuration/repositories", settle: 1400, expect: "Repositories", from: "Configuration.tsx" },
  "git-hosts": { path: "/configuration/git-hosts", settle: 1400, expect: "Git hosts", from: "Configuration.tsx" },
  trackers: { path: "/configuration/trackers", settle: 1400, expect: "Trackers", from: "Configuration.tsx" },
  skills: { path: "/configuration/skills", settle: 1400, expect: "Skills", from: "Configuration.tsx" },
  agents: { path: "/configuration/agents", settle: 1400, expect: "Agents", from: "Configuration.tsx" },
  people: { path: "/configuration/people", settle: 1400, expect: "People", from: "Configuration.tsx" },
  teams: { path: "/configuration/teams", settle: 1400, expect: "Teams", from: "Configuration.tsx" },
  roles: { path: "/configuration/roles", settle: 1400, expect: "Roles", from: "Configuration.tsx" },
  directories: { path: "/configuration/directories", settle: 1400, expect: "Directories", from: "Configuration.tsx" },
  vault: { path: "/configuration/vault", settle: 1400, expect: "Vault", from: "Configuration.tsx" },
  server: { path: "/configuration/server", settle: 1400, expect: "Server", from: "Configuration.tsx" },
  account: { path: "/account", settle: 1100, expect: "Account", from: "Routes.tsx:47" },
  updates: { path: "/updates", settle: 1100, expect: "Updates", from: "Routes.tsx:46" },
};

/**
 * Gestures: a named action that leaves the app somewhere worth capturing.
 *
 * Each one is a sequence of handles, kept declarative so the vocabulary is
 * data a reviewer can read rather than code they have to follow. The
 * originals are the helpers in states.mjs — `probeMachine` (:113-121),
 * `fromTask` (:79-84), `inspectorTab` (:87-90) — and the comments there are
 * worth reading before adding one: "getByRole over the whole page would find
 * the first *Start* on it, which is a different task's".
 */
export const GESTURES = {
  "add-a-machine": {
    at: "machines",
    does: "open the Add a machine dialog and type an address into it",
    from: "states.mjs:113-121 probeMachine()",
    steps: [
      { click: { role: "button", name: "Add a machine" } },
      { pause: 500 },
      { fill: { placeholder: "192.0.2.10" }, with: "10.4.0.22" },
      { pause: 300 },
    ],
  },
  "add-a-repository": {
    at: "repositories",
    does: "open Add a repository and type a remote into it",
    from: "cursor-live.mjs:68-71",
    steps: [
      { click: { role: "button", name: "Add", exact: true } },
      { pause: 500 },
      { fill: { placeholder: "git@github.com:acme/web.git" }, with: "https://github.com/firetower-cloud/fstack.git" },
      { pause: 300 },
    ],
  },
  "name-a-workspace": {
    at: "home",
    does: "open New workspace and name it",
    from: "cursor-live.mjs:73-75",
    steps: [
      { click: { role: "button", name: "New workspace", exact: true } },
      { pause: 600 },
      { fill: { placeholder: "auth refactor" }, with: "verify-firetower smoke" },
      { pause: 300 },
    ],
  },
  "open-the-palette": {
    at: "home",
    does: "press the command palette open",
    from: "states.mjs over-any-screen__k-the-palette",
    steps: [{ press: "Meta+k" }, { pause: 600 }],
  },
};
