/**
 * Ownership, and the run lock it is recorded in.
 *
 * ---
 *
 * **The rule, which is Firetower's own.** `desktop/src/servers.ts:15-44`
 * governs restoring a credential from the OS keychain, and states it as
 * plainly as it can be put:
 *
 *   > A credential may be restored from the OS keychain only where this file
 *   > can *positively establish* that restoring it is permitted. **Not
 *   > knowing that it is forbidden is not permission.**
 *
 * Applied here: **not knowing that an instance is somebody else's is not
 * ownership.** A probe that errors, a lock that will not parse, a `serverId`
 * that cannot be read — each of those is a thing that went wrong, and the
 * reassuring reading of a thing that went wrong is how a run ends up driving
 * the developer's own Firetower. So every one of them reads as *not mine*,
 * and the answer is refusal rather than adaptation.
 *
 * | what happened | what this run concludes |
 * |---|---|
 * | no lock, and the port is silent | nothing is up; this run owns nothing yet |
 * | no lock, and something answers | somebody else's. Refuse |
 * | the lock will not parse | nothing is known, so nothing is owned. Refuse |
 * | the probe errors or times out | nothing is known. Refuse |
 * | `serverId` is absent from the answer | cannot be identified. Refuse |
 * | `serverId` differs from the recorded one | a different Firetower on a familiar address. Refuse |
 * | `serverId` matches | mine, positively |
 *
 * The one asymmetry: between starting the server and finishing its setup
 * wizard, `/bootstrap` answers `serverId: null` by design, because until the
 * organisation exists "there is nothing here to be trusted yet"
 * (`crates/ft-server/src/api.rs:194-196`). A run in that window owns the
 * instance by a different positive fact — the port was silent, and *this run*
 * bound it, and its child process is still alive. That is the `claimed`
 * phase, and only `up` may act in it.
 *
 * **There is no fallback to the next free port.** A port that is taken means
 * somebody is there. Sliding to the next one relocates a run away from the
 * port its own evidence names, so a screenshot would be of one Firetower and
 * the lock would describe another.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import net from "node:net";

/**
 * The three states a run can be in, and the only transitions between them.
 *
 * Written out because leaving it implicit deadlocked the lifecycle: `down`
 * stopped the server but left its `serverId` in the lock, so the next `up`
 * re-checked a recorded id against a silent port, read that as *not mine* and
 * refused — forever. A run on one host was single-use, and the refusal's own
 * advice was the command that had just refused.
 *
 *   nothing                 no lock, or a lock in `stopped`. Nothing is
 *                           recorded, so nothing is owned and `up` may bind
 *     -- up -->  claimed    this run bound a silent port and its child is
 *                           alive; /bootstrap has no serverId until setup
 *                           finishes, so ownership rests on that positive
 *                           fact and only `up` may act in this phase
 *     -- up -->  pinned     /bootstrap answered with a serverId and the lock
 *                           records it. Every command may act
 *     -- down -->  stopped  the server has been stopped and the serverId and
 *                           address are CLEARED. Back to "nothing recorded",
 *                           which is a legitimate state to start again from
 *
 * `reset` goes pinned -> claimed -> pinned without passing through stopped,
 * because it keeps the stack and replaces the data.
 */
export const PHASE = { claimed: "claimed", pinned: "pinned", stopped: "stopped" };

/**
 * The complete run lock schema.
 *
 * Validated field by field on every read, and unknown fields are rejected.
 * The reason is not tidiness: a lock is **executable authority** — `down`
 * signals the pid it names and tears down the Compose project it names — and
 * the previous version checked only that the file was JSON, was an object,
 * and carried the right key. A lock with `serverPid: -1` passed that check,
 * and `process.kill(-1, "SIGTERM")` signals every process the user can
 * signal, which on this host is every session on it including the control
 * plane hosting the session doing the signalling.
 *
 * So: "it parsed" is not "it is safe to act on". Each field below says what
 * shape it must be, and anything else makes the whole lock unreadable — which
 * is already a refusal everywhere.
 */
const SCHEMA = {
  key: "string",
  startedAt: "string?",
  updatedAt: "string?",
  stoppedAt: "string?",
  phase: ["claimed", "pinned", "stopped"],
  checkout: "string?",
  server: "url?",
  ports: "ports?",
  project: "string?",
  home: "string?",
  session: "string?",
  serverId: "string?",
  serverPid: "pid?",
  serverCommand: "string?",
  serverStartedAt: "string?",
  rendererPid: "pid?",
  rendererCommand: "string?",
  token: "string?",
  user: "string?",
  adminPassword: "string?",
  /**
   * This instance was brought up deliberately unprepared, and both first-run
   * gates still stand.
   *
   * It is in the lock rather than re-derived because the two facts that make
   * it true — `must_change_password` and an unnamed organisation — are
   * answered by routes that 403 until the first of them is cleared, so a
   * command cannot cheaply ask. `drive` reads it to know which journeys the
   * instance can carry, and clears it when the journeys have cleared the
   * gates.
   */
  firstRun: "boolean?",
  organization: "string?",
  evidence: "array?",
  posted: "array?",
  attachments: "array?",
  verified: "object?",
};

/** A pid this CLI is willing to hold: a positive integer, and nothing else. */
export function validPid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function checkField(name, rule, value) {
  if (Array.isArray(rule)) {
    return rule.includes(value) ? null : `${name} is "${value}", and the only phases are ${rule.join(", ")}`;
  }
  const optional = rule.endsWith("?");
  const kind = optional ? rule.slice(0, -1) : rule;
  if (value === undefined || value === null) {
    return optional ? null : `${name} is missing`;
  }
  switch (kind) {
    case "string":
      return typeof value === "string" ? null : `${name} is ${typeof value}, not a string`;
    case "boolean":
      return typeof value === "boolean" ? null : `${name} is ${typeof value}, not a boolean`;
    case "url":
      return typeof value === "string" && /^https?:\/\/[^\s/]+$/.test(value)
        ? null
        : `${name} is not an http(s) origin: ${JSON.stringify(value)}`;
    case "pid":
      /* The field that made a hostile lock executable. */
      return validPid(value) ? null : `${name} is ${JSON.stringify(value)}, and a pid must be a positive integer`;
    case "ports": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return `${name} is not an object`;
      for (const kindOf of ["control", "postgres", "renderer"]) {
        const port = value[kindOf];
        if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
          return `${name}.${kindOf} is ${JSON.stringify(port)}, not a port number`;
        }
      }
      return null;
    }
    case "array":
      return Array.isArray(value) ? null : `${name} is not an array`;
    case "object":
      return value && typeof value === "object" && !Array.isArray(value) ? null : `${name} is not an object`;
    default:
      return null;
  }
}

/** Every way a lock can fail to be a lock, as a list. */
export function validateLock(run, key) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return ["the lock is not a JSON object"];
  const wrong = [];
  if (run.key !== key) wrong.push(`the lock is for isolation key ${JSON.stringify(run.key)}, and this run is ${key}`);
  for (const [name, rule] of Object.entries(SCHEMA)) {
    if (name === "key") continue;
    const problem = checkField(name, rule, run[name]);
    if (problem) wrong.push(problem);
  }
  for (const name of Object.keys(run)) {
    if (!(name in SCHEMA)) wrong.push(`${name} is not a field of a run lock`);
  }
  return wrong;
}

/** Read the run lock. An unreadable lock is a refusal, not an empty one. */
export function readLock(plan) {
  if (!existsSync(plan.lock)) return { state: "absent", run: null };
  let text;
  try {
    text = readFileSync(plan.lock, "utf8");
  } catch (error) {
    return { state: "unreadable", run: null, why: `${plan.lock}: ${error.code ?? error.message}` };
  }
  let run;
  try {
    run = JSON.parse(text);
  } catch {
    return { state: "unreadable", run: null, why: `${plan.lock} is not JSON` };
  }
  const wrong = validateLock(run, plan.key);
  if (wrong.length) {
    return {
      state: "unreadable",
      run: null,
      why: wrong.length === 1 ? wrong[0] : `${wrong.length} problems: ${wrong.join("; ")}`,
    };
  }
  return { state: "ok", run };
}

/**
 * This run's administrator password, which lives only here.
 *
 * No command may derive it — see `newPassword` in key.mjs for why — so a
 * command that cannot read it from the lock has to refuse rather than guess.
 */
export function password(plan) {
  const { run } = readLock(plan);
  return run?.adminPassword ?? null;
}

export function writeLock(plan, run) {
  mkdirSync(path.dirname(plan.lock), { recursive: true, mode: 0o700 });
  const temporary = `${plan.lock}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, plan.lock);
  return run;
}

export function updateLock(plan, patch) {
  const { run } = readLock(plan);
  return writeLock(plan, { ...(run ?? { key: plan.key }), ...patch, updatedAt: new Date().toISOString() });
}

/**
 * Is anything listening? Asked before binding, and never answered by guessing.
 *
 * Both loopback families, because they are not interchangeable in practice:
 * Vite binds `localhost`, which on macOS Node resolves to `::1` and not to
 * `127.0.0.1`, so a v4-only check reports a running renderer as silent. A
 * false "silent" here would be the one reading that matters — it is the check
 * `up` asks before it binds a port.
 */
export async function listening(port, host, timeout = 400) {
  const hosts = host ? [host] : ["127.0.0.1", "::1"];
  for (const candidate of hosts) {
    if (await connects(port, candidate, timeout)) return true;
  }
  return false;
}

function connects(port, host, timeout) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * `GET /api/v1/bootstrap` — unauthenticated, read-only, creates nothing.
 *
 * The one call that says *which* Firetower is answering. Measured under
 * firetower#330: it is discovery, not an action, so probing an instance you
 * do not own changes nothing about it — which is what makes it safe to use as
 * the ownership check.
 */
export async function probe(url, timeout = 3000) {
  const signal = AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetch(`${url}/api/v1/bootstrap`, { signal });
  } catch (error) {
    return { reachable: false, readable: false, why: error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message) };
  }
  try {
    if (!response.ok) return { reachable: true, readable: false, why: `HTTP ${response.status}` };
    const body = await response.json();
    return {
      reachable: true,
      readable: typeof body.serverId !== "undefined",
      serverId: body.serverId ?? null,
      organization: body.organization ?? null,
      version: body.version ?? null,
      authModes: body.authModes ?? [],
    };
  } catch (error) {
    /* Something answered on the port and it was not a Firetower bootstrap
       document. That is "I cannot tell which Firetower this is", not "nothing
       is there" — and reporting it as unreachable was why a live foreign HTTP
       server classified as `probe-failed`, leaving `serverid-unreadable`
       documented but unreachable from the CLI. */
    return {
      reachable: true,
      readable: false,
      why: `answered ${response.status} with a body that is not a Firetower bootstrap document (${error.message})`,
    };
  }
}

/**
 * The verdict, for a given address and the lock this run holds.
 *
 * Returns one of:
 *   mine          positively identified: the recorded serverId answered
 *   claimed       this run bound a silent port and its child is alive; no serverId yet
 *   not-mine      anything else that is answering
 *   nothing-here  silent, and this run has nothing recorded
 *
 * `not-mine` is ONE class with several causes, and they share exit code 2 on
 * purpose: the research was explicit that every one of them reads as "not
 * mine". The cause is in the JSON — `no-lock`, `unreadable-lock`,
 * `serverid-mismatch`, `serverid-unreadable`, `nothing-recorded`,
 * `probe-failed` — so an agent branching on exit status gets one answer and
 * an agent that wants the detail can read it, rather than six exit codes
 * that all mean refuse.
 */
export async function verdict(plan, { url, lock } = {}) {
  const at = url ?? `http://127.0.0.1:${plan.control.value}`;
  const held = lock ?? readLock(plan);
  const answer = await probe(at);
  const reasons = [];

  if (held.state === "unreadable") {
    reasons.push(`the run lock is there and cannot be read: ${held.why}`);
    return { at, verdict: "not-mine", cause: "unreadable-lock", answer, reasons, recorded: null };
  }

  const recorded = held.run?.serverId ?? null;

  if (!answer.reachable) {
    if (held.state === "absent" || !held.run?.server) {
      return { at, verdict: "nothing-here", cause: "silent", answer, reasons: [`nothing is listening on ${at} (${answer.why})`], recorded };
    }
    reasons.push(`this run recorded a server at ${at} and it does not answer (${answer.why})`);
    return { at, verdict: "not-mine", cause: "probe-failed", answer, reasons, recorded };
  }

  if (held.state === "absent") {
    reasons.push(`something is answering on ${at} and this run did not start it`);
    reasons.push(`it says it is ${answer.serverId ?? "a Firetower that will not identify itself"}`);
    return { at, verdict: "not-mine", cause: "no-lock", answer, reasons, recorded };
  }

  if (!answer.readable || answer.serverId === null) {
    if (recorded === null && held.run?.phase === PHASE.claimed && alive(held.run?.serverPid)) {
      reasons.push(`setup is unfinished, so /bootstrap has no serverId yet — ownership rests on the port having been silent when pid ${held.run.serverPid} bound it`);
      return { at, verdict: "claimed", cause: null, answer, reasons, recorded };
    }
    reasons.push(`${at} will not say which Firetower it is (serverId ${answer.serverId === null ? "is null" : "is missing"})`);
    return { at, verdict: "not-mine", cause: "serverid-unreadable", answer, reasons, recorded };
  }

  if (recorded === null) {
    reasons.push(`${at} is set up and answering as ${answer.serverId}, and this run has no serverId recorded for it`);
    return { at, verdict: "not-mine", cause: "nothing-recorded", answer, reasons, recorded };
  }

  if (answer.serverId !== recorded) {
    reasons.push(`recorded serverId  ${recorded}`);
    reasons.push(`answering serverId ${answer.serverId}${answer.organization ? `  (organisation "${answer.organization}")` : ""}`);
    return { at, verdict: "not-mine", cause: "serverid-mismatch", answer, reasons, recorded };
  }

  return { at, verdict: "mine", cause: null, answer, reasons: [`serverId ${recorded} answered on ${at}`], recorded };
}

/**
 * Is this pid still there? Signal 0, so nothing is sent.
 *
 * A non-positive pid is not a pid. `-1` used to pass this check — it is
 * truthy and `process.kill(-1, 0)` succeeds, because it is the "every
 * process you may signal" group — which is how a lock holding `serverPid: -1`
 * became a host-wide SIGTERM. Liveness is also not identity: see `identify`.
 */
export function alive(pid) {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * What is actually running as this pid.
 *
 * `ps -o lstart=,command= -p <pid>`, read rather than trusted: a pid in a
 * lock is a number somebody wrote down, and pids are recycled. QA's dry-run
 * printed `kill 98102` from a stale lock, and 98102 is this host's own
 * control plane.
 *
 * Reading is safe and signalling is not, so this is always asked first.
 */
export function identify(pid) {
  if (!validPid(pid)) return { pid, found: false, why: `${JSON.stringify(pid)} is not a positive integer, so it is not a pid` };
  let line;
  try {
    /* -ww, or macOS truncates the command line and the comparison below
       would be made against a prefix. */
    line = execFileSync("ps", ["-ww", "-o", "lstart=,command=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return { pid, found: false, why: `no process ${pid}` };
  }
  if (!line) return { pid, found: false, why: `no process ${pid}` };
  /* `lstart` is a fixed-width 24-character date — "Mon Nov 17 17:49:03 2026". */
  const match = line.match(/^(\w{3}\s+\w{3}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.*)$/);
  return match
    ? { pid, found: true, startedAt: match[1], command: match[2] }
    : { pid, found: true, startedAt: null, command: line };
}

/**
 * May this run signal this pid? Identity, not liveness.
 *
 * The lock records the command line `up` launched, and this asks the
 * operating system what that pid is running now. They have to agree. A
 * recycled pid, a hand-edited lock and a pid belonging to another session all
 * fail here, and the refusal names what it found instead — which is the
 * difference between "stale lock, nothing to do" and "I was about to SIGTERM
 * your control plane".
 */
export function mayStop(pid, expected) {
  if (!validPid(pid)) {
    return { ok: false, why: `${JSON.stringify(pid)} is not a pid. A positive integer is the only thing this will signal`, found: null };
  }
  const found = identify(pid);
  if (!found.found) return { ok: false, gone: true, why: found.why, found };
  if (!expected) {
    return {
      ok: false,
      why: `pid ${pid} is running "${found.command}", and this run recorded no command line for it, so there is nothing to compare`,
      found,
    };
  }
  if (found.command !== expected) {
    return {
      ok: false,
      why: `pid ${pid} is running "${found.command}", and this run recorded "${expected}" — a recycled or foreign pid, not this run's`,
      found,
    };
  }
  return { ok: true, why: `pid ${pid} is running exactly the command line this run launched`, found };
}
