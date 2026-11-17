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
 * **The measurement behind the one rule.**
 *
 * The first version of this vocabulary was assembled the way anybody would
 * assemble one: by reading the repository. Two harnesses — `states.mjs` and
 * `cursor-live.mjs` — for the gestures and the sign-in sequence, and the
 * components themselves for the screens. 28 handles, every one of them
 * sourced from a file, none of them driven.
 *
 * Then they were driven, and **6 of the 28 were wrong**. Not stale by a
 * release: wrong about the application that was running at the moment they
 * were read out of it. That is the whole argument for "driven, not read",
 * and it is why this file exists as a verified copy rather than as an import.
 *
 * **This is a record of a measurement, not a claim about another repository.**
 * It says what reading produced on 2026-11-17 and what driving then found. No
 * merge in firetower can make it false, because it is not about firetower's
 * present state — which is exactly the property the previous version of this
 * argument lacked. That version argued from what the checkout's two harnesses
 * were doing at the time of writing, including a sentence about one of them
 * that had been fixed upstream five hours earlier. The bundle then printed it
 * on every `drive audit`. `lib/citations.mjs` has the full account, and
 * `test/citations.test.mjs` is the other half of the fix: it re-reads every
 * `file:line` this bundle cites and fails when the cited line no longer says
 * what is claimed.
 *
 * `verdict` is one of:
 *   stood    driving it confirmed what reading it had suggested
 *   wrong    the application did not agree, and the entry is corrected or gone
 */
export const INHERITED = {
  measured: "2026-11-17, against 0.55.0",
  entries: [
    /* The sign-in sequence, read out of `cursor-live.mjs` as it stood then. Four of the five stood; the button did not. */
    { handle: "signin.address", read: "desktop/e2e/cursor-live.mjs", verdict: "stood" },
    {
      handle: "signin.connect",
      read: "desktop/e2e/cursor-live.mjs",
      verdict: "wrong",
      note: 'read as a button named "Connect"; the address screen renders "Continue"',
    },
    { handle: "signin.username", read: "desktop/e2e/cursor-live.mjs", verdict: "stood" },
    { handle: "signin.password", read: "desktop/e2e/cursor-live.mjs", verdict: "stood" },
    { handle: "signin.submit", read: "desktop/e2e/cursor-live.mjs", verdict: "stood" },

    /* The screens, read out of the router and the configuration index. */
    { handle: "state.home", read: "desktop/src/Routes.tsx", verdict: "stood" },
    { handle: "state.tasks", read: "desktop/scripts/states.mjs", verdict: "stood" },
    { handle: "state.artifacts", read: "desktop/src/Routes.tsx", verdict: "stood" },
    { handle: "state.schedules", read: "desktop/src/Routes.tsx", verdict: "stood" },
    {
      handle: "state.configuration",
      read: "desktop/src/Routes.tsx",
      verdict: "wrong",
      note: "read as a screen of its own; bare /configuration falls through to Repositories, so it is recorded in NOT_WHAT_THEY_SAY instead",
    },
    { handle: "state.machines", read: "desktop/scripts/states.mjs", verdict: "stood" },
    { handle: "state.repositories", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.git-hosts", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.trackers", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.skills", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.agents", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.people", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.teams", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    {
      handle: "state.roles",
      read: "desktop/src/ui/Configuration.tsx",
      verdict: "wrong",
      note: 'read as a screen called "Roles"; /configuration/roles renders the heading "Agent profiles", so it is driven as `profiles` and recorded in NOT_WHAT_THEY_SAY',
    },
    { handle: "state.directories", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    { handle: "state.vault", read: "desktop/src/ui/Configuration.tsx", verdict: "stood" },
    {
      handle: "state.server",
      read: "desktop/src/ui/Configuration.tsx",
      verdict: "wrong",
      note: 'read as a screen called "Server"; the heading is "This Firetower"',
    },
    { handle: "state.account", read: "desktop/src/Routes.tsx", verdict: "stood" },
    { handle: "state.updates", read: "desktop/src/Routes.tsx", verdict: "stood" },

    /* The gestures. Two of the four described a UI that was not there. */
    { handle: "gesture.add-a-machine", read: "desktop/scripts/states.mjs", verdict: "stood" },
    {
      handle: "gesture.add-a-repository",
      read: "desktop/e2e/cursor-live.mjs",
      verdict: "wrong",
      note: 'read as an "Add" button on the repositories screen; with no git host connected that screen\'s only action is "Connect a provider", so the gesture is gone and `connect-a-git-host` is the journey that exists',
    },
    {
      handle: "gesture.name-a-workspace",
      read: "desktop/e2e/cursor-live.mjs",
      verdict: "wrong",
      note: 'read as "New workspace" opening a dialog with an "auth refactor" placeholder; the button is named "New workspace ⌘N" so an exact match already failed, and pressing it opens nothing because the composer on the home IS the new workspace. `start-something-new` is that journey',
    },
    { handle: "gesture.open-the-palette", read: "desktop/scripts/states.mjs", verdict: "stood" },
  ],
};

/** The counts the one rule quotes, computed rather than written down twice. */
export function inheritedTally() {
  const total = INHERITED.entries.length;
  const wrong = INHERITED.entries.filter((e) => e.verdict === "wrong");
  return { total, wrong: wrong.length, stood: total - wrong.length, entries: wrong };
}

/**
 * The viewport every capture is taken at.
 *
 * COPIED FROM desktop/scripts/states.mjs:35
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
 * Typing an address into that placeholder is the production first-run
 * journey, not a test hook: the app's first screen asks for a control plane
 * address and the next one asks who you are.
 *
 * **Each `from` below cites the component that renders the handle today**,
 * and `test/citations.test.mjs` re-reads every one of those lines in the
 * checkout. That is deliberate: these used to cite the line of a harness
 * they had been copied out of, which recorded where a handle came from and
 * told a reader nothing about whether it was still right. A citation worth
 * keeping is one a test can fail on.
 *
 * The sequence was read out of `desktop/e2e/cursor-live.mjs` and then driven;
 * four of the five handles stood and the button did not. `INHERITED` above
 * holds that measurement.
 *
 * TWO GATES A SIGN-IN SCRIPT HAS TO HANDLE, and this bundle does.
 * `desktop/src/ui/Connect.tsx:398-402` renders ReplacePassword while
 * `mustChangePassword` is set, and `desktop/src/ui/Gate.tsx:46` renders the
 * setup wizard until setup is complete. `control-firetower up` clears both
 * over the API before anything is driven (steps 4 and 6), and `drive`
 * asserts neither is on screen rather than assuming it.
 */
export const SIGNIN = {
  address: { how: "placeholder", handle: "ft-e1.tail9c2b.ts.net", from: "desktop/src/ui/Connect.tsx:214" },
  /* Read as "Connect", driven as **Continue**. The handle below is what the
     application renders; `INHERITED` records what reading it had suggested
     and that driving is what settled it. */
  connect: { how: "role", role: "button", handle: "Continue", exact: true, from: "desktop/src/ui/Connect.tsx:224" },
  username: { how: "placeholder", handle: "Username", from: "desktop/src/ui/Connect.tsx:453" },
  password: { how: "placeholder", handle: "Password", exact: true, from: "desktop/src/ui/Connect.tsx:466" },
  submit: { how: "role", role: "button", handle: "Sign in", from: "desktop/src/ui/Connect.tsx:481" },
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
    from: "desktop/src/ui/Setup.tsx via desktop/src/ui/Gate.tsx:46",
    verified: "2026-11-17, against an unprepared instance",
  },
];

/**
 * The states this build can be driven into.
 *
 * Hash paths, because the desktop app is behind a hash router
 * (`desktop/src/Routes.tsx:1-8`: "The screens, behind the hash router").
 * Navigation is COPIED FROM desktop/scripts/states.mjs:72:
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
  home: {
    path: "/", settle: 1100, landmark: heading("what should we work on?"),
    from: "desktop/src/Routes.tsx:54 (the fallthrough). The H1 is a greeting off the clock, so only its tail is matched",
    verified: "2026-11-17",
    readback: { how: "GET /auth/me", shows: "who the signed-in session belongs to, which is what `drive signin` is a proof about" },
  },
  tasks: {
    path: "/tasks", settle: 1500, landmark: heading("Tasks"),
    from: "desktop/src/Routes.tsx:32; settle from desktop/scripts/states.mjs:85 `at(page, \"/tasks\", 1500)`",
    verified: "2026-11-17",
    readback: { how: "GET /trackers", shows: "every tracker connected:false, which is what `No tracker connected` is a claim about" },
  },
  artifacts: { path: "/artifacts", settle: 1100, landmark: heading("Artifacts"), from: "desktop/src/Routes.tsx:36", verified: "2026-11-17" },
  schedules: { path: "/schedules", settle: 1100, landmark: heading("Schedules"), from: "desktop/src/Routes.tsx:40", verified: "2026-11-17" },
  machines: {
    path: "/configuration/machines", settle: 1400, landmark: heading("Machines"),
    from: "desktop/scripts/states.mjs:111 `at(page, \"/configuration/machines\", 1400)`",
    verified: "2026-11-17",
    readback: { how: "GET /hosts", shows: "the fleet behind the rows. state:\"Online\" is not enough — read /hosts/{id}/readiness" },
  },
  repositories: { path: "/configuration/repositories", settle: 1400, landmark: heading("Repositories"), from: "desktop/src/ui/destinations.ts:81", verified: "2026-11-17" },
  "git-hosts": { path: "/configuration/git-hosts", settle: 1400, landmark: heading("Git hosts"), from: "Configuration.tsx", verified: "2026-11-17" },
  trackers: { path: "/configuration/trackers", settle: 1400, landmark: heading("Trackers"), from: "Configuration.tsx", verified: "2026-11-17" },
  skills: {
    path: "/configuration/skills", settle: 1400, landmark: heading("Skills"),
    from: "desktop/src/ui/destinations.ts:79 — this is where the rail's Customize goes",
    verified: "2026-11-17",
    readback: { how: "GET /skills", shows: "the skills the server ships with, by name, matching the rows under `From Firetower`" },
  },
  agents: { path: "/configuration/agents", settle: 1400, landmark: heading("Agents"), from: "Configuration.tsx", verified: "2026-11-17" },
  people: { path: "/configuration/people", settle: 1400, landmark: heading("People"), from: "Configuration.tsx", verified: "2026-11-17" },
  teams: { path: "/configuration/teams", settle: 1400, landmark: heading("Teams"), from: "Configuration.tsx", verified: "2026-11-17" },
  directories: { path: "/configuration/directories", settle: 1400, landmark: heading("Directories"), from: "Configuration.tsx", verified: "2026-11-17" },
  vault: { path: "/configuration/vault", settle: 1400, landmark: heading("Vault"), from: "Configuration.tsx", verified: "2026-11-17" },
  server: {
    path: "/configuration/server", settle: 1400, landmark: heading("This Firetower"),
    from: "desktop/src/ui/Configuration.tsx. The heading is 'This Firetower', not 'Server'",
    verified: "2026-11-17",
    readback: { how: "GET /bootstrap", shows: "the serverId, organisation and version the screen is displaying" },
  },
  /**
   * Agent profiles — the screen at `/configuration/roles`.
   *
   * Three names for one thing, all current, on three different surfaces:
   * `roles` on the wire and in the route; **Agent profiles** both as the
   * screen's own heading (`desktop/src/ui/config/Roles.tsx:283`) and as the
   * rail panel's row (`desktop/src/ui/RailPanel.tsx:497`); and **Profiles**
   * in the *configuration index*
   * (`desktop/src/ui/config/panes.ts:50`, which says why: "'Profiles' to the
   * person, because one is worn by a workspace's own agent as much as by a
   * delegate; `roles` on the wire, because the API and the spawn tool still
   * say role").
   *
   * The rail was previously recorded as saying "Profiles". It does not, and
   * `drive audit` printed that attribution on every run.
   *
   * Entered here under what the screen says it is, not under its route's
   * word, and `NOT_WHAT_THEY_SAY` keeps the divergence recorded. The two
   * agree on purpose — the test asserts a route listed there may only also be
   * a state if the state's landmark is the screen that route was recorded as
   * landing on.
   */
  profiles: {
    path: "/configuration/roles", settle: 1400, landmark: heading("Agent profiles"),
    readback: { how: "GET /roles", shows: "what the list is drawn from — [] on a fresh install" },
    from: "desktop/src/ui/config/Roles.tsx:283 title=\"Agent profiles\", and desktop/src/ui/RailPanel.tsx:497 labels the rail row the same; the pane is `roles` on the wire, and \"Profiles\" is the configuration index's word (desktop/src/ui/config/panes.ts:50)",
    verified: "2026-11-17",
  },
  account: { path: "/account", settle: 1100, landmark: heading("Password", 2), from: "desktop/src/Routes.tsx:46. The H1 is the signed-in username, which is per-run", verified: "2026-11-17" },
  updates: { path: "/updates", settle: 1100, landmark: heading("Past runs", 2), from: "desktop/src/Routes.tsx:45. The H1 is 'Up to date.' or not, depending on the answer", verified: "2026-11-17" },
};

/**
 * Routes that exist in the source and are not the screen their name suggests.
 *
 * `desktop/scripts/states.mjs:11-13` states the doctrine and it is right: "A state this build
 * cannot reach is the finding… because a reconciliation whose gaps are
 * invisible is a reconciliation of the states that happened to work." So
 * these are recorded rather than quietly aliased to whatever they land on —
 * an entry that claimed `/configuration/roles` was the roles screen would
 * have a run verifying Agent profiles and reporting it as Roles.
 */
export const NOT_WHAT_THEY_SAY = [
  { path: "/configuration/roles", lands: "Agent profiles", found: "2026-11-17", note: "the route's word is `roles` and the screen's heading is Agent profiles; driven as the state `profiles`, whose landmark is that heading rather than the route's word" },
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
 *   `add-a-repository`, read out of `cursor-live.mjs`, clicks an `Add` button on the
 *   repositories screen. With no git host connected that screen's only action
 *   is `Connect a provider`, which is what `connect-a-git-host` below does.
 *
 *   `name-a-workspace`, read out of the same file, expects `New workspace` to
 *   open a dialog with an `auth refactor` placeholder. The button exists —
 *   named `New workspace ⌘N`, so an `exact: true` match already fails — and
 *   pressing it opens nothing: the composer on the home *is* the new
 *   workspace. `start-something-new` below is that journey.
 */
export const GESTURES = {
  "add-a-machine": {
    at: "machines",
    does: "open the Add a machine dialog and type an address into it",
    from: "desktop/scripts/states.mjs:110-117 probeMachine()",
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
    needs: "an empty fleet",
    does: "type into the composer on the home, which is where a workspace starts",
    from: "driven 2026-11-17; replaces the `name-a-workspace` gesture read out of cursor-live.mjs, which describes a dialog this build does not have",
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
    needs: "a bare repositories screen",
    does: "follow the empty repositories screen to where a provider is connected",
    from: "driven 2026-11-17; replaces the `add-a-repository` gesture read out of cursor-live.mjs",
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

  /**
   * The same dialog, pressed through against an ssh endpoint this run started.
   *
   * `add-a-machine` above types an address and stops, because `Add it` probes
   * it over ssh and 10.4.0.22 is somebody's network. This one is the Tier B
   * journey: firetower#332 established that an Alpine sshd container is a
   * machine the control plane accepts — "a reachable ssh endpoint with the
   * right key is genuinely all it asks" — so the probe can be pressed for
   * real, at something this run brought up and will take down.
   *
   * `<machine>` comes from `--at`, and `drive` refuses any address that
   * `docker ps` does not show as a container labelled with this run's
   * isolation key. Ownership is a positive assertion here for the same reason
   * it is everywhere else in this bundle: `Add it` makes the control plane
   * open an ssh connection to whatever is typed.
   */
  "add-this-runs-machine": {
    at: "machines",
    does: "add a machine this run started, and let the control plane probe it over ssh",
    needs: "ssh-endpoint",
    from: "driven against 0.55.0 and an Alpine sshd container (firetower#332); dialog handles from desktop/scripts/states.mjs:110-117 probeMachine()",
    readback: { how: "GET /hosts", shows: "the machine on the fleet. state:\"Online\" is not enough — read /hosts/{id}/readiness and assert every required check is available" },
    verified: "2026-11-17",
    steps: [
      { click: button("Add a machine") },
      { pause: 600 },
      { expect: { how: "role", role: "heading", handle: "Add a machine", level: 2 } },
      { fill: box("192.0.2.10"), with: "<machine>" },
      { pause: 400 },
      { click: button("Add it") },
      { pause: 6000 },
    ],
    /* The dialog's second stage, which is only drawn when the probe *reached*
       the machine and found no worker on it (Machines.tsx:636-640,730). A
       probe that failed leaves the form on screen with a diagnosis, so this
       post-condition cannot be satisfied by a refused connection — which is
       what makes it proof that ssh got in rather than proof that a button
       was pressed. */
    then: button("Install the worker"),
  },

  /**
   * Adding a repository by pasting a remote — the way in for a remote no
   * host can list (`ui/config/Repos.tsx:71`, `:795-860`).
   *
   * **Not the first repository.** The picker that holds `Paste a remote` is
   * drawn only when the screen is not `bare`, and `bare` is "no repository
   * and no connected host" (`Repos.tsx:143-149`) — so on a genuinely empty
   * install the only action is `Connect a provider`, which is what
   * `connect-a-git-host` above does. That is a blocked precondition rather
   * than a weakened journey, and it is written into the feature's Gotchas.
   *
   * `<remote>` comes from `--remote`, and the probe is answered by a machine
   * rather than by the control plane (`api/repos.rs:634-647` asks
   * `a_host_to_ask`), so the path has to be one the machine can see.
   */
  "paste-a-remote": {
    at: "repositories",
    does: "paste a remote into the repositories screen and add it",
    needs: "a remote",
    from: "driven against 0.55.0; desktop/src/ui/config/Repos.tsx:520-531 (the picker), :575-588 (the Paste a remote row), :821 (the field), :849 (the button)",
    verified: "2026-11-17",
    steps: [
      { expect: button("All hosts") },
      { click: button("All hosts") },
      { pause: 400 },
      { click: button("Paste a remote") },
      { pause: 500 },
      { fill: box("git@github.com:acme/web.git"), with: "<remote>" },
      { press: "Enter" },
      { pause: 2500 },
      /* `Add it` only reads `Add it` when the probe came back: with nothing
         found the same button says `Save it anyway` (Repos.tsx:849). So this
         assertion is what makes the capture proof that the remote was
         reached, and not merely that a row was written down. */
      { expect: button("Add it") },
      { click: button("Add it") },
      { pause: 2000 },
    ],
    then: { how: "role", role: "button", handle: "web", exact: false },
    readback: { how: "GET /repos", shows: "the repository, carrying the remote that was pasted" },
  },

  /** A skill's detail, from the library list. */
  "open-a-skill": {
    at: "skills",
    does: "open one of the skills the server ships with, from the library list",
    from: "driven against 0.55.0; ui/config/Skills.tsx rows under the 'From Firetower' heading. `skill-creator` is a built-in the screen says cannot be deleted",
    verified: "2026-11-17",
    /* The row's accessible name is its monogram, its name, its origin and its
       whole description, so this matches on a substring rather than
       pretending to know the sentence. */
    steps: [{ click: { how: "role", role: "button", handle: "skill-creator", exact: false } }, { pause: 900 }],
    then: { how: "role", role: "heading", handle: "skill-creator", exact: false, level: 1 },
  },

  /** The tasks screen with no tracker connected, and the way out of it. */
  "connect-your-task-tracker": {
    at: "tasks",
    does: "follow the tasks screen's empty state to where a tracker is connected",
    from: "driven against 0.55.0; desktop/src/ui/TasksPage.tsx:304-315 Blank title=\"No tracker connected\" with a button that navigates to /configuration/trackers",
    verified: "2026-11-17",
    steps: [{ expect: button("Connect your task tracker") }, { click: button("Connect your task tracker") }, { pause: 1200 }],
    then: heading("Trackers"),
  },

  /** A new agent profile, from the Agent profiles screen. */
  "start-a-new-profile": {
    at: "profiles",
    does: "start a new agent profile from the Agent profiles screen",
    from: "driven against 0.55.0; desktop/src/ui/config/Roles.tsx:261 label=\"New profile\" opens a menu (desktop/src/ui/config/CreateMenu.tsx:43-48), and desktop/src/ui/config/Roles.tsx:995 draws the draft's heading",
    verified: "2026-11-17",
    /* `New profile` opens a menu of two ways in — "Create with AI" and
       "Write it myself" — rather than the form, and its rows are
       `role="menuitem"` (CreateMenu.tsx:43-48) rather than buttons. Driving
       it established both: the post-condition was the draft's heading, and
       the draft was two clicks and one role away. Each row's accessible name
       carries its subtitle too, so these match on a substring. */
    steps: [
      { click: button("New profile") },
      { pause: 700 },
      { expect: { how: "role", role: "menuitem", handle: "Create with AI", exact: false } },
      { click: { how: "role", role: "menuitem", handle: "Write it myself", exact: false } },
      { pause: 1000 },
    ],
    then: heading("New profile"),
    readback: { how: "GET /roles", shows: "still [] — the draft is unsaved, which is what this gesture claims" },
  },

  /**
   * Asking to disconnect this Firetower — and stopping at the question.
   *
   * The confirm is `role="dialog"` with the organisation's name in its own
   * heading (`ui/Confirm.tsx:81-83`), which is why this is worth driving: the
   * dialog is the only place the app says *which* Firetower it is about to
   * forget. **The confirming button is never pressed.** `Disconnect` forgets
   * the token on this machine (`Configuration.tsx:103-110`), and a gesture
   * that ends a run's own session is a gesture that destroys the rest of the
   * sweep.
   */
  "ask-to-disconnect": {
    at: "server",
    does: "open the disconnect question on This Firetower, and leave it open",
    from: "driven against 0.55.0; desktop/src/ui/Configuration.tsx:98-110 (the confirm) and desktop/src/ui/Confirm.tsx:81-83 (the dialog's heading)",
    verified: "2026-11-17",
    steps: [{ click: button("Disconnect", true) }, { pause: 700 }],
    then: { how: "role", role: "heading", handle: "Disconnect <organisation> from this Mac?", level: 2 },
  },
};

/**
 * The first-run journeys: the four screens a person meets before the app.
 *
 * **These exist because nothing in the firetower checkout exercises them.**
 * The mock harness seeds `firetower.servers` into `localStorage` and never
 * signs in; `desktop/e2e/cursor-live.mjs` clears both gates over the API
 * before the browser window opens, which is the right call for a script whose
 * subject is installing a Cursor agent (firetower#336). The consequence is
 * that the address screen, the sign-in form, the forced password change and
 * the setup wizard were driven by nothing at all.
 *
 * So they are journeys here rather than preconditions to skip, and they are
 * driven through the screens: `control-firetower drive act <id>`.
 *
 * **Two of them need an instance that has not been prepared**, because `up`'s
 * steps 4 and 6 exist precisely to clear the gates they are about. That is
 * what `up --first-run` is: steps 1 to 3, the administrator seeded through
 * `ADMIN_INITIAL_PASSWORD` so it still carries `must_change_password`
 * (crates/ft-server/src/lib.rs:402-426 — the flag is set whether the password
 * was supplied or invented, `crates/ft-server/src/accounts.rs:193-201`), and nothing else done.
 * `needs` says which instance a journey wants, and `drive audit` reports the
 * ones it cannot reach from the instance it has rather than passing them.
 *
 * `<server>`, `<password>`, `<new-password>` and `<organisation>` are filled
 * in by `drive` from the run lock. Nothing in this file holds a credential.
 *
 * ## The step this transport cannot drive, named rather than hidden
 *
 * `offstage` is a step of the journey that the desktop app deliberately does
 * not carry. There is exactly one: replacing the password. `desktop/src/ui/ReplacePassword.tsx:1-10`
 * says why — "Replacing a password happens once, under duress, and it happens
 * on the control plane's own interface. The app does not carry a second copy
 * of that form" — so the desktop's own screen offers `Open <host>` (which
 * leaves the app through `open.ts`, a native module) and `Sign in again`.
 * The replacement itself happens on the web control plane, which this effort
 * put out of scope (firetower#329).
 *
 * Doing it over the API and saying so is the honest option. Pretending the
 * desktop replaced it would report the web interface as verified, and
 * skipping the journey would leave the gate exercised by nothing, which is
 * where this started.
 */
export const OFFSTAGE = {
  "replace-the-password": {
    what: "replace the password where the panel sends you",
    how: "POST /api/v1/auth/password as the signed-in administrator, with the current and the new one",
    because:
      "the desktop app carries no password form on purpose (desktop/src/ui/ReplacePassword.tsx:1-10): it offers `Open <host>` and `Sign in again`, and the replacement happens on the control plane's web interface, which is out of scope for this transport (firetower#329)",
  },
};

export const FIRST_RUN = {
  "connect-an-address": {
    does: "type a control plane address into the very first screen and continue",
    needs: "either",
    from: "driven against 0.55.0; desktop/src/ui/Connect.tsx:204 (heading), :214 (field), :224 (button), :162 (the screen it lands on), :434 (its heading)",
    verified: "2026-11-17",
    steps: [
      { expect: heading("Where is your Firetower?") },
      { fill: SIGNIN.address, with: "<server>" },
      { click: SIGNIN.connect },
      { pause: 1200 },
    ],
    /* The address screen's proof is not that a button was pressed: it is that
       the app went and asked that address what it was, and came back with a
       name, a version and a form. */
    then: heading("Who are you here?"),
    /* The same question the app just asked, asked again from here. On a
       `--first-run` instance this answers `organization: null` and no
       serverId, which is what the card's `A Firetower` is a claim about. */
    readback: { how: "GET /bootstrap", shows: "the organisation and version the card is showing — null and no serverId before setup" },
  },

  "replace-the-temporary-password": {
    does: "sign in with a password that has to be replaced, replace it, and get past the door",
    needs: "first-run",
    from: "driven against 0.55.0; Connect.tsx:151-159 renders ReplacePassword with retryLabel 'Sign in again' when signIn answers mustChangePassword (Connect.tsx:398-402)",
    verified: "2026-11-17",
    steps: [
      { fill: SIGNIN.address, with: "<server>" },
      { click: SIGNIN.connect },
      { pause: 1200 },
      { fill: SIGNIN.username, with: "admin" },
      { fill: SIGNIN.password, with: "<password>" },
      { click: SIGNIN.submit },
      { pause: 1800 },
      /* The gate itself, asserted before anything is done about it. */
      { expect: heading("Replace this password") },
      { expect: button("Sign in again") },
      { offstage: "replace-the-password" },
      { click: button("Sign in again") },
      { pause: 800 },
      { fill: SIGNIN.username, with: "admin" },
      { fill: SIGNIN.password, with: "<new-password>" },
      { click: SIGNIN.submit },
      { pause: 2000 },
    ],
    /* Landing on the *next* gate is the post-condition, and it is a better
       one than the app appearing: it is the one screen that can only be
       reached once `must_change_password` is clear and setup is not finished,
       so it proves this gate opened without proving anything about the other.
       */
    then: heading("Name this Firetower"),
    /* The side effect, read back from somewhere other than the screen that
       claimed it. `needsPassword` is the server's own word for this gate
       (crates/ft-server/src/api/setup.rs:26-30), and it is the field that was
       making every other authenticated route answer 403. */
    readback: { how: "GET /setup", shows: "needsPassword false, and needsOrganization still true" },
  },

  "name-this-firetower": {
    does: "name the organisation in the setup wizard and open the app",
    needs: "first-run",
    from: "driven against 0.55.0; desktop/src/ui/Setup.tsx:40 (heading), :43 (field), :46 (button), :56 (the screen after naming), :71 (Open Firetower)",
    verified: "2026-11-17",
    steps: [
      { fill: SIGNIN.address, with: "<server>" },
      { click: SIGNIN.connect },
      { pause: 1200 },
      { fill: SIGNIN.username, with: "admin" },
      { fill: SIGNIN.password, with: "<password>" },
      { click: SIGNIN.submit },
      { pause: 2000 },
      { expect: heading("Name this Firetower") },
      { fill: box("Westlabs"), with: "<organisation>" },
      /* `Continue` is the address screen's word too, on a different screen.
         Match the heading above, never the button, to know where you are. */
      { click: button("Continue", true) },
      { pause: 1500 },
      { expect: heading("<organisation> is set up") },
      { click: button("Open Firetower") },
      { pause: 1800 },
    ],
    then: heading("what should we work on?"),
    /* `/bootstrap` has no serverId until the organisation is *named* —
       `organization()` joins on `installation.named_at IS NOT NULL`
       (crates/ft-server/src/accounts.rs:117-128) — so a serverId appearing is this journey's side
       effect, read from the one route that needs no credential at all. */
    readback: { how: "GET /bootstrap", shows: "a serverId, and the organisation under the name that was typed" },
  },
};
