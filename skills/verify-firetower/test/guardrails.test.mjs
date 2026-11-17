/**
 * The two things that would destroy somebody else's work, and the one that
 * would destroy this run's proof.
 *
 * Grep-shaped tests look lazy and are not: `just reset` and `pkill` are
 * exactly the commands an agent reaches for when it has run out of ideas, and
 * the guarantee being made is about the whole bundle rather than one function.
 * A test that asserts no file shells out to them is the only shape that
 * actually covers that.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { writeLock } from "../lib/own.mjs";
import { down } from "../lib/stack.mjs";
import { EXIT, mode } from "../lib/out.mjs";
import { BRIDGE, PAST_BRIDGE, nothingProves } from "../lib/limits.mjs";

const here = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const sources = ["control-firetower", ...readdirSync(path.join(here, "lib")).map((f) => path.join("lib", f))];
const read = (file) => readFileSync(path.join(here, file), "utf8");

/**
 * Lines that start a child process.
 *
 * The distinction these tests turn on: this bundle *names* `just reset`,
 * `pkill` and `--remove-orphans` in several places on purpose — `doctor`
 * refuses them by name, `--help` says why, and `down --dry-run` prints what
 * it is not doing. Naming them is the feature. So the test looks only at the
 * lines that would actually run something.
 */
function invocations(file) {
  return read(file)
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    /* The synchronous forms are in the list because `identify()` added one:
       a guardrail that does not cover a new call site is not a guardrail. */
    .filter((line) => /\b(run|compose|spawn|spawnSync|execFile|execFileSync|execSync|exec)\(/.test(line));
}

test("nothing in this bundle shells out to `just`", () => {
  for (const file of sources) {
    for (const line of invocations(file)) {
      assert.ok(!/\bjust\b/.test(line), `${file}: ${line.trim()}`);
    }
  }
});

test("nothing in this bundle kills by process name", () => {
  /* process.kill with a pid this run recorded is the sanctioned route, and
     the in-repo precedent is justfile:74-87 — "Only our own children are
     killed". `pkill -f firetower` would kill the :4400 control plane that is
     hosting the session doing the killing. */
  for (const file of sources) {
    for (const line of invocations(file)) {
      assert.ok(!/\bpkill\b|\bkillall\b/.test(line), `${file}: ${line.trim()}`);
    }
  }
  assert.ok(read("lib/stack.mjs").includes("process.kill(pid"), "stopPid acts on a recorded pid");

  /* And a signal is only ever reached through an identity check. `alive()`
     answers "is something there"; `mayStop()` answers "is it mine", and only
     the second one may authorise a signal. The previous guard was
     `if (!pid || !alive(pid))`, which is neither: -1 is truthy and
     process.kill(-1, 0) succeeds. */
  const stack = read("lib/stack.mjs");
  const body = stack.slice(stack.indexOf("async function stopPid("));
  /* Every signal in the whole bundle is inside stopPid. The docstrings name
     `process.kill(-1, "SIGTERM")` to say why it is refused, which is the
     feature, so only code lines are counted. */
  const code = (text) => text.split("\n").filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line)).join("\n");
  assert.equal((code(stack).match(/process\.kill\(/g) ?? []).length, 2, "two signals in this file, both in stopPid");
  assert.equal((code(body).match(/process\.kill\(pid, "SIG/g) ?? []).length, 2, "SIGTERM then SIGKILL");
  /* ...and stopPid refuses before the first of them, on identity rather than
     on liveness. The previous guard was `if (!pid || !alive(pid))`, which is
     neither: -1 is truthy and process.kill(-1, 0) succeeds. */
  const guard = body.indexOf("if (!checked.mayStop) return");
  assert.ok(guard > 0, "stopPid asks checkStop first");
  assert.ok(guard < body.indexOf('process.kill(pid, "SIG'), "and it refuses before it signals");
});

test("no docker compose invocation omits an explicit project, or adds --remove-orphans", () => {
  const text = read("lib/stack.mjs");
  assert.ok(text.includes('"compose", "-p", plan.project'), "compose is always -p <this run's project>");
  /* The flag is named in the docstring and printed by `down --dry-run`, which
     is where the reason lives. What must not exist is an invocation of it. */
  for (const line of invocations("lib/stack.mjs")) {
    assert.ok(!line.includes("--remove-orphans"), `every container in a shared project is an orphan: ${line.trim()}`);
  }
});

test("reset drops and recreates rather than truncating", () => {
  const text = read("lib/stack.mjs");
  assert.ok(text.includes("DROP DATABASE IF EXISTS firetower WITH (FORCE)"));
  assert.ok(text.includes("CREATE DATABASE firetower"));
  /* A generic TRUNCATE ... CASCADE reaches skill_files, blobs and roles, and
     leaves GET /api/v1/skills answering [] in a way a restart does not
     repair. Faster, and it makes a run verify an empty library. */
  assert.ok(!/execFile|spawn/.test(text.split("TRUNCATE")[0].split("\n").pop() ?? ""));
  assert.ok(!text.includes('"TRUNCATE'), "no TRUNCATE is ever issued");
});

test("down refuses while any capture is unposted, and touches nothing first", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "verify-firetower-down-"));
  const plan = {
    key: "k",
    checkout: root,
    lock: path.join(root, "run.json"),
    scratch: root,
    compose: path.join(root, "compose.yaml"),
    project: "ft-verify-k",
    control: { value: 4481, source: "test" },
  };
  const quiet = mode.quiet;
  mode.quiet = true;
  try {
    writeLock(plan, {
      key: "k",
      phase: "pinned",
      serverPid: null,
      evidence: [{ name: "a-proof", at: path.join(root, "a.png"), postedAt: null }],
    });
    assert.equal(await down(plan, {}), EXIT.evidence);
    assert.ok(existsSync(plan.lock), "it did not remove the run it refused to tear down");

    /* And once posted, the refusal lifts — otherwise the guard would be a
       wall rather than an ordering. */
    writeLock(plan, {
      key: "k",
      phase: "pinned",
      serverPid: null,
      evidence: [{ name: "a-proof", at: path.join(root, "a.png"), postedAt: "2026-11-17T00:00:00Z" }],
    });
    assert.equal(await down(plan, { "dry-run": true }), EXIT.ok);
  } finally {
    mode.quiet = quiet;
    rmSync(root, { recursive: true, force: true });
  }
});

test("the cannot-prove table keeps the two rows that make a passing run misleading", () => {
  const save = BRIDGE.find((row) => row.capability === "save");
  const artifact = BRIDGE.find((row) => row.capability === "loadArtifact");
  assert.match(save.chrome, /MISLEADINGLY/);
  assert.match(artifact.chrome, /THE REASON IS THE POINT/);
  assert.equal(BRIDGE.length, 12, "bridge.ts has twelve members");
  /* The split, asserted over the table rather than restated in prose: eleven
     of the twelve rows answer "no" in the chrome column, and the twelfth is
     `save`, which answers "partly" — the dangerous one, because it runs. */
  assert.equal(BRIDGE.filter((row) => /^no/i.test(row.chrome)).length, 11);
  assert.equal(BRIDGE.filter((row) => /^partly/i.test(row.chrome)).length, 1);
  /* And bridge.ts is not the whole native surface. */
  for (const expected of ["the updater", "the Windows tray", "real OS file drops", "the titlebar mechanism"]) {
    assert.ok(PAST_BRIDGE.some((row) => row.capability === expected), expected);
  }
  assert.ok(nothingProves().length >= 12);
});

test("nothing ships in the vocabulary without an origin and a verification date", async () => {
  /* The rot this is about: the firetower checkout holds two harnesses that
     disagree with each other, and neither had been driven against the app
     recently. A handle with no recorded origin cannot be diffed when it
     breaks, and one with no recorded verification was never driven at all. */
  const { STATES, GESTURES, GATES, SIGNIN, NOT_WHAT_THEY_SAY, FIRST_RUN, OFFSTAGE } = await import("../lib/vocabulary.mjs");

  for (const [name, state] of Object.entries(STATES)) {
    assert.ok(state.from?.length > 5, `state ${name} has no origin`);
    assert.ok(state.verified, `state ${name} has never been driven`);
    assert.ok(state.landmark?.role, `state ${name} has no landmark to assert`);
  }
  for (const [name, gesture] of Object.entries(GESTURES)) {
    assert.ok(gesture.from?.length > 5, `gesture ${name} has no origin`);
    assert.ok(gesture.verified, `gesture ${name} has never been driven`);
    assert.ok(gesture.then, `gesture ${name} has no post-condition, so "it worked" is undefined`);
  }
  for (const gate of GATES) {
    assert.ok(gate.verified, `gate ${gate.name} has never been driven`);
    assert.ok(gate.landmark?.role);
  }
  for (const [name, handle] of Object.entries(SIGNIN)) {
    assert.ok(handle.from?.length > 5, `signin ${name} has no origin`);
  }
  /* The first-run journeys carry the same burden as everything else, plus
     one of their own: a journey has to say which instance it needs, because
     two of the three can only be driven against one whose gates are still
     standing and reporting them as passing from anywhere else is the bug
     this bundle is about. */
  for (const [name, journey] of Object.entries(FIRST_RUN)) {
    assert.ok(journey.from?.length > 5, `journey ${name} has no origin`);
    assert.ok(journey.verified, `journey ${name} has never been driven`);
    assert.ok(journey.then, `journey ${name} has no post-condition, so "it worked" is undefined`);
    assert.ok(["first-run", "either"].includes(journey.needs), `journey ${name} does not say which instance it needs`);
    /* And a step this transport cannot drive is declared, with its reason,
       rather than slipped in as an ordinary step. */
    for (const action of journey.steps) {
      if (!action.offstage) continue;
      const aside = OFFSTAGE[action.offstage];
      assert.ok(aside, `journey ${name} names an offstage step that does not exist: ${action.offstage}`);
      assert.ok(aside.what && aside.how && aside.because, `offstage ${action.offstage} does not say what, how and why`);
    }
  }

  /* And the states the build does not reach are recorded rather than aliased
     onto whatever they land on — states.mjs:11-13.
     
     A route may be BOTH a known-wrong route and a state, and `/configuration/roles`
     is: its word is `roles`, the rail calls it Profiles and the screen's own
     heading is Agent profiles. What may never happen is a state at that path
     whose landmark is something other than what the route was recorded as
     landing on — that is the "quietly aliased" failure, and it is the one
     this now checks for rather than banning the entry outright. */
  assert.ok(NOT_WHAT_THEY_SAY.length >= 2);
  for (const route of NOT_WHAT_THEY_SAY) {
    assert.ok(route.lands && route.found && route.note);
    for (const [name, state] of Object.entries(STATES)) {
      if (state.path !== route.path) continue;
      assert.equal(
        state.landmark.name,
        route.lands,
        `state ${name} is at ${route.path}, which was recorded as landing on ${route.lands}, and asserts something else`,
      );
    }
  }
});

test("no gesture presses a probe at an address this run did not start", async () => {
  /* states.mjs:118-120 presses `Add it|Reaching it` after typing an address,
     because the mock server answers it. Against a real control plane that is
     an ssh connection opened BY THE CONTROL PLANE to whatever is in the
     field — so the address is as much an action as a value.
     
     The rule is therefore about the address rather than about the button.
     `add-a-machine` types `10.4.0.22`, which is somebody's network, and must
     stop before the probe. Anything that does press it must type a
     placeholder this run fills in, and `ownsEndpoint` has to have agreed
     that `docker ps` shows a container of this run's publishing that port. */
  const { GESTURES } = await import("../lib/vocabulary.mjs");
  const { PRECONDITIONS } = await import("../lib/drive.mjs");
  for (const [name, gesture] of Object.entries(GESTURES)) {
    const presses = gesture.steps.some((step) => step.click?.handle === "Add it" || step.click?.name === "Add it");
    if (!presses) continue;
    /* Two different buttons wear this label — the machine dialog's, which
       opens an ssh connection from the control plane, and the repositories
       paste panel's, which has a machine try to read a remote. Both reach
       out at something that was typed, so both answer to the same rule. */
    assert.ok(
      PRECONDITIONS.includes(gesture.needs),
      `${name} presses Add it and declares ${JSON.stringify(gesture.needs)}, which nothing checks`,
    );
    const typed = gesture.steps.find((step) => step.fill)?.with;
    assert.match(typed ?? "", /^<[a-z-]+>$/, `${name} presses Add it at a literal address: ${typed}`);
  }
  /* And the one that stops short still stops short. */
  assert.ok(
    !GESTURES["add-a-machine"].steps.some((step) => step.click?.handle === "Add it"),
    "add-a-machine types an address and does not probe it",
  );
});

test("the endpoint check is a positive assertion, and every unknown reads as not mine", async () => {
  const { ownsEndpoint } = await import("../lib/drive.mjs");
  const plan = { key: "k", session: "s_k" };
  const listed = () => "ft-machine-s_k\t127.0.0.1:2470->22/tcp";

  assert.equal(ownsEndpoint(plan, "editor@127.0.0.1:2470", listed).ok, true);
  /* Not loopback: this run can only establish that it started something on
     its own machine. */
  assert.equal(ownsEndpoint(plan, "editor@203.0.113.9:2470", listed).ok, false);
  /* Loopback, and no container of this run's publishes it. */
  assert.equal(ownsEndpoint(plan, "editor@127.0.0.1:22", listed).ok, false);
  /* docker could not be asked: a thing that went wrong is not permission. */
  assert.equal(
    ownsEndpoint(plan, "editor@127.0.0.1:2470", () => {
      throw new Error("docker daemon is not running");
    }).ok,
    false,
  );
  assert.equal(ownsEndpoint(plan, undefined, listed).ok, false);
});
