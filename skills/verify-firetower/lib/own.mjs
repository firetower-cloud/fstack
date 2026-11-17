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
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import path from "node:path";
import net from "node:net";

export const PHASE = { claimed: "claimed", pinned: "pinned" };

/** Read the run lock. An unreadable lock is a refusal, not an empty one. */
export function readLock(plan) {
  if (!existsSync(plan.lock)) return { state: "absent", run: null };
  let text;
  try {
    text = readFileSync(plan.lock, "utf8");
  } catch (error) {
    return { state: "unreadable", run: null, why: `${plan.lock}: ${error.code ?? error.message}` };
  }
  try {
    const run = JSON.parse(text);
    if (!run || typeof run !== "object" || run.key !== plan.key) {
      return { state: "unreadable", run: null, why: "the lock is for a different isolation key" };
    }
    return { state: "ok", run };
  } catch {
    return { state: "unreadable", run: null, why: `${plan.lock} is not JSON` };
  }
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
  try {
    const response = await fetch(`${url}/api/v1/bootstrap`, { signal });
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
    return { reachable: false, readable: false, why: error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message) };
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

/** Is this pid still there? Signal 0, so nothing is sent. */
export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
