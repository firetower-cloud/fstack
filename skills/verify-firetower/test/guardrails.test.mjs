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
import { checkTouched, BRIDGE, PAST_BRIDGE, nothingProves } from "../lib/limits.mjs";

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
    .filter((line) => /\b(run|compose|spawn|execFile|execSync|exec)\(/.test(line));
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

test("down refuses while any capture is unposted, and touches nothing first", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "verify-firetower-down-"));
  const plan = {
    key: "k",
    lock: path.join(root, "run.json"),
    scratch: root,
    compose: path.join(root, "compose.yaml"),
    project: "ft-verify-k",
    control: { value: 1, source: "test" },
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

test("a change below the bridge cannot be claimed as verified from Chrome", () => {
  const blocked = [
    "desktop/src/bridge.ts",
    "desktop/src/open.ts",
    "desktop/src/drag.ts",
    "desktop/src/update.ts",
    "desktop/src/telemetry.ts",
    "desktop/src/platform.ts",
    "desktop/src/ui/Resize.tsx",
    "desktop/src-tauri/src/main.rs",
    "desktop/src-tauri/tauri.conf.json",
    "desktop/src-tauri/tauri.macos.conf.json",
  ];
  for (const file of blocked) {
    const [result] = checkTouched([file]);
    assert.equal(result.provable, false, `${file} should be outside the frontend transport`);
    assert.ok(result.why.length > 20, `${file} needs a reason an agent can act on`);
  }
});

test("an ordinary React change is inside what Chrome proves", () => {
  for (const file of ["desktop/src/ui/Home.tsx", "desktop/src/ui/TasksPage.tsx", "web/app/page.tsx"]) {
    assert.equal(checkTouched([file])[0].provable, true, file);
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
