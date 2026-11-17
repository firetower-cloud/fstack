/**
 * The run lock as **executable authority**, and the state machine around it.
 *
 * `down` signals the pid the lock names and tears down the Compose project it
 * names. The previous version checked only that the file was JSON, was an
 * object and carried the right key — so a lock with `serverPid: -1` passed,
 * and `process.kill(-1, "SIGTERM")` signals every process the user may
 * signal. On this host that is every session on it, including the control
 * plane hosting the session doing the signalling.
 *
 * **No test here sends a signal.** The pid cases are verified through
 * `mayStop`, which only ever reads `ps`, and through `down --dry-run`, which
 * prints its decision and sends nothing. The one process any test is allowed
 * to reason about is its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeLock, readLock, validateLock, validPid, mayStop, alive, identify, PHASE } from "../lib/own.mjs";
import { down, reset, serverCommand } from "../lib/stack.mjs";
import { EXIT, mode } from "../lib/out.mjs";

function scratch(key = "k") {
  const root = mkdtempSync(path.join(os.tmpdir(), "verify-firetower-lifecycle-"));
  return {
    key,
    checkout: root,
    lock: path.join(root, "run.json"),
    scratch: root,
    compose: path.join(root, "compose.yaml"),
    project: `ft-verify-${key}`,
    control: { value: 4481, source: "test" },
    postgres: { value: 5501, source: "test" },
    renderer: { value: 5341, source: "test" },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function quietly(work) {
  const was = mode.quiet;
  mode.quiet = true;
  try {
    return await work();
  } finally {
    mode.quiet = was;
  }
}

test("a pid is a positive integer, and -1 is not one", () => {
  /* -1 is the whole finding: it is truthy, and `process.kill(-1, 0)`
     succeeds because it is the "every process you may signal" group. The old
     guard was `if (!pid || !alive(pid))`, which both of those pass. */
  for (const hostile of [-1, 0, -99999, 1.5, "4400", null, undefined, NaN, Infinity, {}]) {
    assert.equal(validPid(hostile), false, `${JSON.stringify(hostile)} must not be accepted as a pid`);
    assert.equal(alive(hostile), false, `alive(${JSON.stringify(hostile)}) must be false`);
    assert.equal(mayStop(hostile, "anything").ok, false, `mayStop(${JSON.stringify(hostile)}) must refuse`);
  }
  assert.equal(validPid(process.pid), true);
  assert.equal(alive(process.pid), true);
});

test("a lock with a hostile pid does not parse, so there is nothing to act on", () => {
  const plan = scratch();
  try {
    for (const hostile of [-1, 0, "4400", 1.5]) {
      writeFileSync(plan.lock, JSON.stringify({ key: "k", phase: "pinned", serverPid: hostile }));
      const held = readLock(plan);
      assert.equal(held.state, "unreadable", `serverPid ${hostile} must make the lock unreadable`);
      assert.match(held.why, /positive integer/);
    }
  } finally {
    plan.remove();
  }
});

test("the lock schema rejects the shapes that are not a lock", () => {
  assert.deepEqual(validateLock(null, "k"), ["the lock is not a JSON object"]);
  assert.deepEqual(validateLock([1, 2, 3], "k"), ["the lock is not a JSON object"]);
  assert.ok(validateLock({ key: "somebody-elses" }, "k").some((w) => /isolation key/.test(w)));
  assert.ok(validateLock({ key: "k", phase: "whatever" }, "k").some((w) => /only phases are/.test(w)));
  assert.ok(validateLock({ key: "k", phase: "pinned", server: "ftp://x" }, "k").some((w) => /http\(s\) origin/.test(w)));
  assert.ok(validateLock({ key: "k", phase: "pinned", ports: { control: 0 } }, "k").some((w) => /not a port number/.test(w)));
  assert.ok(validateLock({ key: "k", phase: "pinned", evidence: "nope" }, "k").some((w) => /not an array/.test(w)));
  /* Unknown fields too: a lock is a closed shape, and a field nobody wrote is
     a field nobody validated. */
  assert.ok(validateLock({ key: "k", phase: "pinned", surprise: 1 }, "k").some((w) => /not a field of a run lock/.test(w)));
  assert.deepEqual(validateLock({ key: "k", phase: "pinned", serverPid: 123 }, "k"), []);
});

test("liveness is not identity: a live pid running something else is refused", () => {
  /* This test's own process is live, and is not an ft-server. That is the
     whole shape of the defect: QA's stale lock named pid 98102, which is
     alive, and is this host's control plane. */
  assert.equal(alive(process.pid), true);
  const running = identify(process.pid);
  assert.equal(running.found, true);
  assert.ok(running.command.length > 0, "ps says what it is actually running");

  const may = mayStop(process.pid, "/some/checkout/target/debug/firetower serve --dev --port 4481 --bind 127.0.0.1");
  assert.equal(may.ok, false, "a live pid that is not the recorded command must not be signalled");
  assert.match(may.why, /not this run's/);

  /* And the positive case, so this is a check rather than a wall: asked about
     what it really is, it says yes. */
  assert.equal(mayStop(process.pid, running.command).ok, true);
});

test("down will not signal a pid whose command line the lock chose for itself", async () => {
  /* The forged-lock case, reproduced without sending anything: --dry-run
     prints the decision. It used to print `kill 98102`. */
  const plan = scratch();
  try {
    writeLock(plan, {
      key: plan.key,
      phase: PHASE.pinned,
      /* this process: alive, and not an ft-server */
      serverPid: process.pid,
      serverCommand: "target/debug/firetower serve --dev",
      evidence: [],
    });
    const out = [];
    const log = console.log;
    console.log = (line) => out.push(String(line));
    let exit;
    try {
      exit = await down(plan, { "dry-run": true });
    } finally {
      console.log = log;
    }
    const printed = out.join("\n");
    assert.equal(exit, EXIT.ok, "a dry run reports rather than refuses");
    assert.match(printed, /WOULD NOT SIGNAL/);
    assert.ok(!/\bkill \d/.test(printed), `a dry run must not print a kill for an unidentified pid:\n${printed}`);
  } finally {
    plan.remove();
  }
});

test("down with no run lock refuses instead of destroying", async () => {
  /* The missing half of the rule. An unreadable lock was refused; an absent
     one derived the Compose project from the key, removed the project and its
     volume, exited 0, and left the ft-server it had no pid for holding the
     port. "I can work out the name" is not "I started it". */
  const plan = scratch();
  try {
    assert.ok(!existsSync(plan.lock));
    const exit = await quietly(() => down(plan, {}));
    assert.equal(exit, EXIT.notMine);
  } finally {
    plan.remove();
  }
});

test("down clears the serverId and the address, so up can start the run again", async () => {
  /* The deadlock: `up` -> `down` -> `up` refused forever, because the lock
     kept a serverId for an address that no longer answered and that reads as
     *not mine*. The only escapes were `down --all` or deleting run.json by
     hand, neither documented. */
  const plan = scratch();
  try {
    writeLock(plan, {
      key: plan.key,
      phase: PHASE.pinned,
      server: "http://127.0.0.1:4481",
      serverId: "o_this_runs_server",
      serverPid: null,
      evidence: [],
    });
    assert.equal(await quietly(() => down(plan, {})), EXIT.ok);

    const after = readLock(plan);
    assert.equal(after.state, "ok", "the lock is still readable");
    assert.equal(after.run.phase, PHASE.stopped);
    assert.equal(after.run.serverId, null, "the dead serverId is gone");
    assert.equal(after.run.server, null, "and so is the address it was recorded at");
    assert.equal(after.run.serverPid, null);
    /* Credentials do not outlive the server they were for. */
    assert.equal(after.run.adminPassword, null);
    assert.equal(after.run.token, null);

    /* Which is what makes the next `up` possible: `verdict` reads a stopped
       lock as "nothing recorded" rather than as a mismatch. */
    const { verdict } = await import("../lib/own.mjs");
    const seen = await verdict(plan, { url: "http://127.0.0.1:1" });
    assert.equal(seen.verdict, "nothing-here", "a stopped run owns nothing, so there is nothing to refuse");
  } finally {
    plan.remove();
  }
});

test("reset on a stopped run names up, rather than refusing with the command that refused", async () => {
  /* `reset` was wedged the same way, and the refusal's own advice was the
     command that had just refused. */
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, phase: PHASE.stopped, server: null, serverId: null, evidence: [] });
    assert.equal(await quietly(() => reset(plan, {})), EXIT.precondition);
  } finally {
    plan.remove();
  }
});

test("the command line a run is identified by is derived from the plan, not read from the lock", () => {
  /* So a hand-edited lock cannot nominate a target. The expected string
     contains this run's absolute binary path and this run's derived port;
     the host's own control plane runs `target/debug/firetower serve --dev`
     from a different checkout with no explicit port, and cannot match. */
  const plan = scratch();
  try {
    const expected = serverCommand(plan);
    assert.ok(expected.startsWith(path.join(plan.checkout, "target", "debug", "firetower")));
    assert.match(expected, /--port 4481 --bind 127\.0\.0\.1$/);
    assert.notEqual(expected, "target/debug/firetower serve --dev");
  } finally {
    plan.remove();
  }
});

test("a lock written by this bundle always validates against its own schema", () => {
  /* Round trip, because a schema strict enough to reject a hostile lock is
     also strict enough to reject a legitimate one by accident. */
  const plan = scratch();
  try {
    writeLock(plan, {
      key: plan.key,
      startedAt: new Date().toISOString(),
      phase: PHASE.claimed,
      checkout: plan.checkout,
      server: "http://127.0.0.1:4481",
      ports: { control: 4481, postgres: 5501, renderer: 5341 },
      project: plan.project,
      home: path.join(plan.scratch, "home"),
      session: null,
      serverId: null,
      serverPid: process.pid,
      serverCommand: serverCommand(plan),
      serverStartedAt: new Date().toISOString(),
      adminPassword: "verify-whatever",
      token: "t",
      user: "admin",
      organization: "Verify",
      evidence: [],
      posted: [],
      attachments: [],
      verified: { at: "now" },
    });
    assert.equal(readLock(plan).state, "ok");
    assert.ok(readFileSync(plan.lock, "utf8").includes("verify-whatever"), "the password lives here and nowhere else");
  } finally {
    plan.remove();
  }
});

test("reset hands a startable lock to the up it calls", async () => {
  /* Found by running the acceptance path rather than by reading it, and it is
     the same defect as D1 one level down. `reset` stops the server, drops the
     database, rewrites the lock and then calls `up` — and it used to leave
     `server` set while clearing `serverId`, so that nested `up` probed the
     server `reset` had just stopped, got ECONNREFUSED against a recorded
     address, read it as `probe-failed` and refused. The database was dropped
     and the stack would not come back.
   *
     Asserted structurally, because the whole of `reset` needs Docker and a
     real server: whatever `reset` writes before re-entering `up` has to
     clear the address along with the id, which is exactly what `down` does. */
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const text = readFileSync(path.join(here, "lib/stack.mjs"), "utf8");

  const handover = text.slice(text.lastIndexOf("writeLock(plan, {", text.indexOf("const again = await up(")), text.indexOf("const again = await up("));
  for (const cleared of ["server: null", "serverId: null", "serverPid: null", "token: null", "adminPassword: null"]) {
    assert.ok(handover.includes(cleared), `reset must hand up a lock with ${cleared}`);
  }
  assert.match(handover, new RegExp(`phase: PHASE\\.${PHASE.stopped}`), "and the phase that means nothing is recorded");

  /* And the property that makes it work: a lock with no address recorded
     reads as nothing-here rather than as a mismatch. */
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, phase: PHASE.stopped, server: null, serverId: null, evidence: [] });
    const { verdict } = await import("../lib/own.mjs");
    assert.equal((await verdict(plan, { url: "http://127.0.0.1:1" })).verdict, "nothing-here");
  } finally {
    plan.remove();
  }
});
