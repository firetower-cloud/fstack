/**
 * Bringing the stack up, resetting it, and stopping it.
 *
 * The six steps of `up` are measured, not guessed — firetower#330 timed each
 * one against a real Postgres and a real ft-server. The two that are easy to
 * miss are 4 and 6, and missing either leaves a server that answers and a
 * control plane that cannot be used:
 *
 *   4  the first administrator carries must_change_password, and every
 *      authenticated route answers 403 until it is cleared
 *   6  the desktop shows the setup wizard until /setup/complete
 *
 * Teardown is the mirror image and is where this file is most careful. It
 * acts on pids this run recorded and on a Compose project named explicitly.
 * It never kills by process name, never runs `just reset`, and never passes
 * `--remove-orphans` — from another compose file, every container in a shared
 * project is an orphan.
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, openSync, existsSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { databaseUrl, serverUrl, adminPassword } from "./key.mjs";
import { readLock, writeLock, updateLock, verdict, listening, probe, alive, PHASE } from "./own.mjs";
import { signIn, raw, refuse } from "./api.mjs";
import { EXIT, fail, emit, say, step, done, note, table, dim } from "./out.mjs";

const run = promisify(execFile);
const STEPS = 6;

/**
 * This run's Postgres, as a compose file of its own.
 *
 * Not the checkout's `compose.yaml`: that one hardcodes `4400:4400` and
 * `3000:3000` for its `full` profile (compose.yaml:71-72), which is a second
 * reason that profile cannot be used here, and its project name defaults to
 * `firetower-dev` — a name another session may already own. Writing our own
 * two-service-free file into the scratch root means the project name and the
 * published port are always this run's, and the volume is scoped to the
 * project rather than shared.
 *
 * `postgres:17-alpine` is the image the checkout uses, so the server version
 * a run verifies against is the one a developer gets.
 */
function composeFile(plan) {
  return `# Written by control-firetower for isolation key ${plan.key}.
# Project is always named explicitly: docker compose -p ${plan.project}
services:
  postgres:
    image: postgres:17-alpine
    labels:
      com.firetower.session: "${plan.session ?? "none"}"
      com.firetower.verify-key: "${plan.key}"
    environment:
      POSTGRES_USER: firetower
      POSTGRES_PASSWORD: firetower
      POSTGRES_DB: firetower
    ports:
      - "127.0.0.1:${plan.postgres.value}:5432"
    volumes:
      - postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U firetower -d firetower"]
      interval: 1s
      timeout: 3s
      retries: 60
volumes:
  postgres:
`;
}

const compose = (plan, ...args) =>
  run("docker", ["compose", "-p", plan.project, "-f", plan.compose, ...args], {
    cwd: plan.scratch,
    maxBuffer: 1 << 24,
  });

export function serverEnv(plan) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl(plan),
    FIRETOWER_HOME: plan.home,
    FIRETOWER_PUBLIC_URL: `http://127.0.0.1:${plan.renderer.value}`,
  };
}

const binary = (plan) => path.join(plan.checkout, "target", "debug", "firetower");

/** The plan, printed. `--dry-run` and the first half of `doctor` share it. */
export function describe(plan) {
  return [
    "This run",
    ["isolation key", `${plan.key}  ${dim(`(${plan.keySource})`)}`],
    ["checkout", plan.checkout],
    ["control plane", `127.0.0.1:${plan.control.value}  ${dim(`(${plan.control.source})`)}`],
    ["postgres", `127.0.0.1:${plan.postgres.value}  ${dim(`(${plan.postgres.source})`)}`],
    ["renderer", `127.0.0.1:${plan.renderer.value}  ${dim(`(${plan.renderer.source})`)}`],
    ["compose project", plan.project],
    ["FIRETOWER_HOME", plan.home],
    ["scratch", plan.scratch],
  ];
}

export async function up(plan, flags) {
  mkdirSync(plan.scratch, { recursive: true, mode: 0o700 });
  mkdirSync(plan.logs, { recursive: true });
  mkdirSync(plan.evidence, { recursive: true });

  const seen = await verdict(plan);
  if (seen.verdict === "mine") {
    say("");
    say(`${dim("already up")} serverId ${seen.recorded} is answering on ${seen.at}`);
    say("");
    table(describe(plan));
    say("");
    say(`  Nothing to do. ${dim("`control-firetower reset` puts the data back without restarting.")}`);
    return emit({ already: true, instance: seen, plan: lockable(plan) });
  }
  if (seen.verdict === "not-mine") {
    return refuse(seen, [
      "Something is already on this run's derived control-plane port, and this run",
      "did not start it. That is an instance to leave alone, not one to adopt.",
      "",
    ]);
  }

  /* The Postgres port gets the same treatment, with one allowance: a
     container in THIS run's compose project is this run's, so a second `up`
     after a crash does not have to throw the database away. Anything else
     listening there is somebody's. */
  if (await listening(plan.postgres.value)) {
    const ours = await ownsPostgres(plan);
    if (!ours) {
      return fail(EXIT.notMine, {
        problem: `something is listening on 127.0.0.1:${plan.postgres.value} and it is not this run's Postgres`,
        because: [
          `no container in compose project ${plan.project} publishes that port`,
          "ft-cli defaults DATABASE_URL to localhost:5433, so another session's database is the usual answer",
        ],
        instead: [
          `control-firetower up --postgres-port <free port>   choose one explicitly`,
          "lsof -nP -iTCP:" + plan.postgres.value + " -sTCP:LISTEN            see whose it is",
          "",
          "Do not drop or migrate whatever is there.",
        ],
      });
    }
  }

  if (flags["dry-run"]) {
    say("");
    say(`${dim("dry run")} nothing below has been done`);
    say("");
    table(describe(plan));
    say("");
    table([
      "Would run",
      ["1 build", `cargo build -p ft-cli  ${dim(existsSync(binary(plan)) ? "(skipped: already built)" : "")}`],
      ["2 postgres", `docker compose -p ${plan.project} -f ${plan.compose} up -d --wait`],
      ["3 serve", `firetower serve --dev --port ${plan.control.value} --bind 127.0.0.1`],
      ["  env", `DATABASE_URL=${databaseUrl(plan)}`],
      ["  env", `FIRETOWER_HOME=${plan.home}`],
      ["4 passwd", `firetower passwd admin  ${dim("(password piped on stdin)")}`],
      ["5 login", `POST ${serverUrl(plan)}/api/v1/auth/login`],
      ["6 setup", `POST /api/v1/setup/organization, POST /api/v1/setup/complete`],
      ["then", "record /bootstrap's serverId in the run lock"],
    ]);
    say("");
    return emit({ dryRun: true, plan: lockable(plan) });
  }

  writeFileSync(plan.compose, composeFile(plan));
  writeLock(plan, {
    key: plan.key,
    startedAt: new Date().toISOString(),
    phase: PHASE.claimed,
    checkout: plan.checkout,
    server: serverUrl(plan),
    ports: { control: plan.control.value, postgres: plan.postgres.value, renderer: plan.renderer.value },
    project: plan.project,
    home: plan.home,
    session: plan.session,
    serverId: null,
    evidence: [],
    posted: [],
  });

  /* 1 — build */
  step(1, STEPS, "cargo build -p ft-cli");
  let at = Date.now();
  if (existsSync(binary(plan)) && !flags.rebuild) {
    note(`${binary(plan)} is there; --rebuild to build anyway`);
    done("already built", 0);
  } else {
    try {
      await run("cargo", ["build", "-p", "ft-cli"], { cwd: plan.checkout, maxBuffer: 1 << 26 });
    } catch (error) {
      return fail(EXIT.failed, {
        problem: "cargo build -p ft-cli failed",
        because: String(error.stderr ?? error.message).trim().split("\n").slice(-8),
        instead: [
          `cd ${plan.checkout} && cargo build -p ft-cli    read the whole error`,
          "A cold build is around 60s and needs about 3.3GB in target/.",
        ],
      });
    }
    done("built", Date.now() - at);
  }

  /* 2 — postgres */
  step(2, STEPS, `docker compose -p ${plan.project} up -d postgres`);
  at = Date.now();
  try {
    await compose(plan, "up", "-d", "--wait", "postgres");
  } catch (error) {
    return fail(EXIT.failed, {
      problem: "this run's Postgres did not come up",
      because: String(error.stderr ?? error.message).trim().split("\n").slice(-6),
      instead: [
        `docker compose -p ${plan.project} -f ${plan.compose} logs postgres`,
        "docker info                                  is the daemon there at all",
        "",
        "Do not run `just reset` to clear it: that is `docker compose down -v` plus",
        "`rm -rf ~/.firetower/worker`, which is every session's worktree on this host.",
      ],
    });
  }
  done(`postgres on 127.0.0.1:${plan.postgres.value}`, Date.now() - at);

  /* 3 — serve */
  step(3, STEPS, `firetower serve --dev --port ${plan.control.value}`);
  at = Date.now();
  mkdirSync(plan.home, { recursive: true, mode: 0o700 });
  const out = openSync(path.join(plan.logs, "server.out"), "a");
  const err = openSync(path.join(plan.logs, "server.err"), "a");
  const server = spawn(
    binary(plan),
    ["serve", "--dev", "--port", String(plan.control.value), "--bind", "127.0.0.1"],
    { cwd: plan.checkout, env: serverEnv(plan), detached: true, stdio: ["ignore", out, err] },
  );
  server.unref();
  updateLock(plan, { serverPid: server.pid });

  const answered = await waitFor(() => probe(serverUrl(plan)), (a) => a.reachable, 40_000);
  if (!answered) {
    return fail(EXIT.failed, {
      problem: `ft-server started as pid ${server.pid} and never answered on ${serverUrl(plan)}`,
      because: [
        `its stderr is at ${path.join(plan.logs, "server.err")}`,
        lastLines(path.join(plan.logs, "server.err"), 4),
      ].flat(),
      instead: [
        `tail -40 ${path.join(plan.logs, "server.err")}`,
        "control-firetower down            stop what did start",
        "",
        `Kill it by pid — ${server.pid} — and never by name. \`pkill -f firetower\` kills`,
        "the :4400 control plane that is hosting this session.",
      ],
    });
  }
  done(`answering on ${serverUrl(plan)}`, Date.now() - at);

  /* 4 — the forced password change, cleared in the same statement */
  step(4, STEPS, "firetower passwd admin");
  at = Date.now();
  try {
    await passwd(plan);
  } catch (error) {
    return fail(EXIT.failed, {
      problem: "`firetower passwd admin` did not set this run's administrator password",
      because: String(error.stderr ?? error.message).trim().split("\n").slice(-6),
      instead: [
        "Check DATABASE_URL reached the right database. Unset, ft-cli defaults to",
        "localhost:5433, which is another session's — and that would have reset THEIR",
        "administrator password.",
        `  DATABASE_URL=${databaseUrl(plan)}`,
      ],
    });
  }
  done("password set, must_change_password cleared", Date.now() - at);

  /* 5 — a token */
  step(5, STEPS, "POST /api/v1/auth/login");
  at = Date.now();
  const signedIn = await signIn(plan);
  if (!signedIn.ok) {
    return fail(EXIT.failed, {
      problem: `signing in as admin answered ${signedIn.status}`,
      because: [JSON.stringify(signedIn.body)],
      instead: [
        "control-firetower up --rebuild    if the binary predates a schema change",
        "control-firetower doctor          read what the six steps got to",
      ],
    });
  }
  done(`signed in as ${signedIn.user?.username ?? "admin"}`, Date.now() - at);

  /* 6 — setup, or the desktop shows the wizard instead of the app */
  step(6, STEPS, "POST /api/v1/setup/organization, POST /api/v1/setup/complete");
  at = Date.now();
  const named = await raw(plan, "POST", "/setup/organization", {
    token: signedIn.token,
    body: { name: `Verify ${plan.key.slice(-8)}` },
  });
  if (named.status !== 200 && named.status !== 409) {
    return fail(EXIT.failed, {
      problem: `naming the organisation answered ${named.status}`,
      because: [JSON.stringify(named.body)],
      instead: ["control-firetower api GET /setup     see which steps are outstanding"],
    });
  }
  await raw(plan, "POST", "/setup/complete", { token: signedIn.token });
  done("set up", Date.now() - at);

  /* Only now does /bootstrap have a serverId: it is None until the
     organisation exists, because "until then there is nothing here to be
     trusted yet" (crates/ft-server/src/api.rs:194-196). Recording it is what
     makes every later command's ownership check a positive assertion. */
  const pinned = await probe(serverUrl(plan));
  if (!pinned.serverId) {
    return fail(EXIT.failed, {
      problem: "setup finished and /bootstrap still has no serverId",
      because: [`GET ${serverUrl(plan)}/api/v1/bootstrap -> ${JSON.stringify(pinned)}`],
      instead: [
        "Without a serverId there is nothing to assert ownership against, so this run",
        "cannot safely drive anything. control-firetower down, then up again.",
      ],
    });
  }
  updateLock(plan, { phase: PHASE.pinned, serverId: pinned.serverId, organization: pinned.organization });

  say("");
  table([
    "Up",
    ["serverId", `${pinned.serverId}  ${dim("recorded; every later command checks it")}`],
    ["organisation", pinned.organization ?? "-"],
    ["version", pinned.version ?? "-"],
    ["control plane", serverUrl(plan)],
    ["renderer", `not started. cd desktop && pnpm exec vite --port ${plan.renderer.value} --strictPort`],
    ["run lock", plan.lock],
  ]);
  say("");
  say(`  ${dim("next")} control-firetower doctor`);
  say("");
  return emit({ serverId: pinned.serverId, instance: pinned, plan: lockable(plan) });
}

/**
 * `firetower passwd admin`, with the password on stdin.
 *
 * It works unattended: the `stty -echo` it attempts is non-fatal — it prints
 * "stty: stdin isn't a terminal" and carries on — and `accounts::set_password`
 * sets `must_change_password = FALSE` in the same statement
 * (crates/ft-server/src/accounts.rs:743-775). Measured at 0.40s.
 */
export function passwd(plan) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(plan), ["passwd", "admin"], {
      cwd: plan.checkout,
      env: serverEnv(plan),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(Object.assign(new Error("passwd failed"), { stderr }))));
    const pw = adminPassword(plan.key);
    child.stdin.end(`${pw}\n${pw}\n`);
  });
}

/**
 * Put the data back, by dropping the database.
 *
 * Measured at 2.93s to a signed-in administrator, which is what makes a
 * per-feature reset affordable. It is deliberately NOT a TRUNCATE: a generic
 * `TRUNCATE ... CASCADE` is 2.8s faster and silently reaches skill_files,
 * skill_defaults, skill_pins, roles and role_defaults, leaving
 * GET /api/v1/skills returning [] in a way a restart does not repair. A run
 * that reset that way would verify an empty Skills library and report it as
 * the product's behaviour.
 */
export async function reset(plan, flags) {
  const held = readLock(plan);
  if (held.state !== "ok") {
    return fail(EXIT.precondition, {
      problem: "there is no run to reset",
      because: [held.state === "absent" ? `no run lock at ${plan.lock}` : held.why],
      instead: ["control-firetower up        bring this run's stack up first"],
    });
  }
  const seen = await verdict(plan);
  if (seen.verdict !== "mine" && seen.verdict !== "nothing-here") return refuse(seen);

  const statements = [
    `DROP DATABASE IF EXISTS firetower WITH (FORCE)`,
    `CREATE DATABASE firetower OWNER firetower`,
  ];
  if (flags["dry-run"]) {
    say("");
    say(`${dim("dry run")} nothing below has been done`);
    say("");
    table([
      "Would run",
      ["1 stop", `kill ${held.run.serverPid}  ${dim("(by recorded pid, never by name)")}`],
      ...statements.map((s, i) => [`${i + 2} psql`, s]),
      ["4 home", flags["keep-home"] ? `${plan.home} left alone (--keep-home)` : `rm -rf ${plan.home}`],
      ["5 serve", `firetower serve --dev --port ${plan.control.value}`],
      ["6 passwd", "firetower passwd admin"],
      ["7 login", "POST /api/v1/auth/login"],
      ["8 setup", "POST /setup/organization, POST /setup/complete"],
    ]);
    say("");
    say(`  ${dim("not this")} TRUNCATE ... CASCADE. It reaches skill_files, blobs and roles,`);
    say(`  ${dim("        ")} and leaves GET /api/v1/skills answering [] forever.`);
    say("");
    return emit({ dryRun: true, statements });
  }

  step(1, 8, "stopping the control plane by recorded pid");
  await stopPid(held.run.serverPid);
  done("stopped", 0);

  step(2, 8, "DROP DATABASE firetower WITH (FORCE); CREATE DATABASE firetower");
  let at = Date.now();
  for (const statement of statements) {
    await compose(plan, "exec", "-T", "postgres", "psql", "-U", "firetower", "-d", "postgres", "-c", statement);
  }
  done("recreated", Date.now() - at);

  /* $FIRETOWER_HOME/ssh/known_hosts belongs in the reset unit: a container
     machine rebuilt at the same address answers with a different host key and
     the next probe fails with HostKeyChanged. The control plane's own ssh
     identity rotates with the database anyway, so anything already in a
     machine's authorized_keys is stale after this. */
  if (!flags["keep-home"]) {
    rmSync(plan.home, { recursive: true, force: true });
    note(`removed ${plan.home}, including ssh/known_hosts`);
  }

  writeLock(plan, { ...held.run, phase: PHASE.claimed, serverId: null, token: null });
  const again = await up({ ...plan }, { ...flags, rebuild: false });
  return again;
}

/**
 * Stop what this run started. Nothing else.
 *
 * By recorded pid, by this run's Compose project, by this run's labels. The
 * in-repo precedent for killing only your own children is justfile:74-87:
 * "Only our own children are killed — `kill 0` would take the calling shell
 * with it".
 */
export async function down(plan, flags) {
  const held = readLock(plan);
  if (held.state === "unreadable") {
    return fail(EXIT.notMine, {
      problem: "the run lock is there and cannot be read, so there is no record of what this run started",
      because: [held.why, "a lock that will not parse is not an empty one"],
      instead: [
        `cat ${plan.lock}                       look at it`,
        `docker compose -p ${plan.project} ps   what is actually running`,
        "",
        "Stop things by pid or by that project name. Never `pkill -f firetower`:",
        "that kills the :4400 control plane hosting this session.",
      ],
    });
  }

  const unposted = (held.run?.evidence ?? []).filter((e) => !e.postedAt);
  if (unposted.length && !flags.force && !flags["dry-run"]) {
    return fail(EXIT.evidence, {
      problem: `${unposted.length} capture${unposted.length === 1 ? "" : "s"} have not been posted, and tearing down loses the proof`,
      because: [
        "durability comes from having posted, not from a directory: the whole workspace is",
        "deleted when this session ends, and the stack a side effect would be read back from",
        "goes first.",
        ...unposted.map((e) => `  ${e.name}  ${e.at}`),
      ],
      instead: [
        "control-firetower evidence post --pr <number>     post it",
        "control-firetower evidence verify --pr <number>   confirm the attachments render",
        "control-firetower down                            then this",
        "",
        "control-firetower evidence hold                   nowhere to post it yet",
        "control-firetower down --force                    tear down anyway, and say so in the PR",
      ],
    });
  }

  const actions = [
    ["pid", held.run?.serverPid ? `kill ${held.run.serverPid}${alive(held.run.serverPid) ? "" : " (already gone)"}` : "no server pid recorded"],
    ["pid", held.run?.rendererPid ? `kill ${held.run.rendererPid}${alive(held.run.rendererPid) ? "" : " (already gone)"}` : "no renderer pid recorded"],
    ["compose", `docker compose -p ${plan.project} -f ${plan.compose} down -v`],
    ["scratch", flags.all ? `rm -rf ${plan.scratch}` : `kept at ${plan.scratch}  ${dim("(--all to remove)")}`],
  ];

  if (flags["dry-run"]) {
    say("");
    say(`${dim("dry run")} nothing below has been done`);
    say("");
    table(["Would stop", ...actions]);
    say("");
    say(`  ${dim("not")} --remove-orphans. From another compose file every container in a`);
    say(`  ${dim("   ")} shared project is an orphan.`);
    say("");
    return emit({ dryRun: true, actions });
  }

  await stopPid(held.run?.rendererPid);
  await stopPid(held.run?.serverPid);
  let composed = "skipped";
  if (existsSync(plan.compose)) {
    try {
      await compose(plan, "down", "-v");
      composed = "removed";
    } catch (error) {
      composed = `failed: ${String(error.stderr ?? error.message).trim().split("\n").pop()}`;
    }
  }
  if (flags.all) rmSync(plan.scratch, { recursive: true, force: true });

  say("");
  table([
    "Stopped",
    ["pids", [held.run?.serverPid, held.run?.rendererPid].filter(Boolean).join(", ") || "none recorded"],
    ["compose", `${plan.project}: ${composed}`],
    ["scratch", flags.all ? "removed" : plan.scratch],
  ]);
  say("");
  return emit({ stopped: true, project: plan.project, compose: composed });
}

/* ---------- helpers ---------- */

async function ownsPostgres(plan) {
  try {
    const { stdout } = await run("docker", [
      "ps",
      "--filter",
      `label=com.docker.compose.project=${plan.project}`,
      "--format",
      "{{.Names}} {{.Ports}}",
    ]);
    return stdout.includes(`:${plan.postgres.value}->`);
  } catch {
    /* Docker itself not answering is a thing that went wrong, so it reads as
       not-mine rather than as permission. */
    return false;
  }
}

async function stopPid(pid) {
  if (!pid || !alive(pid)) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone between the check and the signal */
    }
  }
  return true;
}

async function waitFor(get, ok, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const answer = await get();
    if (ok(answer)) return answer;
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function lastLines(file, n) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-n);
  } catch {
    return [];
  }
}

export function lockable(plan) {
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
    server: serverUrl(plan),
  };
}
