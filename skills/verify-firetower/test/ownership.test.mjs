/**
 * The ownership rule, which is the load-bearing safety property here.
 *
 * **Why these tests do not point at `127.0.0.1:4400`.** The refusal was first
 * demonstrated against the developer's real control plane on that port, and
 * that is the best evidence there is — but it is not a test. On a CI runner or
 * a clean laptop nothing is there, and a check that depends on a foreign
 * Firetower happening to be listening would quietly become a no-op exactly
 * where it matters most.
 *
 * The property is "an instance this run did not start is refused", and that
 * is provable against *any* instance this run did not start. So each test
 * stands up a throwaway `/api/v1/bootstrap` responder — which is all the
 * ownership check reads — records nothing about it, and points at it.
 *
 * Six causes, one verdict, one exit code. That is deliberate: the research
 * was explicit that every one of them reads as "not mine".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { verdict, writeLock, listening } from "../lib/own.mjs";

/** A Firetower-shaped `/bootstrap`, and nothing else. */
function foreign({ serverId = "o_someone_else", organization = "Somebody Else" } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      if (request.url !== "/api/v1/bootstrap") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: "0.0.0-test", eventsPath: "/api/v1/events", serverId, organization, authModes: ["password"] }));
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

function scratch() {
  const root = mkdtempSync(path.join(os.tmpdir(), "verify-firetower-test-"));
  return {
    key: "test-key",
    lock: path.join(root, "run.json"),
    control: { value: 1, source: "test" },
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("an instance answering with a different serverId is refused", async () => {
  const them = await foreign({ serverId: "o_theirs" });
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, server: "http://127.0.0.1:1", serverId: "o_mine", phase: "pinned" });
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "serverid-mismatch");
    assert.equal(seen.answer.serverId, "o_theirs");
    assert.equal(seen.recorded, "o_mine");
  } finally {
    plan.remove();
    await them.close();
  }
});

test("an instance answering with no run lock at all is refused, not adopted", async () => {
  const them = await foreign();
  const plan = scratch();
  try {
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "no-lock");
  } finally {
    plan.remove();
    await them.close();
  }
});

test("a run lock that will not parse is a refusal, not an empty lock", async () => {
  const them = await foreign();
  const plan = scratch();
  try {
    writeFileSync(plan.lock, "{ this is not json");
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "unreadable-lock");
  } finally {
    plan.remove();
    await them.close();
  }
});

test("a run lock belonging to another isolation key is unreadable, so refused", async () => {
  const them = await foreign();
  const plan = scratch();
  try {
    writeFileSync(plan.lock, JSON.stringify({ key: "somebody-elses-key", serverId: "o_mine" }));
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "unreadable-lock");
  } finally {
    plan.remove();
    await them.close();
  }
});

test("an instance that will not say which Firetower it is, is refused", async () => {
  const them = await foreign({ serverId: null, organization: null });
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, server: them.url, serverId: null, phase: "pinned" });
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "serverid-unreadable");
  } finally {
    plan.remove();
    await them.close();
  }
});

test("a recorded server that stops answering is refused, not re-adopted", async () => {
  const them = await foreign();
  const url = them.url;
  await them.close();
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, server: url, serverId: "o_mine", phase: "pinned" });
    const seen = await verdict(plan, { url });
    assert.equal(seen.verdict, "not-mine");
    assert.equal(seen.cause, "probe-failed");
  } finally {
    plan.remove();
  }
});

test("a silent port with nothing recorded is nothing-here, which is not a refusal", async () => {
  const them = await foreign();
  const url = them.url;
  await them.close();
  const plan = scratch();
  try {
    const seen = await verdict(plan, { url });
    assert.equal(seen.verdict, "nothing-here");
  } finally {
    plan.remove();
  }
});

test("the recorded serverId answering is the only thing that means mine", async () => {
  const them = await foreign({ serverId: "o_mine", organization: "Mine" });
  const plan = scratch();
  try {
    writeLock(plan, { key: plan.key, server: them.url, serverId: "o_mine", phase: "pinned" });
    const seen = await verdict(plan, { url: them.url });
    assert.equal(seen.verdict, "mine");
    assert.equal(seen.cause, null);
  } finally {
    plan.remove();
    await them.close();
  }
});

test("listening() answers for a v6-only listener, because Vite is one", async () => {
  /* A false "silent" is the reading that matters: it is what `up` asks before
     it binds a port. Vite binds `localhost`, which is `::1` on macOS. */
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "::1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await listening(port), true);
  } finally {
    await new Promise((done) => server.close(done));
  }
});
