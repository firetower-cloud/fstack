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
import { databaseUrl, serverUrl, newPassword } from "./key.mjs";
import { readLock, writeLock, updateLock, verdict, listening, probe, alive, mayStop, password, PHASE } from "./own.mjs";
import { signIn, raw, refuse } from "./api.mjs";
import { EXIT, fail, emit, say, step, done, note, table, dim } from "./out.mjs";

const run = promisify(execFile);
const STEPS = 6;
/**
 * `up --first-run` stops after four of them, deliberately.
 *
 * Steps 4 and 6 are the two that clear the first-run gates, so an instance
 * that has had them done cannot show either screen. A run that wants to drive
 * the forced password change or the setup wizard needs an instance that has
 * not: build, Postgres, a server with a seeded administrator, and a token.
 * Nothing else. firetower#336 is why this exists — those two journeys were
 * exercised by nothing in the checkout.
 */
const FIRST_RUN_STEPS = 4;

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

export function serverEnv(plan, { adminPassword } = {}) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl(plan),
    FIRETOWER_HOME: plan.home,
    FIRETOWER_PUBLIC_URL: `http://127.0.0.1:${plan.renderer.value}`,
    /**
     * Only for `up --first-run`: seed the first administrator's password
     * instead of inventing one and printing it.
     *
     * `ensure_admin` (crates/ft-server/src/lib.rs:383-427) takes it when no
     * user exists yet and ignores it afterwards, and either way the account
     * is created with `must_change_password` set
     * (`accounts.rs:193-201`) — "a credential that came out of a file cannot
     * quietly become the permanent one". So this makes the forced password
     * change *reachable* rather than skipping it, and it is the unattended
     * route: the invented password is written to the server's stderr and
     * would have to be scraped back out of a log file.
     */
    ...(adminPassword ? { ADMIN_INITIAL_PASSWORD: adminPassword, ADMIN_USERNAME: "admin" } : {}),
  };
}

const binary = (plan) => path.join(plan.checkout, "target", "debug", "firetower");

/** The arguments `up` serves with. One place, because teardown compares against them. */
const serveArgs = (plan) => ["serve", "--dev", "--port", String(plan.control.value), "--bind", "127.0.0.1"];

/**
 * The exact command line this plan's server runs as.
 *
 * Derived from the plan rather than read from the lock, and that is the
 * point: it is what makes the lock's `serverPid` unforgeable. Teardown
 * requires the lock's recorded command line to equal this *and* the operating
 * system to agree that the pid is running it. A hand-edited lock naming the
 * host's own control plane fails the first test — this host's plane runs
 * `target/debug/firetower serve --dev`, from a different checkout and with no
 * explicit port, so it cannot match a string containing this run's absolute
 * binary path and this run's derived port.
 */
export const serverCommand = (plan) => [binary(plan), ...serveArgs(plan)].join(" ");

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
  const firstRun = Boolean(flags["first-run"]);
  const total = firstRun ? FIRST_RUN_STEPS : STEPS;
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
    /* The lines differ by cause, because they used to not: a `probe-failed`
       refusal told the reader that "something is already on this run's
       derived control-plane port" while its own reason line said
       ECONNREFUSED and `lsof` showed the port free. An agent then goes
       looking for a process that is not there. */
    return refuse(seen, whyUpRefused(seen, plan));
  }
  /* A `claimed` instance is this run's own, answering, and deliberately
     unprepared. Binding the port again would spawn a second server that
     cannot have it and then report that the server never answered, so this
     says what is actually there instead — which is the state `--first-run`
     leaves behind, and the one its journeys need. */
  if (seen.verdict === "claimed") {
    const held = readLock(plan).run ?? {};
    say("");
    say(`${dim("already up, with its gates standing")} ${seen.at} is this run's by claim`);
    say("");
    table([
      "This instance",
      ["phase", `${held.phase}  ${dim("/bootstrap has no serverId until the organisation is named")}`],
      ["first run", held.firstRun ? "yes — both gates stand" : dim("not recorded as a first-run instance")],
      ["server pid", String(held.serverPid ?? "-")],
    ]);
    say("");
    say("  Drive the journeys that need it, or start the run over:");
    say("    control-firetower drive act replace-the-temporary-password");
    say("    control-firetower drive act name-this-firetower");
    say("    control-firetower down && control-firetower up");
    say("");
    return emit({ already: true, instance: seen, firstRun: Boolean(held.firstRun) }, EXIT.ok);
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
      ...(firstRun
        ? [
            ["  env", `ADMIN_INITIAL_PASSWORD=${dim("24 random bytes, written only to the run lock")}`],
            ["4 login", `POST ${serverUrl(plan)}/api/v1/auth/login  ${dim("a token, and 403 on every other route")}`],
            ["not run", dim("passwd admin — so must_change_password still stands")],
            ["not run", dim("/setup/organization and /setup/complete — so the wizard still stands")],
            ["then", "phase claimed, firstRun recorded. There is no serverId to record until the organisation is named"],
          ]
        : [
            ["4 passwd", `firetower passwd admin  ${dim("(password piped on stdin)")}`],
            ["5 login", `POST ${serverUrl(plan)}/api/v1/auth/login`],
            ["6 setup", `POST /api/v1/setup/organization, POST /api/v1/setup/complete`],
            ["then", "record /bootstrap's serverId in the run lock"],
          ]),
    ]);
    say("");
    return emit({ dryRun: true, plan: lockable(plan) });
  }

  writeFileSync(plan.compose, composeFile(plan));
  /**
   * The lock is written before step 1, and `server` deliberately is not.
   *
   * The lock has to exist from the start: it records the Compose project and
   * the ports, and without it a `down` after a failed build has nothing to
   * tear down. But `server` used to be written here too, so a build that
   * failed left a lock claiming a control plane at an address nothing had
   * ever listened on. `claimed` is defined as *this run bound a silent port
   * and its child is alive*, and in that state there was no child — the next
   * `up` read the recorded address as `probe-failed` and refused until `down`
   * was run.
   *
   * So the address is recorded at step 3, by the code that started something,
   * once it has answered. Nothing claims a server before there is one.
   */
  writeLock(plan, {
    key: plan.key,
    startedAt: new Date().toISOString(),
    phase: PHASE.claimed,
    checkout: plan.checkout,
    ports: { control: plan.control.value, postgres: plan.postgres.value, renderer: plan.renderer.value },
    project: plan.project,
    home: plan.home,
    session: plan.session,
    serverId: null,
    firstRun,
    evidence: [],
    posted: [],
  });

  /* 1 — build */
  step(1, total, "cargo build -p ft-cli");
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
  step(2, total, `docker compose -p ${plan.project} up -d postgres`);
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
  step(3, total, `firetower serve --dev --port ${plan.control.value}`);
  at = Date.now();
  mkdirSync(plan.home, { recursive: true, mode: 0o700 });
  const out = openSync(path.join(plan.logs, "server.out"), "a");
  const err = openSync(path.join(plan.logs, "server.err"), "a");
  /* The seeded administrator, for `--first-run` only. Generated the way step
     4 generates one and written only to the run lock, so the credential this
     run drives with is still not derivable from anything that is printed. */
  const seeded = firstRun ? newPassword() : null;
  if (seeded) updateLock(plan, { adminPassword: seeded });
  const server = spawn(binary(plan), serveArgs(plan), {
    cwd: plan.checkout,
    env: serverEnv(plan, { adminPassword: seeded }),
    detached: true,
    stdio: ["ignore", out, err],
  });
  /**
   * A spawn that never started.
   *
   * `child_process` reports this as an `error` event on a later tick, and with
   * no listener Node turns it into an uncaught exception: a raw stack trace,
   * and an exit code that is not one of the six this CLI documents. An agent
   * branching on status reads whatever that happens to be as a verdict about
   * Firetower. So it is caught, and it becomes an ordinary refusal that names
   * the binary and what to do — which is what every other failure here does.
   */
  let unstarted = null;
  server.once("error", (error) => {
    unstarted = error;
  });
  server.unref();
  /* The command line goes in beside the pid. A pid alone is a number
     somebody wrote down, and pids are recycled; teardown checks both. */
  /* And the address, here rather than before step 1: there is now a child
     process bound to it, which is exactly what `claimed` asserts. Recorded
     before the probe rather than after, so that a server which starts and
     then never answers is `probe-failed` — a thing that went wrong, with
     `down` named — instead of reading as a port nobody ever touched. */
  updateLock(plan, {
    server: serverUrl(plan),
    serverPid: server.pid,
    serverCommand: serverCommand(plan),
    serverStartedAt: new Date().toISOString(),
  });

  const answered = await waitFor(() => probe(serverUrl(plan)), (a) => a.reachable, 40_000, () => unstarted);
  if (unstarted) {
    return fail(EXIT.failed, {
      problem: `ft-server could not be started: ${unstarted.message}`,
      because: [
        `the binary this run expected is ${binary(plan)}`,
        `it was spawned with the checkout as its working directory (${plan.checkout})`,
        unstarted.code === "ENOENT"
          ? "ENOENT means that path does not exist from there"
          : `the system said ${unstarted.code ?? "nothing more"}`,
      ],
      instead: [
        `cd ${plan.checkout} && cargo build -p ft-cli    build it`,
        "control-firetower up --rebuild                 build it as part of coming up",
        "control-firetower down                         clear the lock this attempt wrote",
        "",
        "If you passed --checkout, it is resolved to an absolute path before anything is",
        "spawned, so this is about the binary rather than about the path.",
      ],
      detail: { cause: "server-unstarted", binary: binary(plan), code: unstarted.code ?? null },
    });
  }
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

  /* `--first-run` stops here, which is the whole point of it: steps 4 and 6
     are what clear the two gates, so an instance that wants to show them has
     to not have had them. One login, so the credential is proven to work and
     `doctor` has a token to ask /setup with — and the 403 it gets back is
     itself the readback for the forced password change. */
  if (firstRun) {
    step(4, total, "POST /api/v1/auth/login");
    at = Date.now();
    const got = await signIn(plan);
    if (!got.ok) {
      return fail(EXIT.failed, {
        problem: `signing in as the seeded administrator answered ${got.status}`,
        because: [
          JSON.stringify(got.body),
          "ADMIN_INITIAL_PASSWORD is read by ensure_admin only while no user exists (lib.rs:383-391), so a database that already had one ignored it",
        ],
        instead: [
          "control-firetower down --all     end this run and its database",
          "control-firetower up --first-run  a fresh database seeds the administrator again",
          "",
          "`reset --first-run` is the cheap route: it drops the database and comes back",
          "here in about 3s.",
        ],
      });
    }
    done(`signed in as ${got.user?.username ?? "admin"}`, Date.now() - at);
    updateLock(plan, { firstRun: true });

    say("");
    table([
      "Up, and deliberately unprepared",
      ["phase", `${PHASE.claimed}  ${dim("owned by having bound a silent port, not by a serverId")}`],
      ["control plane", serverUrl(plan)],
      ["administrator", `admin  ${dim("must_change_password is set: every other authenticated route answers 403")}`],
      ["organisation", dim("unnamed, so /bootstrap has no serverId and the desktop draws the setup wizard")],
      ["renderer", await rendererLine(plan)],
      ["run lock", plan.lock],
    ]);
    say("");
    say(`  ${dim("the two journeys nothing else in the checkout exercises")}`);
    say("    control-firetower drive act replace-the-temporary-password");
    say("    control-firetower drive act name-this-firetower");
    say("");
    say(`  ${dim("each is one-shot: it clears the gate it is about. reset --first-run makes another instance.")}`);
    say("");
    return emit({ firstRun: true, phase: PHASE.claimed, server: serverUrl(plan), plan: lockable(plan) });
  }

  /* 4 — the forced password change, cleared in the same statement */
  step(4, total, "firetower passwd admin");
  at = Date.now();
  /* Generated here, kept only in the lock, never derived from anything that
     is printed or published — see newPassword() in key.mjs. */
  const chosen = newPassword();
  updateLock(plan, { adminPassword: chosen });
  try {
    await passwd(plan, chosen);
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
  note(`the administrator password is random per run and lives only in ${plan.lock}`);

  /* 5 — a token */
  step(5, total, "POST /api/v1/auth/login");
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
  step(6, total, "POST /api/v1/setup/organization, POST /api/v1/setup/complete");
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
    ["renderer", await rendererLine(plan)],
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
export function passwd(plan, chosen) {
  const pw = chosen ?? password(plan);
  if (!pw) {
    return Promise.reject(
      Object.assign(new Error("no administrator password is recorded for this run"), {
        stderr: "The password is random per run and lives only in the run lock. It is never derived, so it cannot be recomputed: bring the run up again.",
      }),
    );
  }
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
      detail: { cause: held.state === "absent" ? "nothing-recorded" : "unreadable-lock" },
    });
  }
  if (held.run.phase === PHASE.stopped) {
    return fail(EXIT.precondition, {
      problem: "this run has been torn down, so there is no data to put back",
      because: [
        `${plan.lock} is in phase "${PHASE.stopped}": \`down\` stopped the server and cleared the address and serverId it had recorded`,
        "reset drops and recreates this run's database and then redoes steps 3 to 6 — all of which needs a stack to be up",
      ],
      instead: [
        "control-firetower up        start again from a stopped run; this is the ordinary path",
        "",
        "A stopped run is a legitimate state to start again from rather than a wedge:",
        "nothing is recorded, so nothing is owned, and `up` may bind the port.",
      ],
      detail: { cause: "nothing-recorded", phase: held.run.phase },
    });
  }
  const seen = await verdict(plan);
  /**
   * `claimed` resets, and that is the phase `up --first-run` leaves behind.
   *
   * This used to accept `mine` and `nothing-here` only, so
   * `reset --first-run` refused from the one phase it is most wanted in —
   * `forced-password-change.md`'s first driving row is *"make an instance that
   * has never been through this → `control-firetower reset --first-run`"*, and
   * `up --first-run`'s own last line says `reset --first-run` makes another
   * one. Neither was true: a sweep needing a second first-run instance had to
   * `down` and `up` again, paying the whole start-up cost for it.
   *
   * **Allowing it does not weaken the guard on the destructive half.** What
   * authorises stopping the server is not the verdict: it is `stopPid` below,
   * which refuses unless `ps` agrees the recorded pid is running exactly the
   * command line this run launched. That check is unchanged, and in `claimed`
   * it is the *same* fact ownership already rests on — this run bound a silent
   * port and its own child is still alive. The database being dropped is this
   * run's own, in its own Compose project, named explicitly.
   */
  if (seen.verdict !== "mine" && seen.verdict !== "claimed" && seen.verdict !== "nothing-here") {
    return refuse(seen);
  }

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
  const halted = await stopPid(plan, held.run.serverPid, held.run.serverCommand, serverCommand(plan));
  if (halted.refused) return refusedPid(plan, halted, "reset");
  done(halted.stopped ? "stopped" : halted.why, 0);

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

  /* The administrator password is rotated here, not carried over. The old one
     was handed to a server whose database has just been dropped, and a
     credential that outlives the data it guarded is a credential nobody is
     tracking. `up` generates the replacement at step 4.
   *
     And `server` is cleared along with `serverId`, which is the same
     transition `down` makes and for the same reason: the server has been
     stopped, so the recorded address no longer answers. Leaving it set made
     the `up` below read its own stopped server as `probe-failed` and refuse
     — `reset` dropped the database and then would not restart, which is the
     second half of the deadlock. Found by running the acceptance path rather
     than by reading it. */
  writeLock(plan, {
    ...held.run,
    phase: PHASE.stopped,
    stoppedAt: new Date().toISOString(),
    server: null,
    serverId: null,
    serverPid: null,
    serverCommand: null,
    serverStartedAt: null,
    token: null,
    adminPassword: null,
    organization: null,
  });
  const again = await up({ ...plan }, { ...flags, rebuild: false });
  return again;
}

/**
 * The renderer line, asked rather than asserted.
 *
 * This said `not started` unconditionally — including on a `reset`, which
 * reaches this summary through `up` and does not touch the renderer at all.
 * So a run with Vite happily serving was told its renderer was not started,
 * three seconds after `doctor` had reported it answering. A line that states
 * something checkable without checking it is the same class of defect as a
 * stale citation.
 */
async function rendererLine(plan) {
  if (await listening(plan.renderer.value)) {
    return `answering on http://localhost:${plan.renderer.value}  ${dim("already running; nothing here starts or stops it")}`;
  }
  return `not started. cd ${path.join(plan.checkout, "desktop")} && pnpm exec vite --port ${plan.renderer.value} --strictPort`;
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
      detail: { cause: "unreadable-lock" },
    });
  }

  /* A MISSING lock is a refusal too, and this is the half of the rule that
     was missing. An unreadable lock was refused; an absent one derived the
     Compose project from the key, removed the project and its volume, exited
     0 — and left the ft-server it had no pid for still holding the port. The
     rule "every unknown reads as not mine" was being applied to reading and
     not to destroying, and destroying is the half that cannot be undone. */
  if (held.state === "absent") {
    return fail(EXIT.notMine, {
      problem: "there is no run lock, so there is no record of anything for this run to stop",
      because: [
        `nothing at ${plan.lock}`,
        `the Compose project name and the volume can be derived from the isolation key, but "I can work out a name" is not "I started it"`,
        "a `down` that tears down a project it has no record of starting is a destructive guess",
      ],
      instead: [
        "Look first, then act explicitly on what you find:",
        "",
        `docker compose -p ${plan.project} ps                      what is in this run's project`,
        `lsof -nP -iTCP:${plan.control.value} -sTCP:LISTEN                  what holds the control-plane port`,
        "",
        "If both are this run's and you still want them gone, say so explicitly:",
        "",
        `docker compose -p ${plan.project} -f ${plan.compose} down -v`,
        "kill <the pid lsof printed>                        by pid, after you have read what it is",
        "",
        "Never `pkill -f firetower`: it kills the :4400 control plane hosting this session.",
      ],
      detail: { cause: "nothing-recorded" },
    });
  }

  const unposted = (held.run?.evidence ?? []).filter((e) => !e.postedAt);
  if (unposted.length && !flags.force && !flags["dry-run"]) {
    return fail(EXIT.evidence, {
      problem: unposted.length === 1
        ? "a capture has not been posted, and tearing down loses the proof"
        : `${unposted.length} captures have not been posted, and tearing down loses the proof`,
      because: [
        "durability comes from having posted, not from a directory: the whole workspace is",
        "deleted when this session ends, and the stack a side effect would be read back from",
        "goes first.",
        ...unposted.map((e) => `  ${e.name}  ${e.screenshot ?? e.snapshot ?? "(no file recorded)"}`),
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

  /* Asked before anything is signalled, and printed by --dry-run, because
     the dry run is what a careful operator reads first. It used to print
     `kill 98102` — this host's own control plane — from a stale lock, which
     is a dry run that reads as permission. */
  const serverStop = checkStop(plan, held.run?.serverPid, held.run?.serverCommand, serverCommand(plan));
  const rendererStop = checkStop(plan, held.run?.rendererPid, held.run?.rendererCommand, null);

  const actions = [
    ["pid", describeStop("server", held.run?.serverPid, serverStop)],
    ["pid", describeStop("renderer", held.run?.rendererPid, rendererStop)],
    ["compose", `docker compose -p ${plan.project} -f ${plan.compose} down -v`],
    ["scratch", flags.all ? `rm -rf ${plan.scratch}` : `kept at ${plan.scratch}  ${dim("(--all to remove)")}`],
    ["lock", flags.all ? "removed with the scratch root" : `serverId and server address cleared, phase -> ${PHASE.stopped}`],
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

  /* A pid that cannot be positively identified as this run's is not
     signalled, and that is a refusal rather than a skip: a lock naming
     somebody else's process is a lock that has been tampered with or has gone
     stale, and acting on the rest of it is not safe either. */
  if (serverStop.refused) return refusedPid(plan, serverStop, "down");
  if (rendererStop.refused) return refusedPid(plan, rendererStop, "down");

  const stoppedRenderer = await stopPid(plan, held.run?.rendererPid, held.run?.rendererCommand, null);
  const stoppedServer = await stopPid(plan, held.run?.serverPid, held.run?.serverCommand, serverCommand(plan));
  let composed = "skipped";
  if (existsSync(plan.compose)) {
    try {
      await compose(plan, "down", "-v");
      composed = "removed";
    } catch (error) {
      composed = `failed: ${String(error.stderr ?? error.message).trim().split("\n").pop()}`;
    }
  }
  /* The transition that used to be missing, and the whole of defect D1. The
     lock kept the dead serverId and address, so the next `up` compared a
     recorded id against a silent port, read that as *not mine* and refused —
     permanently, with no documented escape. Clearing them puts the run back
     into "nothing recorded", which is a state `up` may legitimately start
     from. See PHASE in own.mjs for the whole machine. */
  if (flags.all) {
    rmSync(plan.scratch, { recursive: true, force: true });
  } else {
    writeLock(plan, {
      ...held.run,
      phase: PHASE.stopped,
      stoppedAt: new Date().toISOString(),
      server: null,
      serverId: null,
      serverPid: null,
      serverCommand: null,
      serverStartedAt: null,
      rendererPid: null,
      rendererCommand: null,
      token: null,
      adminPassword: null,
      organization: null,
    });
  }

  say("");
  table([
    "Stopped",
    ["pids", [stoppedServer, stoppedRenderer].filter((p) => p.stopped).map((p) => p.pid).join(", ") || "none signalled"],
    ["compose", `${plan.project}: ${composed}`],
    ["scratch", flags.all ? "removed" : plan.scratch],
    ["lock", flags.all ? "removed" : `phase ${PHASE.stopped}: nothing recorded, so \`up\` can start this run again`],
  ]);
  say("");
  say(`  ${dim("next")} ${flags.all ? "nothing. This run is finished." : "control-firetower up   starts it again on the same ports"}`);
  say("");
  return emit({
    stopped: true,
    project: plan.project,
    compose: composed,
    pids: { server: stoppedServer, renderer: stoppedRenderer },
    phase: flags.all ? null : PHASE.stopped,
  });
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

/**
 * May this pid be signalled, and why — asked before anything is sent.
 *
 * Three gates, all positive, because `if (!pid || !alive(pid))` was none of
 * them. `-1` is truthy and `process.kill(-1, 0)` succeeds — it is the "every
 * process you may signal" group — so a lock with `serverPid: -1` reached
 * `process.kill(-1, "SIGTERM")`, which on this host is every session on it
 * plus the control plane hosting the session doing the signalling.
 *
 *   1  a pid is a positive integer. Enforced by the lock schema too
 *   2  the lock's recorded command line must be the one THIS PLAN would have
 *      launched. The lock cannot nominate a target of its own
 *   3  the operating system must agree the pid is running that command line.
 *      Liveness is not identity, and pids are recycled
 */
function checkStop(plan, pid, recorded, expected) {
  if (pid === null || pid === undefined) return { pid: null, nothing: true, why: "no pid recorded" };
  if (expected !== null && recorded !== expected) {
    return {
      pid,
      refused: true,
      why: recorded
        ? `the lock records pid ${pid} as "${recorded}", and this plan's server is "${expected}"`
        : `the lock records pid ${pid} with no command line, so there is nothing to identify it by`,
      expected,
      recorded: recorded ?? null,
    };
  }
  const may = mayStop(pid, recorded ?? expected);
  if (may.gone) return { pid, gone: true, why: may.why };
  if (!may.ok) return { pid, refused: true, why: may.why, found: may.found, expected: recorded ?? expected };
  return { pid, mayStop: true, why: may.why, found: may.found };
}

function describeStop(what, pid, checked) {
  if (checked.nothing) return `no ${what} pid recorded`;
  if (checked.gone) return `${pid}: ${checked.why} — nothing to signal`;
  if (checked.refused) return `WOULD NOT SIGNAL ${pid} — ${checked.why}`;
  return `kill ${pid}  ${dim(`(${checked.found?.command ?? "identified"})`)}`;
}

function refusedPid(plan, checked, command) {
  return fail(EXIT.notMine, {
    problem: `the pid in this run's lock is not a process this run may signal`,
    because: [
      checked.why,
      "liveness is not identity: a pid is a number somebody wrote down, and the operating system recycles them",
      `on this host pid 98102 is the developer's own control plane, and it is what hosts this session`,
    ],
    instead: [
      `cat ${plan.lock}                     read what it claims`,
      `ps -ww -o lstart=,command= -p ${checked.pid}   read what that pid actually is`,
      "",
      "If the lock is stale, remove it and start again — nothing is recorded, so nothing",
      "is owned:",
      "",
      `rm ${plan.lock}`,
      "control-firetower up",
      "",
      `Do not raise the pid by hand and re-run \`${command}\`. Never \`pkill -f firetower\`.`,
    ],
    detail: { cause: "unreadable-lock", pid: checked.pid, running: checked.found?.command ?? null, expected: checked.expected ?? null },
  });
}

/**
 * Stop one pid this run positively identified as its own. Nothing else.
 *
 * SIGTERM, wait, SIGKILL — and `alive()` between them, which is a liveness
 * question about a pid already proven to be ours. The identity check is
 * `checkStop` and it has already run by the time this is called.
 */
async function stopPid(plan, pid, recorded, expected) {
  const checked = checkStop(plan, pid, recorded, expected);
  if (!checked.mayStop) return { ...checked, stopped: false };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { ...checked, stopped: false, why: "it exited between the check and the signal" };
  }
  for (let i = 0; i < 40 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
  if (alive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone between the check and the signal */
    }
  }
  return { ...checked, stopped: true };
}

/** Why `up` refused, in the words of the cause rather than one guess for all of them. */
function whyUpRefused(seen, plan) {
  if (seen.cause === "probe-failed") {
    return [
      `This run recorded a server at ${seen.at} and nothing is answering there now.`,
      "Nothing is holding the port — the probe got " + (seen.answer?.why ?? "no answer") + ", not a refusal to",
      "identify itself. The record is what is stale, not the port.",
      "",
      "control-firetower down          clears the recorded server and leaves the run startable",
      "",
    ];
  }
  if (seen.cause === "nothing-recorded" || seen.cause === "no-lock") {
    return [
      `Something is already answering on ${seen.at} and this run has recorded no serverId`,
      "for it, so there is nothing that could make it this run's. That is an instance to",
      "leave alone, not one to adopt.",
      "",
    ];
  }
  if (seen.cause === "unreadable-lock") {
    return [
      `The run lock at ${plan.lock} will not read, so what this run started is unknown.`,
      "An unknown is not an empty record.",
      "",
    ];
  }
  return [
    `A different Firetower is answering on ${seen.at} than the one this run recorded.`,
    "That is an instance to leave alone, not one to adopt.",
    "",
  ];
}

/**
 * Poll until something is true, or give up.
 *
 * `giveUp` is a second exit: a predicate asked each time round that means
 * "stop waiting, this is never going to happen". `up` passes the spawn's own
 * `error` event through it, so a binary that could not be started is reported
 * in a second instead of after the full 40-second timeout for a server that
 * started and stayed quiet. The two are different failures and the operator
 * is told which.
 */
async function waitFor(get, ok, ms, giveUp = () => false) {
  const until = Date.now() + ms;
  for (;;) {
    if (giveUp()) return null;
    const answer = await get();
    if (ok(answer)) return answer;
    if (Date.now() > until || giveUp()) return null;
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
