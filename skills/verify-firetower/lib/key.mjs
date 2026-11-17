/**
 * The isolation key, and everything derived from it.
 *
 * One key decides the control-plane port, the Postgres port, the renderer
 * port, the Compose project, `FIRETOWER_HOME` and the scratch root. One key,
 * because six independently chosen values are six chances for a run to be
 * half somebody else's.
 *
 * ---
 *
 * **Why the key is not "am I in a worktree?".** The reference implementation
 * this bundle follows (`verify-atlas`) refuses to run unless `test -f .git`
 * says it is inside a git worktree, on the grounds that a worktree is the
 * isolated case. In Firetower that discriminator inverts: **every** agent
 * checkout is a worktree, so `test -f .git` is the normal case and refusing
 * on it would refuse every legitimate run. See firetower#331.
 *
 * So the key comes from `$FIRETOWER_SESSION` — already exported by Firetower,
 * and already the isolation key its own Docker teardown sweeps by
 * (`crates/ft-worker/src/docker.rs:206`). A hand-run outside a session falls
 * back to a hash of the checkout, which is stable across its worktrees
 * because it includes `--git-common-dir`.
 *
 * **Why ports are derived from a range that cannot contain the defaults.**
 * The developer's own Firetower listens on 4400 and it is the control plane
 * hosting these sessions; `ft-cli` defaults Postgres to 5433; the desktop's
 * Vite is hardcoded to 5273 (`desktop/vite.config.ts:15`). No key can derive
 * any of those three, which is checked by a test rather than hoped for.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/** The three addresses this bundle must never derive. */
export const FORBIDDEN_PORTS = {
  4400: "the developer's own control plane, which hosts these sessions",
  5433: "ft-cli's default DATABASE_URL, which is another session's database",
  5273: "the desktop's hardcoded Vite port (desktop/vite.config.ts:15)",
};

/** Bands chosen so that no key can land on a port in FORBIDDEN_PORTS. */
const BANDS = {
  control: [4440, 40],
  postgres: [5460, 40],
  renderer: [5300, 40],
};

/** FNV-1a, 32-bit. A hash, not a secret: it only has to be stable. */
export function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function port(kind, key) {
  const [base, span] = BANDS[kind];
  return base + (hash(`${kind}:${key}`) % span);
}

/** Where the key came from, which `doctor` prints: provenance is a fact too. */
export function isolationKey({ key, checkout }) {
  if (key) return { key, source: "--key" };
  if (process.env.FIRETOWER_SESSION) {
    return { key: process.env.FIRETOWER_SESSION, source: "$FIRETOWER_SESSION" };
  }
  try {
    const git = (...args) =>
      execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
    const seed = `${git("rev-parse", "--show-toplevel")}\n${git("rev-parse", "--git-common-dir")}`;
    return { key: `local-${hash(seed).toString(36)}`, source: "hash of this checkout" };
  } catch {
    return { key: null, source: null };
  }
}

/** A Firetower checkout, found by what is in it rather than by its name. */
export function findCheckout(from) {
  let at = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(at, "crates", "ft-server", "Cargo.toml"))) return at;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/**
 * Everything one key decides.
 *
 * `source` on each port says whether it was derived or handed over. A host
 * that allocates ports to its sessions (Firetower's own does) can set the
 * three `FT_VERIFY_*_PORT` variables, and then the provenance is visible in
 * `doctor` instead of being invisible in a default.
 */
export function plan({ key, checkout, flags = {} }) {
  const scratchRoot = path.join(
    process.env.FT_VERIFY_SCRATCH ?? path.join(os.tmpdir(), "firetower-verify"),
    key,
  );
  const pick = (kind, flag, env) => {
    if (flags[flag]) return { value: Number(flags[flag]), source: `--${flag}` };
    if (process.env[env]) return { value: Number(process.env[env]), source: `$${env}` };
    return { value: port(kind, key), source: "derived from the key" };
  };
  return {
    key,
    checkout,
    control: pick("control", "control-port", "FT_VERIFY_CONTROL_PORT"),
    postgres: pick("postgres", "postgres-port", "FT_VERIFY_POSTGRES_PORT"),
    renderer: pick("renderer", "renderer-port", "FT_VERIFY_RENDERER_PORT"),
    project: flags.project ?? `ft-verify-${key}`,
    session: process.env.FIRETOWER_SESSION ?? null,
    scratch: scratchRoot,
    lock: path.join(scratchRoot, "run.json"),
    home: path.join(scratchRoot, "home"),
    evidence: path.join(scratchRoot, "evidence"),
    logs: path.join(scratchRoot, "logs"),
    compose: path.join(scratchRoot, "compose.yaml"),
  };
}

export const databaseUrl = (p, db = "firetower") =>
  `postgres://firetower:firetower@127.0.0.1:${p.postgres.value}/${db}`;

export const serverUrl = (p) => `http://127.0.0.1:${p.control.value}`;

/**
 * The administrator password for this run: independent, random, per run.
 *
 * **It used to be `verify-${hash(`pw:${key}`)}-ok`** — a 32-bit FNV of the
 * isolation key, and `evidence post` published that key beside the control
 * plane's port in a public pull request comment. Anyone who could reach the
 * loopback address could therefore compute a live administrator credential
 * from the comment: another session on this host, another user, anyone with a
 * forward. Resetting with the same key reproduced the same password.
 *
 * Two rules come out of that, and they are both structural rather than a
 * tightening of the old scheme:
 *
 *   - **Nothing published may share an input with anything secret.** The key
 *     names ports, a Compose project and a scratch directory, all of which
 *     appear in output a human reads. So no credential may be derived from
 *     it, however the derivation is dressed up. 24 bytes from
 *     `crypto.randomBytes` has no input to share.
 *   - **The password is state, not a function.** It is generated once by
 *     `up`, kept only in the run lock (0600 beneath a 0700 directory), read
 *     from there by every later command, and replaced on `reset`. A command
 *     that cannot read it refuses instead of deriving it, because deriving it
 *     is the bug.
 *
 * base64url, so it survives JSON, a shell and an HTML form unescaped;
 * `crates/ft-server/src/accounts.rs:47` wants at least 5 characters and this
 * is 32.
 */
export const newPassword = () => `verify-${randomBytes(24).toString("base64url")}`;
