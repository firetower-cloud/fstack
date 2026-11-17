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
 * A handle: how to find one thing on screen. Role-based wherever possible,
 * because a role and an accessible name are what an assistive technology
 * reads, and matching on them means the capture and the assertion are about
 * the same thing a person perceives.
 */
const heading = (name, level = 1) => ({ how: "role", role: "heading", name, level });
const button = (name, exact = false) => ({ how: "role", role: "button", name, exact });
const box = (placeholder, exact = false) => ({ how: "placeholder", handle: placeholder, exact });

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

/**
 * Screens that would mean the sign-in did not finish. Asserted absent.
 *
 * Neither is reachable from a run `up` has prepared, which is every run — so
 * `drive audit` cannot re-check them and says so rather than passing them.
 * They were verified once, on 2026-11-17, by deliberately standing up an
 * unprepared instance: a fresh database, `ft-server --dev`, and **neither**
 * step 4 nor step 6 performed. Signing in with the password the first start
 * prints to stderr landed on `Replace this password`; clearing
 * `must_change_password` over the API and signing in again landed on
 * `Name this Firetower`. Both are level-1 headings.
 *
 * Worth noticing while you are here: the setup wizard's submit button is also
 * called **Continue** (`desktop/src/ui/Setup.tsx:46`), which is the same word
 * the address step uses and a different screen. Match the heading, not the
 * button.
 */
export const GATES = [
  {
    name: "the forced password change",
    landmark: heading("Replace this password"),
    from: "desktop/src/ui/ReplacePassword.tsx via Connect.tsx:398-402",
    verified: "2026-11-17, against an unprepared instance",
  },
  {
    name: "the setup wizard",
    landmark: heading("Name this Firetower"),
    from: "desktop/src/ui/Setup.tsx via Gate.tsx:47",
    verified: "2026-11-17, against an unprepared instance",
  },
];

/**
 * The states this build can be driven into.
 *
 * Hash paths, because the desktop app is behind a hash router
 * (`desktop/src/Routes.tsx:1-8`: "The screens, behind the hash router").
 * Navigation is COPIED FROM states.mjs:68-70:
 *   `page.goto(`${APP}/#${path}`, { waitUntil: "networkidle" })`
 *
 * `settle` is the pause after arrival, in ms, from the same table: 1100 by
 * default, 1400 for the machines screen, 1500 for tasks.
 *
 * **`landmark` is what makes each entry a claim rather than a hope**, and
 * every one below was established by driving this build rather than by
 * reading a harness — see this file's header for why that distinction is the
 * whole point. `control-firetower drive audit` re-asks all of them.
 *
 * The level-2 headings on `account` and `updates` are deliberate: their H1 is
 * the signed-in username and "Up to date." respectively, and both of those
 * change with the run rather than with the screen.
 */
export const STATES = {
  home: { path: "/", settle: 1100, landmark: heading("what should we work on?"), from: "Routes.tsx:57 (the fallthrough). The H1 is a greeting off the clock, so only its tail is matched", verified: "2026-11-17" },
  tasks: { path: "/tasks", settle: 1500, landmark: heading("Tasks"), from: "states.mjs:81 `at(page, \"/tasks\", 1500)`", verified: "2026-11-17" },
  artifacts: { path: "/artifacts", settle: 1100, landmark: heading("Artifacts"), from: "Routes.tsx:36", verified: "2026-11-17" },
  schedules: { path: "/schedules", settle: 1100, landmark: heading("Schedules"), from: "Routes.tsx:41", verified: "2026-11-17" },
  machines: { path: "/configuration/machines", settle: 1400, landmark: heading("Machines"), from: "states.mjs:115 `at(page, \"/configuration/machines\", 1400)`", verified: "2026-11-17" },
  repositories: { path: "/configuration/repositories", settle: 1400, landmark: heading("Repositories"), from: "destinations.ts:81", verified: "2026-11-17" },
  "git-hosts": { path: "/configuration/git-hosts", settle: 1400, landmark: heading("Git hosts"), from: "Configuration.tsx", verified: "2026-11-17" },
  trackers: { path: "/configuration/trackers", settle: 1400, landmark: heading("Trackers"), from: "Configuration.tsx", verified: "2026-11-17" },
  skills: { path: "/configuration/skills", settle: 1400, landmark: heading("Skills"), from: "destinations.ts:79 — this is where the rail's Customize goes", verified: "2026-11-17" },
  agents: { path: "/configuration/agents", settle: 1400, landmark: heading("Agents"), from: "Configuration.tsx", verified: "2026-11-17" },
  people: { path: "/configuration/people", settle: 1400, landmark: heading("People"), from: "Configuration.tsx", verified: "2026-11-17" },
  teams: { path: "/configuration/teams", settle: 1400, landmark: heading("Teams"), from: "Configuration.tsx", verified: "2026-11-17" },
  directories: { path: "/configuration/directories", settle: 1400, landmark: heading("Directories"), from: "Configuration.tsx", verified: "2026-11-17" },
  vault: { path: "/configuration/vault", settle: 1400, landmark: heading("Vault"), from: "Configuration.tsx", verified: "2026-11-17" },
  server: { path: "/configuration/server", settle: 1400, landmark: heading("This Firetower"), from: "Configuration.tsx. The heading is 'This Firetower', not 'Server'", verified: "2026-11-17" },
  account: { path: "/account", settle: 1100, landmark: heading("Password", 2), from: "Routes.tsx:47. The H1 is the signed-in username, which is per-run", verified: "2026-11-17" },
  updates: { path: "/updates", settle: 1100, landmark: heading("Past runs", 2), from: "Routes.tsx:46. The H1 is 'Up to date.' or not, depending on the answer", verified: "2026-11-17" },
};

/**
 * Routes that exist in the source and are not the screen their name suggests.
 *
 * `states.mjs:11-13` states the doctrine and it is right: "A state this build
 * cannot reach is the finding… because a reconciliation whose gaps are
 * invisible is a reconciliation of the states that happened to work." So
 * these are recorded rather than quietly aliased to whatever they land on —
 * an entry that claimed `/configuration/roles` was the roles screen would
 * have a run verifying Agent profiles and reporting it as Roles.
 */
export const NOT_WHAT_THEY_SAY = [
  { path: "/configuration/roles", lands: "Agent profiles", found: "2026-11-17", note: "the route is in the source (grep finds it in desktop/src) but this build renders Agent profiles there" },
  { path: "/configuration", lands: "Repositories", found: "2026-11-17", note: "bare /configuration is not a screen of its own; it falls through to Repositories" },
];

/**
 * Gestures: a named action that leaves the app somewhere worth capturing.
 *
 * `then` is the post-condition, and it is the half that matters: a gesture
 * whose steps all "succeed" while the app does nothing is the failure mode
 * that makes a passing run misleading. `drive audit` performs each gesture
 * and asserts its `then`.
 *
 * Two gestures that were copied from `cursor-live.mjs` are **gone**, because
 * driving them proved they describe a UI that no longer exists:
 *
 *   `add-a-repository` (cursor-live.mjs:68-71) clicks an `Add` button on the
 *   repositories screen. With no git host connected that screen's only action
 *   is `Connect a provider`, which is what `connect-a-git-host` below does.
 *
 *   `name-a-workspace` (cursor-live.mjs:73-75) expects `New workspace` to
 *   open a dialog with an `auth refactor` placeholder. The button exists —
 *   named `New workspace ⌘N`, so an `exact: true` match already fails — and
 *   pressing it opens nothing: the composer on the home *is* the new
 *   workspace. `start-something-new` below is that journey.
 */
export const GESTURES = {
  "add-a-machine": {
    at: "machines",
    does: "open the Add a machine dialog and type an address into it",
    from: "states.mjs:113-121 probeMachine()",
    verified: "2026-11-17",
    steps: [
      { click: button("Add a machine") },
      { pause: 500 },
      { fill: box("192.0.2.10"), with: "10.4.0.22" },
      { pause: 300 },
    ],
    /* `Add it` is deliberately not pressed: it probes the address over ssh,
       and 10.4.0.22 is somebody's network rather than ours. states.mjs
       presses it because the mock server answers. */
    then: button("Add it"),
  },
  "start-something-new": {
    at: "home",
    does: "type into the composer on the home, which is where a workspace starts",
    from: "driven 2026-11-17; replaces cursor-live.mjs:73-75, which describes a dialog this build does not have",
    verified: "2026-11-17",
    steps: [
      { fill: box("Start something new…"), with: "verify-firetower smoke" },
      { pause: 400 },
    ],
    /* With an empty fleet the start button is present and disabled, and says
       so — which is a better post-condition than a happy path, because it is
       the state a fresh verification run is actually in. */
    then: button("Add a machine first"),
  },
  "connect-a-git-host": {
    at: "repositories",
    does: "follow the empty repositories screen to where a provider is connected",
    from: "driven 2026-11-17; replaces cursor-live.mjs:68-71",
    verified: "2026-11-17",
    steps: [{ click: button("Connect a provider") }, { pause: 900 }],
    then: heading("Git hosts"),
  },
  "open-the-palette": {
    at: "home",
    does: "press the command palette open",
    from: "states.mjs over-any-screen__k-the-palette",
    verified: "2026-11-17",
    steps: [{ press: "Meta+k" }, { pause: 700 }],
    then: box("Go to a session, or run something"),
  },
};
