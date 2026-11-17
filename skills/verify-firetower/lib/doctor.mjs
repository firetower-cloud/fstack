/**
 * `doctor` — whether this run owns what it is about to drive.
 *
 * The question is not "is something listening". On this machine those have
 * different answers: the developer's own Firetower is usually on
 * 127.0.0.1:4400 and it is the control plane hosting the session this run is
 * inside. So every line here is read at the moment it is asked, and an
 * unknown is never reported as a pass.
 *
 * It also refuses two things by name rather than merely not doing them,
 * because an agent that has run out of ideas reaches for the repository's
 * most convenient clean-slate command and `just reset` is two unconditional
 * lines that delete 54GB of other people's work.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serverUrl, databaseUrl, FORBIDDEN_PORTS } from "./key.mjs";
import { readLock, verdict, listening, alive } from "./own.mjs";
import { raw, refuse } from "./api.mjs";
import { EXIT, emit, fail, say, table, dim, tick, cross, warn } from "./out.mjs";

const run = promisify(execFile);

export async function doctor(plan, flags) {
  const checks = [];
  const add = (check, state, detail) => checks.push({ check, state, detail });

  const held = readLock(plan);
  const target = flags.server ? normalise(flags.server) : serverUrl(plan);
  const asked = Boolean(flags.server);
  const seen = await verdict(plan, { url: target, lock: held });

  add("key", plan.key ? "ok" : "no", plan.key ? `${plan.key} (${plan.keySource})` : "no isolation key could be derived");
  add("checkout", plan.checkout ? "ok" : "no", plan.checkout ?? "no Firetower checkout at or above the working directory");

  for (const [kind, where] of [["control", plan.control], ["postgres", plan.postgres], ["renderer", plan.renderer]]) {
    const port = where.value;
    const up = await listening(port);
    const forbidden = FORBIDDEN_PORTS[port];
    add(
      `port ${kind}`,
      forbidden ? "no" : "ok",
      forbidden
        ? `${port} is ${forbidden} — refuse`
        : `${port} ${dim(`(${where.source})`)} ${up ? "answering" : "silent"}`,
    );
  }

  add(
    "run lock",
    held.state === "ok" ? "ok" : held.state === "absent" ? "unknown" : "no",
    held.state === "ok"
      ? `${plan.lock} ${dim(`phase ${held.run.phase}`)}`
      : held.state === "absent"
        ? `none at ${plan.lock} — nothing has been brought up`
        : `unreadable: ${held.why}. A lock that will not parse is not an empty one`,
  );

  if (held.state === "ok") {
    const pids = [["server", held.run.serverPid], ["renderer", held.run.rendererPid]].filter(([, p]) => p);
    for (const [what, pid] of pids) {
      add(`pid ${what}`, alive(pid) ? "ok" : "no", `${pid} ${alive(pid) ? "alive" : "gone"}`);
    }
    if (!pids.length) add("pid", "unknown", "no pids recorded");
  }

  add(
    "instance",
    seen.verdict === "mine" ? "ok" : seen.verdict === "nothing-here" ? "unknown" : "no",
    instanceLine(seen),
  );

  /* The database, the forced password change and the setup wizard are only
     askable once ownership is positive. Asking them of somebody else's
     instance is the mistake this file exists to prevent. */
  if (seen.verdict === "mine") {
    const db = await database(plan);
    add("database", db.ok ? "ok" : "no", db.detail);

    const token = held.run?.token;
    if (!token) {
      add("admin", "unknown", "no token recorded; run control-firetower up");
    } else {
      const setup = await raw(plan, "GET", "/setup", { token });
      if (setup.status === 403 && setup.body?.code === "PasswordChangeRequired") {
        add("admin", "no", "must_change_password is still set, so every authenticated route answers 403");
        add("setup", "unknown", "cannot be read until the password change is cleared");
      } else if (setup.status === 200) {
        add("admin", setup.body.needsPassword ? "no" : "ok", setup.body.needsPassword ? "a password change is outstanding" : "usable, and the forced change is cleared");
        add(
          "setup",
          setup.body.completed ? "ok" : "no",
          setup.body.completed
            ? `complete ${dim(`organisation "${setup.body.organization?.name ?? "?"}"`)}`
            : `the wizard would still be on screen (needsOrganization ${setup.body.needsOrganization})`,
        );
      } else {
        add("admin", "no", `GET /setup answered ${setup.status}`);
      }
    }

    const fleet = await raw(plan, "GET", "/hosts", { token: held.run?.token });
    if (Array.isArray(fleet.body)) {
      add(
        "fleet",
        "ok",
        fleet.body.length
          ? `${fleet.body.length} machine(s). state:"Online" is not enough — read /hosts/{id}/readiness`
          : `empty. Nothing can run until a machine is added ${dim("(Tier B)")}`,
      );
    }
  }

  const renderer = await listening(plan.renderer.value);
  add(
    "renderer",
    renderer ? "ok" : "unknown",
    renderer
      ? `answering on http://localhost:${plan.renderer.value}`
      : `not started. cd desktop && pnpm exec vite --port ${plan.renderer.value} --strictPort ${dim("(flag only: vite.config.ts:15 hardcodes 5273. `pnpm dev -- --port` swallows it)")}`,
  );

  const captures = held.run?.evidence ?? [];
  const unposted = captures.filter((e) => !e.postedAt);
  add(
    "evidence",
    captures.length === 0 ? "unknown" : unposted.length ? "no" : "ok",
    captures.length === 0
      ? `nothing captured yet. Scratch is ${plan.evidence}`
      : unposted.length
        ? `${unposted.length} of ${captures.length} captures not posted. Post before any cleanup`
        : `${captures.length} captures, all posted`,
  );

  /* Refused by name rather than merely not done. An agent that has run out
     of ideas reaches for the repository's most convenient clean-slate
     command, and on this machine that command is two unconditional lines
     that delete 54GB of other people's work. */
  const refusals = [
    ["just reset", "`docker compose down -v` + `rm -rf ~/.firetower/worker`: 54GB and every live session's worktree on this host, including this one"],
    ["pkill -f firetower|vite|next", "kills the :4400 control plane hosting this session, and every other session's processes"],
    ["adopting an instance already answering", "ownership is a positive assertion; an unknown reads as not mine"],
    ["falling back to the next free port", "it relocates a run away from the port its own evidence names"],
    ["TRUNCATE ... CASCADE as a reset", "reaches skill_files, blobs and roles; GET /api/v1/skills then answers [] forever"],
  ];

  /* Unposted evidence is reported and does not change the exit code: it is a
     thing to do next, not a reason this run cannot drive. `down` is where it
     is a refusal, because that is where the proof is actually at risk. */
  const failed = checks.filter((c) => c.state === "no" && c.check !== "evidence");

  if (flags.json) {
    const exit = exitFor(seen, held);
    return emit(
      {
        verdict: seen.verdict,
        exit,
        asked: asked ? target : null,
        plan: planJson(plan),
        instance: {
          at: seen.at,
          cause: seen.cause ?? null,
          recordedServerId: seen.recorded,
          answeringServerId: seen.answer?.serverId ?? null,
          organization: seen.answer?.organization ?? null,
          version: seen.answer?.version ?? null,
          reachable: Boolean(seen.answer?.reachable),
          reasons: seen.reasons,
        },
        checks,
        refused: refusals.map(([what, why]) => ({ what, why })),
      },
      exit,
    );
  }

  say("");
  say(`  ${dim("control-firetower doctor")}  ${asked ? `asked about ${target}` : `this run, key ${plan.key}`}`);
  say("");
  table(
    checks.map(({ check, state, detail }) => [
      check,
      detail,
      state === "ok" ? tick() : state === "no" ? cross() : warn(),
    ]),
  );
  say("");
  say(`  ${dim("refused by name, not merely not done")}`);
  table(refusals.map(([what, why]) => [what, why]));
  say("");

  if (seen.verdict === "mine") {
    say(`  ${tick()} ${seen.recorded} is this run's, positively: it is the serverId recorded at launch.`);
    if (failed.length) {
      say(`  ${warn()} ${failed.length} check${failed.length === 1 ? "" : "s"} below a pass. Fix before driving:`);
      for (const f of failed) say(`      ${f.check}: ${f.detail}`);
    }
    say("");
    return emit({ verdict: "mine", checks }, failed.length ? EXIT.precondition : EXIT.ok);
  }

  if (seen.verdict === "claimed") {
    say(`  ${warn()} claimed but not pinned: setup is unfinished, so /bootstrap has no serverId to check against yet.`);
    say(`      Ownership rests on the port having been silent when pid ${held.run?.serverPid} bound it.`);
    say(`      ${dim("control-firetower up")} finishes steps 4 to 6 and pins it.`);
    say("");
    return emit({ verdict: "claimed", checks }, EXIT.precondition);
  }

  if (seen.verdict === "nothing-here") {
    return fail(EXIT.precondition, {
      problem: `nothing is up on ${seen.at}`,
      because: seen.reasons,
      instead: [
        "control-firetower up            six steps to a signed-in administrator",
        "control-firetower up --dry-run  see the ports and paths it would use first",
      ],
    });
  }

  return refuse(seen, hint(seen, plan));
}

/* The extra lines that make the wrong-instance refusal actionable, rather
   than just correct. */
function hint(seen, plan) {
  const lines = [];
  if (seen.answer?.serverId && seen.recorded && seen.answer.serverId !== seen.recorded) {
    lines.push(
      "A different Firetower is answering there than the one this run recorded. That is",
      "the case worth catching: the same server on a new address is still the same",
      "server, and a different server on a familiar address is not.",
      "",
    );
  }
  if (!seen.recorded && seen.answer?.reachable) {
    lines.push(
      "This run has recorded no serverId for that address, so there is nothing that could",
      "make it this run's. On this machine the usual answer is the developer's own control",
      "plane — and driving it would not be a port clash, it would be driving your host.",
      "",
    );
  }
  if (seen.answer?.reachable === false) {
    lines.push(
      "The probe did not get an answer. That is a thing that went wrong, not permission:",
      "an instance that cannot be identified is not one to drive.",
      "",
    );
  }
  return lines;
}

function instanceLine(seen) {
  if (seen.verdict === "mine") return `${seen.at} is ${seen.recorded} ${dim("(recorded at launch)")}`;
  if (seen.verdict === "claimed") return `${seen.at} is this run's by claim; no serverId yet`;
  if (seen.verdict === "nothing-here") return `${seen.at} is silent, and nothing is recorded`;
  const answering = seen.answer?.serverId ?? "unidentifiable";
  const org = seen.answer?.organization ? ` "${seen.answer.organization}"` : "";
  return `${seen.at} answers as ${answering}${org}, recorded ${seen.recorded ?? "nothing"} — NOT THIS RUN'S`;
}

function exitFor(seen) {
  if (seen.verdict === "mine") return EXIT.ok;
  if (seen.verdict === "not-mine") return EXIT.notMine;
  return EXIT.precondition;
}

async function database(plan) {
  if (!(await listening(plan.postgres.value))) {
    return { ok: false, detail: `nothing on 127.0.0.1:${plan.postgres.value}. docker compose -p ${plan.project} up -d --wait postgres` };
  }
  try {
    const { stdout } = await run("docker", [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${plan.project}`,
      "--format",
      "{{.Names}}",
    ]);
    const names = stdout.trim().split("\n").filter(Boolean);
    return {
      ok: names.length > 0,
      detail: names.length
        ? `${names.join(", ")} ${dim(`project ${plan.project}`)}`
        : `something is on ${plan.postgres.value} but no container in project ${plan.project} — not this run's`,
    };
  } catch (error) {
    return { ok: false, detail: `docker did not answer (${error.code ?? error.message}), so nothing is known` };
  }
}

function planJson(plan) {
  return {
    key: plan.key,
    keySource: plan.keySource,
    checkout: plan.checkout,
    ports: {
      control: { port: plan.control.value, source: plan.control.source },
      postgres: { port: plan.postgres.value, source: plan.postgres.source },
      renderer: { port: plan.renderer.value, source: plan.renderer.source },
    },
    project: plan.project,
    home: plan.home,
    scratch: plan.scratch,
    databaseUrl: databaseUrl(plan),
  };
}

const normalise = (where) => (where.startsWith("http") ? where.replace(/\/$/, "") : `http://${where.replace(/\/$/, "")}`);
