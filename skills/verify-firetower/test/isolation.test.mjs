/**
 * What the isolation key derives, and the three ports it must never produce.
 *
 * These are checked rather than hoped for because the consequence is not a
 * port clash. 4400 is the developer's own control plane and the one hosting
 * these sessions; 5433 is `ft-cli`'s default `DATABASE_URL`, so a run that
 * reached it could reset another session's administrator password; 5273 is
 * the desktop's hardcoded Vite port. A derivation that could land on any of
 * them is a bug with somebody else's work as the blast radius.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { port, plan, hash, newPassword, FORBIDDEN_PORTS, isolationKey } from "../lib/key.mjs";

const KEYS = Array.from({ length: 5000 }, (_, i) => `s_${hash(`k${i}`).toString(36)}${i}`);

test("no key can derive 4400, 5433 or 5273", () => {
  const forbidden = Object.keys(FORBIDDEN_PORTS).map(Number);
  for (const key of KEYS) {
    for (const kind of ["control", "postgres", "renderer"]) {
      const chosen = port(kind, key);
      assert.ok(
        !forbidden.includes(chosen),
        `key ${key} derived ${kind} port ${chosen}, which is ${FORBIDDEN_PORTS[chosen]}`,
      );
    }
  }
});

test("each port stays inside its own band, so the three can never collide", () => {
  for (const key of KEYS.slice(0, 500)) {
    const control = port("control", key);
    const postgres = port("postgres", key);
    const renderer = port("renderer", key);
    assert.ok(control >= 4440 && control < 4480, `control ${control}`);
    assert.ok(postgres >= 5460 && postgres < 5500, `postgres ${postgres}`);
    assert.ok(renderer >= 5300 && renderer < 5340, `renderer ${renderer}`);
    assert.equal(new Set([control, postgres, renderer]).size, 3);
  }
});

test("derivation is stable: the same key is the same run", () => {
  const first = plan({ key: "s_stable", checkout: "/tmp/x" });
  const second = plan({ key: "s_stable", checkout: "/tmp/x" });
  assert.deepEqual(
    [first.control.value, first.postgres.value, first.renderer.value, first.project],
    [second.control.value, second.postgres.value, second.renderer.value, second.project],
  );
});

test("one key decides all six resources, and they all carry it", () => {
  const made = plan({ key: "s_abc", checkout: "/tmp/x" });
  assert.equal(made.project, "ft-verify-s_abc");
  assert.ok(made.scratch.endsWith("/firetower-verify/s_abc"));
  assert.ok(made.home.endsWith("/firetower-verify/s_abc/home"));
  assert.ok(made.lock.endsWith("/firetower-verify/s_abc/run.json"));
  /* Never the checkout: the whole workspace is deleted at session end. */
  assert.ok(!made.scratch.startsWith("/tmp/x"));
});

test("an explicitly given port is recorded as given, not as derived", () => {
  const made = plan({ key: "s_abc", checkout: "/tmp/x", flags: { "control-port": "4999" } });
  assert.equal(made.control.value, 4999);
  assert.equal(made.control.source, "--control-port");
  assert.equal(made.postgres.source, "derived from the key");
});

test("$FIRETOWER_SESSION is the key when it is set, and provenance says so", () => {
  const before = process.env.FIRETOWER_SESSION;
  process.env.FIRETOWER_SESSION = "s_from_env";
  try {
    assert.deepEqual(isolationKey({ checkout: "/tmp/x" }), {
      key: "s_from_env",
      source: "$FIRETOWER_SESSION",
    });
  } finally {
    if (before === undefined) delete process.env.FIRETOWER_SESSION;
    else process.env.FIRETOWER_SESSION = before;
  }
});

test("the administrator password is random per run, not derived from anything published", () => {
  /* The bug this replaces: `verify-${hash(`pw:${key}`)}-ok`, a 32-bit FNV of
     the isolation key — and `evidence post` published that key beside the
     control plane's port in a public comment, so a reader who could reach
     loopback could compute a live credential. The property is not "harder to
     guess": it is that the password shares no input with anything printed. */
  const made = Array.from({ length: 500 }, () => newPassword());
  assert.equal(new Set(made).size, 500, "500 passwords, 500 distinct values");

  /* crates/ft-server/src/accounts.rs:47 — MINIMUM_PASSWORD = 5 */
  for (const one of made) assert.ok(one.length >= 12, one);
  /* base64url, so it survives JSON, a shell and an HTML form unescaped. */
  for (const one of made) assert.match(one, /^verify-[A-Za-z0-9_-]{32}$/);

  /* And it takes no argument, so there is no key, port, project or path it
     could be derived from. */
  assert.equal(newPassword.length, 0);
});

test("no key, port or project name is an input to any credential", () => {
  /* Enforced over the whole bundle rather than one function: the rule is
     "nothing published may share an input with anything secret", and the way
     that rule was broken was one call to a hash of the key. */
  const here = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  for (const file of readdirSync(path.join(here, "lib"))) {
    const text = readFileSync(path.join(here, "lib", file), "utf8");
    const code = text.split("\n").filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line)).join("\n");
    assert.ok(!/hash\(`?pw/.test(code), `${file} derives a credential from a hash`);
    assert.ok(!/adminPassword\s*=\s*\(/.test(code), `${file} still has a password function of the key`);
  }
  /* The password is read from the lock, by one function, in one file. */
  const own = readFileSync(path.join(here, "lib/own.mjs"), "utf8");
  assert.match(own, /export function password\(plan\)/);
  assert.match(own, /run\?\.adminPassword \?\? null/);
});
