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
      serverPid: null,
      evidence: [{ name: "a-proof", at: path.join(root, "a.png"), postedAt: null }],
    });
    assert.equal(await down(plan, {}), EXIT.evidence);
    assert.ok(existsSync(plan.lock), "it did not remove the run it refused to tear down");

    /* And once posted, the refusal lifts — otherwise the guard would be a
       wall rather than an ordering. */
    writeLock(plan, {
      key: "k",
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
  /* Eleven of the twelve read as absent in Chrome. `save` is the twelfth and
     is the dangerous one: it is a different gesture, not a missing one. */
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
  const { STATES, GESTURES, GATES, SIGNIN, NOT_WHAT_THEY_SAY } = await import("../lib/vocabulary.mjs");

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
  /* And the states the build does not reach are recorded rather than aliased
     onto whatever they land on — states.mjs:11-13. */
  assert.ok(NOT_WHAT_THEY_SAY.length >= 2);
  for (const route of NOT_WHAT_THEY_SAY) {
    assert.ok(route.lands && route.found && route.note);
    assert.ok(!Object.values(STATES).some((s) => s.path === route.path), `${route.path} is both a state and a known-wrong route`);
  }
});

test("no gesture presses a button that probes somebody else's network", () => {
  /* states.mjs:118-120 presses `Add it|Reaching it` after typing an address,
     because the mock server answers it. Against a real control plane that is
     an ssh probe to 10.4.0.22, which is somebody's network. */
  const text = readFileSync(path.join(here, "lib/vocabulary.mjs"), "utf8");
  assert.ok(!/click:\s*button\("Add it"/.test(text), "Add it is a post-condition here, never a step");
});
