/**
 * The frontend transport: the desktop app, in Chrome, against a real server.
 *
 * `playwright-core` with `chromium.launch({ channel: "chrome" })` against the
 * desktop's own Vite renderer, pointed at this run's ft-server. The app
 * renders in an ordinary tab on purpose — `desktop/src/bridge.ts` exists for
 * exactly that — and typing an address into the first screen is the
 * production first-run journey rather than a test hook.
 *
 * **CDP against the real Tauri shell is not available on macOS.** Tauri v2
 * uses WKWebView and `tauri-driver` is Windows/Linux only, so the shell
 * transport is a WebdriverIO run in CI with a per-OS driver provider
 * (firetower#338) — a workflow leg, not a library call in a session. This
 * file will not pretend to launch it: `--target shell` is refused, with
 * where that evidence actually lives.
 *
 * Every capture is an action *and* the state it produced, plus an
 * accessibility snapshot, because a screenshot verifies layout and never a
 * value.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { verdict, listening, password, readLock, updateLock, probe, PHASE } from "./own.mjs";
import { refuse, raw, signIn } from "./api.mjs";
import { newPassword, serverUrl } from "./key.mjs";
import { record } from "./evidence.mjs";
import { runSecrets, sanitiseCapture } from "./redact.mjs";
import { VIEWPORT, SCALE, SIGNIN, GATES, STATES, GESTURES, NOT_WHAT_THEY_SAY, FIRST_RUN, OFFSTAGE } from "./vocabulary.mjs";
import { EXIT, emit, fail, say, table, dim, step, done, tick, cross, warn } from "./out.mjs";

const require = createRequire(import.meta.url);

export async function drive(plan, argv, flags) {
  const sub = argv[0];

  if (flags.target && flags.target !== "frontend") {
    return fail(EXIT.cannotProve, {
      problem: `--target ${flags.target} is not a transport this binary has`,
      because: [
        "the shell transport is a WebdriverIO run with a per-OS driver provider, invoked by",
        "CI on three platforms — 'official' (tauri-driver) on Windows and Linux, 'embedded'",
        "on macOS, which has no alternative. It is a workflow leg, not a library call, and",
        "the macOS leg needs a binary built with a non-default Cargo feature, which is a",
        "different binary from the one the release matrix ships (firetower#338).",
      ],
      instead: [
        "control-firetower limits --target shell      what that route adds and still cannot prove",
        "",
        "Its evidence comes from .github/workflows/desktop.yml, as an artifact beside the",
        "installer. Read it there; this CLI reports what it does not cover and never",
        "launches it. --target frontend is the only transport here.",
      ],
    });
  }

  switch (sub) {
    case "states":
      return listStates(flags);
    case "open":
      return capture(plan, { state: argv[1], gesture: null }, flags);
    case "act":
      return capture(plan, { state: null, gesture: argv[1] }, flags);
    case "signin":
      return capture(plan, { state: "home", gesture: null, signinOnly: true }, flags);
    case "audit":
      return audit(plan, flags);
    default:
      return fail(EXIT.usage, {
        problem: sub ? `drive has no subcommand "${sub}"` : "drive needs a subcommand",
        because: ["the subcommands are states, audit, open, act and signin"],
        instead: [
          "control-firetower drive states          what can be driven, and from where each selector came",
          "control-firetower drive audit           drive every handle and say which ones still match",
          "control-firetower drive open tasks      go there and capture it",
          "control-firetower drive --help",
        ],
      });
  }
}

function listStates(flags) {
  if (flags.json) {
    return emit({
      viewport: VIEWPORT,
      scale: SCALE,
      signin: SIGNIN,
      gates: GATES,
      states: STATES,
      gestures: GESTURES,
      firstRun: FIRST_RUN,
      offstage: OFFSTAGE,
      notWhatTheySay: NOT_WHAT_THEY_SAY,
      provenance: "copied from desktop/scripts/states.mjs and desktop/e2e/cursor-live.mjs; each entry carries its origin",
    });
  }
  say("");
  say(`  ${dim("states")} ${dim("hash paths, behind the desktop's hash router")}`);
  table(Object.entries(STATES).map(([name, s]) => [name, `#${s.path}  ${describeHandle(s.landmark)}  ${dim(`verified ${s.verified} — ${s.from}`)}`]));
  say("");
  say(`  ${dim("gestures")}`);
  table(Object.entries(GESTURES).map(([name, g]) => [name, `at ${g.at} — ${g.does}  ${dim(`verified ${g.verified} — ${g.from}`)}`]));
  say("");
  say(`  ${dim("first-run journeys")} ${dim("driven from the renderer's root, with nothing remembered")}`);
  table(
    Object.entries(FIRST_RUN).map(([name, j]) => [
      name,
      `${j.does} — ends at ${describeHandle(j.then)}  ${dim(`needs ${j.needs === "first-run" ? "an instance with its gates standing" : "either instance"} — verified ${j.verified}`)}`,
    ]),
  );
  say("");
  say(`  ${dim("routes that are not the screen their name suggests")}`);
  table(NOT_WHAT_THEY_SAY.map((r) => [r.path, `lands on ${r.lands} — ${r.note}`]));
  say("");
  say(`  ${dim("sign-in")} copied from desktop/e2e/cursor-live.mjs:28-34, which drives a real server`);
  table(Object.entries(SIGNIN).map(([name, s]) => [name, `${describeHandle(s)}  ${dim(s.from)}`]));
  say("");
  say(`  ${dim("gates — asserted absent; verified once against an unprepared instance")}`);
  table(GATES.map((g) => [g.landmark.name, `${g.name}  ${dim(`verified ${g.verified}`)}`]));
  say("");
  say("  These are COPIES. The bundle is self-contained, so it cannot import them, and");
  say("  they can drift from the app. The origin beside each one is what makes a drift");
  say("  traceable — diff them against the checkout when a selector stops matching.");
  say("");
  return emit({ states: Object.keys(STATES), gestures: Object.keys(GESTURES), journeys: Object.keys(FIRST_RUN) });
}

async function capture(plan, { state, gesture, signinOnly }, flags) {
  const journey = gesture ? (FIRST_RUN[gesture] ?? null) : null;
  const chosen = gesture && !journey ? GESTURES[gesture] : null;
  if (gesture && !chosen && !journey) {
    return fail(EXIT.usage, {
      problem: `there is nothing called "${gesture}" to act out`,
      because: [
        `the gestures are: ${Object.keys(GESTURES).join(", ")}`,
        `the first-run journeys are: ${Object.keys(FIRST_RUN).join(", ")}`,
      ],
      instead: ["control-firetower drive states          the whole vocabulary, with origins"],
    });
  }
  /* A journey starts at the renderer's own root, before any server is
     remembered, so it has no state to be "at". Everything else does. */
  const where = journey ? null : chosen ? chosen.at : (state ?? "home");
  if (where && !STATES[where]) {
    return fail(EXIT.usage, {
      problem: `there is no state called "${where}"`,
      because: [`the vocabulary has: ${Object.keys(STATES).join(", ")}`],
      instead: [
        "control-firetower drive states          the whole vocabulary, with origins",
        "",
        "A state this build cannot reach is the finding, not a reason to shoot the",
        "nearest screen — desktop/scripts/states.mjs:11-13.",
      ],
    });
  }

  const seen = await verdict(plan);
  if (seen.verdict === "nothing-here") {
    return fail(EXIT.precondition, {
      problem: `nothing is answering on ${seen.at}, so there is nothing to drive`,
      because: seen.reasons,
      instead: ["control-firetower up", "control-firetower up --first-run", "control-firetower doctor"],
    });
  }
  const allowed = mayDrive(plan, seen, journey);
  if (!allowed.ok) return allowed.exit;

  if (!password(plan)) return noPassword(plan);
  if (!(await listening(plan.renderer.value))) return noRenderer(plan);
  /* The address first, because an address this run cannot establish as its
     own is a refusal (exit 2) rather than a precondition (exit 4), and the
     two want different answers from whoever reads them. */
  if (chosen?.needs === "ssh-endpoint") {
    const endpoint = ownsEndpoint(plan, flags.at);
    if (!endpoint.ok) return refusedEndpoint(plan, gesture, endpoint);
  }
  if (chosen?.needs) {
    const missing = await whatItNeeds(plan, flags, chosen.needs);
    if (missing) {
      return fail(EXIT.precondition, {
        problem: `${gesture} cannot be driven against this instance: ${missing}`,
        because: [
          `the entry declares that it needs ${chosen.needs}`,
          "several entries describe an install in a particular state — an empty fleet, a bare repositories screen — and stop being true once something fills it",
          "driving one anyway produces a red row about a perfectly healthy app",
        ],
        instead: [
          "control-firetower reset        back to an empty install, about 3s",
          "control-firetower drive states  what each entry needs",
          "",
          "Or walk the sweep in the README's order, which puts the entries that describe",
          "an empty install before the ones that fill it.",
        ],
      });
    }
  }

  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    return noPlaywright();
  }
  return captureWith(chromium, plan, { state, gesture, signinOnly }, flags);
}

function noRenderer(plan) {
  return fail(EXIT.precondition, {
      problem: `the desktop renderer is not answering on localhost:${plan.renderer.value}`,
      because: [
        "the frontend transport drives the desktop's own Vite dev server, which this CLI",
        "does not start: the port is a flag only. desktop/vite.config.ts:15 hardcodes",
        "{ port: 5273, strictPort: true } and reads no environment variable.",
      ],
      instead: [
        `cd ${plan.checkout}/desktop && pnpm exec vite --port ${plan.renderer.value} --strictPort`,
        "",
        "`pnpm dev -- --port N` does NOT work here: pnpm 12 swallows the argument and vite",
        "binds its hardcoded 5273 instead, which is a port another session may own. Measured,",
        "not assumed. `pnpm exec vite` passes the flag through.",
        "",
        "strictPort failing rather than sliding to a free port is the behaviour you want:",
        "a renderer on an unexpected port is a run whose evidence names the wrong address.",
      ],
  });
}

/* The password is typed into the real sign-in form, so `drive` needs it for
   the same reason `api` does — and gets it the same way: out of the lock, or
   not at all. */
function noPassword(plan) {
  return fail(EXIT.precondition, {
    problem: "this run has no administrator password recorded, so the sign-in form cannot be filled in",
    because: [
      `nothing at adminPassword in ${plan.lock}`,
      "it is 24 random bytes generated by `up` at step 4 and kept only in the run lock: it is not derived from the isolation key, so it cannot be recomputed from anything",
    ],
    instead: [
      "control-firetower up            step 4 generates one and records it",
      "control-firetower doctor        says whether the administrator is usable",
    ],
  });
}

function noPlaywright() {
  return fail(EXIT.precondition, {
      problem: "playwright-core is not installed beside this skill",
      because: [
        "the bundle is self-contained: it has its own package.json and does not use the",
        "firetower checkout's pnpm tree.",
      ],
      instead: [
        `npm install --prefix ${path.dirname(new URL("..", import.meta.url).pathname)}`,
        "",
        "It also needs Google Chrome on this machine: the launch is",
        'chromium.launch({ channel: "chrome" }), the same channel desktop/scripts use.',
      ],
  });
}

/**
 * Which instance may this be driven against?
 *
 * Two positive ownership facts exist in this bundle, and they are not
 * interchangeable. `mine` is the recorded `serverId` answering. `claimed` is
 * "this run bound a silent port and its child is still running exactly the
 * command line this run launched" — which is what ownership has to rest on
 * between starting a server and naming its organisation, because
 * `/bootstrap` answers `serverId: null` until then by design
 * (crates/ft-server/src/api.rs:194-196, accounts.rs:117-128).
 *
 * The `claimed` window used to be `up`'s alone. It is now also where the two
 * first-run journeys live, because they are the journeys *about* that window:
 * `up`'s steps 4 and 6 exist to clear the gates they drive, so an instance
 * that can show them is by definition one with no serverId yet. Nothing is
 * loosened — a `claimed` verdict already requires the pid to be alive — and
 * an ordinary state or gesture is still refused there, because the app is
 * behind the gate and a capture of the door is not a capture of the feature.
 */
function mayDrive(plan, seen, journey) {
  const needs = journey?.needs ?? "prepared";
  const held = readLock(plan).run ?? {};

  if (seen.verdict === "claimed") {
    if (!journey) {
      return {
        ok: false,
        exit: fail(EXIT.precondition, {
          problem: "this instance is up with its first-run gates still standing, so the app is not on screen",
          because: [
            ...seen.reasons,
            held.firstRun
              ? "the run lock records it as a first-run instance: `up --first-run` did steps 1 to 3 and stopped"
              : "nothing in the run lock says this instance was prepared",
          ],
          instead: [
            "control-firetower drive act replace-the-temporary-password   the first gate, as a journey",
            "control-firetower drive act name-this-firetower              the second",
            "",
            "Then the app is reachable and every state is drivable. Or `down` and `up`",
            "without --first-run for an instance that starts past both gates.",
          ],
          detail: { cause: "first-run-gates-standing", phase: held.phase ?? null },
        }),
      };
    }
    return { ok: true };
  }

  if (seen.verdict !== "mine") return { ok: false, exit: refuse(seen) };

  if (needs === "first-run") {
    return {
      ok: false,
      exit: fail(EXIT.precondition, {
        problem: "this journey needs an instance that has not been prepared, and this one has been",
        because: [
          `${seen.at} answers as ${seen.recorded}, which means its organisation is named — so the setup wizard cannot be on screen`,
          "`up` clears both gates on purpose: step 4 clears must_change_password, step 6 finishes setup",
        ],
        instead: [
          "control-firetower reset --first-run   drop the database and come back unprepared, about 3s",
          "control-firetower down --all && control-firetower up --first-run",
          "",
          "Each first-run journey is one-shot: it clears the gate it is about, which is",
          "what makes it a proof rather than a screenshot.",
        ],
        detail: { cause: "already-prepared", needs },
      }),
    };
  }
  return { ok: true };
}

/**
 * An ssh endpoint `Add it` may be pressed against: a container this run started.
 *
 * Pressing `Add it` makes the **control plane** open an ssh connection to
 * whatever was typed, so the address is as much an action as a value. The
 * same rule as everywhere else in this bundle applies, for the same reason:
 * ownership is a positive assertion, and not knowing that an address is
 * somebody else's is not permission. So the port has to be published by a
 * container `docker ps` shows carrying this run's isolation key, and the
 * host has to be loopback.
 *
 * firetower#332 is the recipe this is for — an Alpine sshd container, which
 * it measured all the way to `state: "Online"` with a working worker.
 */
export function ownsEndpoint(plan, at, ps = dockerPs) {
  const parsed = /^(?:([^@\s]+)@)?(\[[0-9a-fA-F:]+\]|[^:\s]+):(\d{1,5})$/.exec(String(at ?? "").trim());
  if (!parsed) {
    return { ok: false, why: `--at has to be user@host:port, and it was ${JSON.stringify(at ?? null)}` };
  }
  const [, , host, port] = parsed;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    return {
      ok: false,
      why: `${host} is not loopback, and this run can only positively establish that it started something on its own machine`,
    };
  }
  let rows;
  try {
    rows = ps(plan);
  } catch (error) {
    return { ok: false, why: `docker ps could not be read (${error.message}), so nothing can be established` };
  }
  const found = rows.split("\n").find((row) => row.includes(`:${port}->`));
  if (!found) {
    return {
      ok: false,
      why: `no running container labelled com.firetower.session=${plan.session ?? plan.key} publishes port ${port}`,
    };
  }
  return { ok: true, container: found.split("\t")[0], at: String(at).trim() };
}

const dockerPs = (plan) =>
  execFileSync(
    "docker",
    ["ps", "--filter", `label=com.firetower.session=${plan.session ?? plan.key}`, "--format", "{{.Names}}\t{{.Ports}}"],
    { encoding: "utf8" },
  );

function refusedEndpoint(plan, gesture, endpoint) {
  return fail(EXIT.notMine, {
    problem: `${gesture} presses \`Add it\`, and ${JSON.stringify(endpoint.at ?? null)} is not an ssh endpoint this run started`,
    because: [
      endpoint.why,
      "`Add it` makes the control plane open an ssh connection to whatever is in the field, so the address is an action",
    ],
    instead: [
      "Stand one up, the way firetower#332 measured it:",
      "  docker run -d --label com.firetower.session=$FIRETOWER_SESSION -p <port>:22 <your sshd image>",
      "  control-firetower drive act add-this-runs-machine --at editor@127.0.0.1:<port>",
      "",
      "Two traps it recorded: Alpine's `adduser -D` leaves the account password-LOCKED",
      "and sshd refuses it even for key auth, and a rebuilt image answers with a new",
      "host key, which reads as HostKeyChanged.",
      "",
      "`drive act add-a-machine` needs none of this: it types an address and stops",
      "before the probe.",
    ],
    detail: { cause: "endpoint-not-mine", why: endpoint.why },
  });
}

async function captureWith(chromium, plan, { state, gesture, signinOnly }, flags) {
  const journey = gesture ? (FIRST_RUN[gesture] ?? null) : null;
  const chosen = gesture && !journey ? GESTURES[gesture] : null;
  const where = journey ? null : chosen ? chosen.at : (state ?? "home");
  const seen = await verdict(plan);
  /* Generated before anything is typed, so the value in the lock and the
     value on the screen are the same one. Nothing here is derived from the
     isolation key — see newPassword() in key.mjs. */
  const values = {
    "<server>": `127.0.0.1:${plan.control.value}`,
    "<password>": password(plan) ?? "",
    "<new-password>": newPassword(),
    "<organisation>": `Verify ${plan.key.slice(-8)}`,
    "<machine>": flags.at ?? "",
    "<remote>": flags.remote ?? "",
  };

  if (flags["dry-run"]) {
    say("");
    say(`${dim("dry run")} no browser has been opened`);
    say("");
    table(
      journey
        ? [
            "Would drive",
            ["renderer", rendererUrl(plan)],
            ["journey", `${gesture}: ${journey.does}`],
            ["from", `the renderer's own root, before any server is remembered  ${dim(journey.from)}`],
            ["needs", journey.needs === "first-run" ? "an instance with its gates standing (up --first-run)" : "either instance"],
            ["types in", `127.0.0.1:${plan.control.value}, admin, ${dim("this run's password, out of the run lock")}`],
            ...journey.steps
              .filter((action) => action.offstage)
              .map((action) => [
                "offstage",
                `${OFFSTAGE[action.offstage].what} — ${OFFSTAGE[action.offstage].how}  ${dim("this transport cannot drive it")}`,
              ]),
            ["ends at", describeHandle(resolve(journey.then, values))],
            ["capture", path.join(plan.evidence, `${flags.as ?? gesture}.png`)],
          ]
        : [
            "Would drive",
            ["renderer", rendererUrl(plan)],
            ["server typed in", `127.0.0.1:${plan.control.value}`],
            ["sign in as", "admin"],
            ["state", `#${STATES[where].path}  ${dim(STATES[where].from)}`],
            ...(chosen ? [["gesture", `${gesture}: ${chosen.does}`]] : []),
            ...(chosen?.needs === "ssh-endpoint" ? [["against", `${flags.at}  ${dim("checked against docker ps before anything is pressed")}`]] : []),
            ["capture", path.join(plan.evidence, `${flags.as ?? gesture ?? where}.png`)],
          ],
    );
    say("");
    return emit({ dryRun: true, state: where, gesture: gesture ?? null, journey: journey ? gesture : null });
  }

  mkdirSync(plan.evidence, { recursive: true });
  const name = flags.as ?? gesture ?? where;
  const started = Date.now();
  /* Two different things, kept apart because they mean different things. An
     uncaught exception means the page is broken and the capture is not
     evidence of anything — cursor-live.mjs asserts on exactly this and
     nothing else. A console error is worth recording and reading; a 404 for
     a font is not a reason to fail a run. */
  const thrown = [];
  const logged = [];
  const offstageDone = [];
  const alongside = [];
  const browser = await chromium.launch({ channel: "chrome", headless: !flags.headed });
  let result;
  let redacted = [];
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    page.on("pageerror", (error) => thrown.push(String(error.message ?? error)));
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });

    let at = Date.now();

    if (journey) {
      /* A journey is driven from the renderer's own root with nothing
         remembered, because that is where a person starts: the first screen
         is the address screen, and every step after it is on screen because
         the step before it worked. Nothing is seeded into localStorage and no
         gate is cleared behind the app's back — firetower#336 is about
         exactly that having been done by every harness there was. */
      step(1, 2, `${gesture}: ${journey.does}`);
      await page.goto(rendererUrl(plan), { waitUntil: "networkidle" });
      for (const action of journey.steps) {
        const outcome = await perform(page, action, values, { plan, page, alongside, evidence: plan.evidence, name });
        if (!outcome.ok) throw stumbled(outcome, gesture, journey);
        /* Recorded on the capture, not swallowed: a journey with a step this
           transport could not drive has to say so wherever it is read. */
        if (outcome.offstage) offstageDone.push(outcome.offstage);
      }
      if (journey.then && !(await present(page, resolve(journey.then, values)))) {
        throw stumbled(
          { why: `the journey ran and ${describeHandle(resolve(journey.then, values))} did not appear`, kind: "post-condition" },
          gesture,
          journey,
        );
      }
      done("done", Date.now() - at);
    } else {
      step(1, signinOnly ? 2 : 3, "sign in, the way a person does");
      await page.goto(rendererUrl(plan), { waitUntil: "networkidle" });
      await page.getByPlaceholder(SIGNIN.address.handle).fill(`127.0.0.1:${plan.control.value}`);
      await page.getByRole("button", { name: SIGNIN.connect.handle, exact: true }).click();
      await page.getByPlaceholder(SIGNIN.username.handle).fill("admin");
      await page.getByPlaceholder(SIGNIN.password.handle, { exact: true }).fill(password(plan));
      await page.getByRole("button", { name: SIGNIN.submit.handle }).click();
      await page.waitForTimeout(1500);
      done("signed in", Date.now() - at);

      /* The two gates cursor-live.mjs does not handle. `up` cleared both over
         the API; this asserts it rather than assuming it, because either one on
         screen means the capture is of the door and not of the feature. */
      for (const gate of GATES) {
        if (await present(page, gate.landmark)) {
          await page.screenshot({ path: path.join(plan.evidence, `${name}-gate.png`) });
          await browser.close();
          return fail(EXIT.precondition, {
            problem: `the app is showing ${gate.name}, not the application`,
            because: [`${describeHandle(gate.landmark)} is on screen — ${gate.from}`],
            instead: [
              "control-firetower api GET /setup      which step is outstanding",
              "control-firetower up                  steps 4 and 6 clear both gates",
              `control-firetower drive act ${gate.name === "the forced password change" ? "replace-the-temporary-password" : "name-this-firetower"}   drive it as the journey it is`,
              `A capture of this screen is at ${path.join(plan.evidence, `${name}-gate.png`)}`,
            ],
          });
        }
      }

      step(2, signinOnly ? 2 : 3, `go to #${STATES[where].path}`);
      at = Date.now();
      await page.goto(`${rendererUrl(plan)}/#${STATES[where].path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(STATES[where].settle);
      done(`at ${where}`, Date.now() - at);

      if (chosen) {
        step(3, 3, `${gesture}: ${chosen.does}`);
        at = Date.now();
        for (const action of chosen.steps) {
          const outcome = await perform(page, action, values, { plan, page });
          if (!outcome.ok) throw new Error(outcome.why);
        }
        if (chosen.then && !(await present(page, resolve(chosen.then, values)))) {
          throw new Error(`the gesture ran and its post-condition — ${describeHandle(chosen.then)} — did not appear`);
        }
        done("done", Date.now() - at);
      }
    }

    const screenshot = path.join(plan.evidence, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: Boolean(flags["full-page"]) });
    const snapshotText = await ariaSnapshot(page);
    const snapshot = path.join(plan.evidence, `${name}.aria.txt`);

    const command = `control-firetower drive ${gesture ? `act ${gesture}` : `open ${where}`}${flags.at ? ` --at ${flags.at}` : ""}${flags.remote ? ` --remote ${flags.remote}` : ""}${flags.as ? ` --as ${flags.as}` : ""}`;
    /* The side effect, read from somewhere other than the screen that claimed
       it — and for the first-run journeys, the record of what the journey
       changed about this run: the password it replaced, the organisation it
       named, the serverId that only exists once it has been. */
    const after = journey ? await settle(plan, gesture, journey, values, offstageDone) : null;
    /* Sanitised BEFORE anything is written down. `ariaSnapshot()` contains
       the value of an `<input type="password">` — measured, with the locked
       playwright — and this run has just typed its administrator password
       into one. So the snapshot file, the run lock and every later reader see
       the scrubbed text, and nothing has to remember to redact later. */
    const cleaned = sanitiseCapture(
      {
        name,
        takenAt: new Date().toISOString(),
        feature: flags.feature ?? null,
        entry: journey ? "the first screen, with nothing remembered" : `#${STATES[where].path}`,
        state: where,
        gesture: gesture ?? null,
        command,
        screenshot,
        snapshot,
        snapshotText: snapshotText.slice(0, 20_000),
        pageErrors: thrown,
        consoleErrors: logged,
        transport: "frontend",
        serverId: seen.recorded ?? after?.serverId ?? null,
        title: await page.title(),
        url: page.url(),
        ...(alongside.length ? { alongside } : {}),
        ...(after?.readback ? { readback: after.readback } : {}),
        ...(after?.offstage?.length ? { offstage: after.offstage } : {}),
        ms: Date.now() - started,
      },
      /* Read AFTER `settle`, so a password the journey has just replaced is
         scrubbed under its new value as well as its old one. Both are secrets
         of this run and only one of them is in the lock. */
      [
        ...runSecrets(readLock(plan).run),
        ...(journey
          ? [
              { what: "the password this journey typed", value: values["<password>"] },
              { what: "the password this journey chose", value: values["<new-password>"] },
            ].filter((secret) => secret.value)
          : []),
      ],
    );
    writeFileSync(snapshot, cleaned.capture.snapshotText);
    redacted = cleaned.removed;
    result = record(plan, cleaned.capture);
  } catch (error) {
    /* A handle that no longer matches is a FINDING about the copied
       vocabulary, not a crash. The whole cost of a self-contained bundle is
       that these copies can drift, so the error has to name the copy, name
       where it came from, and say how to check it. */
    const failing = path.join(plan.evidence, `${name}-drift.png`);
    try {
      const open = browser.contexts()[0]?.pages()[0];
      if (open) await open.screenshot({ path: failing });
    } catch {
      /* the page may be gone; the message below still stands */
    }
    if (!flags["keep-browser"]) await browser.close();
    /* A journey whose `expect` was not on screen is not a drifted selector:
       it is an instance that is not in the state the journey is about, which
       is a precondition and has a different answer. Reporting it as drift
       would send somebody to diff a handle that is fine. */
    if (error.stumble) {
      return fail(error.stumble.exit, {
        problem: error.stumble.problem,
        because: error.stumble.because,
        instead: [...error.stumble.instead, `open ${failing}                        what was actually on screen`],
        detail: { journey: error.stumble.journey, kind: error.stumble.kind, screenshot: failing },
      });
    }
    const stale = /locator|Timeout|waiting for/i.test(String(error.message));
    return fail(EXIT.failed, {
      problem: stale
        ? "a handle in the copied selector vocabulary no longer matches the app"
        : `driving failed: ${error.message}`,
      because: [
        String(error.message).split("\n").slice(0, 3).join(" "),
        "",
        "lib/vocabulary.mjs holds COPIES of the selectors, because the bundle is",
        "self-contained and cannot import them. Each entry records the file and line it",
        "came from, and this is what that is for.",
      ],
      instead: [
        "control-firetower drive states          every handle, with its origin",
        `open ${failing}                        what was actually on screen`,
        "",
        "Then diff the copy against the checkout and update BOTH the handle and its",
        "origin comment. A copy whose origin is stale is worse than no copy.",
      ],
      detail: { state: where, gesture: gesture ?? null, screenshot: failing },
    });
  } finally {
    if (!flags["keep-browser"] && browser.isConnected()) await browser.close();
  }

  say("");
  table([
    "Captured",
    ["name", result.name],
    ["action", result.command],
    ["screenshot", result.screenshot],
    ["snapshot", `${result.snapshot}  ${dim("a screenshot verifies layout and never a value")}`],
    ["page errors", thrown.length ? `${thrown.length}: ${thrown[0]}` : `0  ${dim(`${logged.length} console error(s) recorded, which do not fail a run`)}`],
    ["sanitised", redacted.length ? redacted.join("; ") : dim("nothing in the captured text matched a secret this run knows about")],
    ["published as captured", `${path.basename(result.screenshot)}  ${dim("PNG bytes cannot be redacted — capture synthetic data only")}`],
    ["feature", result.feature ?? dim("none given — --feature <id> makes a proof traceable")],
  ]);
  say("");
  say(`  ${dim("this is not proof yet")} control-firetower evidence post --pr <number>`);
  say("");
  if (thrown.length) {
    return fail(EXIT.failed, {
      problem: `the page threw ${thrown.length} uncaught error(s) while being driven, so this capture is not evidence`,
      because: thrown.slice(0, 4),
      instead: [
        `open ${result.screenshot}             what it looked like anyway`,
        "control-firetower api GET /setup      is the server in the state you think",
        "",
        "Report the page error. A screenshot taken over an exception is a picture of a",
        "broken app, and posting it as proof is worse than posting nothing.",
      ],
      detail: { capture: result.name, screenshot: result.screenshot },
    });
  }
  return emit({ capture: result });
}

/**
 * Walk the whole vocabulary against the running app and say what still matches.
 *
 * This exists because of what was found building it: **the two harnesses in
 * the firetower checkout disagree with each other, and neither has been
 * checked against the real application recently.**
 * `desktop/scripts/states.mjs:484,492` drives `/^Connect$/` against the mock
 * server; `desktop/e2e/cursor-live.mjs` is stale against a real one. So
 * "copy the vocabulary from states.mjs" cannot mean "trust it".
 *
 * A selector list that has never been driven is exactly the rot a feature map
 * exists to prevent, and a CLI with confident wrong selectors is worse than
 * no CLI, because its failures look like application bugs. So every handle
 * this bundle ships is either driven by this command or marked unverified,
 * and this is how that stays true after the next redesign.
 */
async function audit(plan, flags) {
  const seen = await verdict(plan);
  if (seen.verdict === "nothing-here") return nothingUp(seen);
  if (seen.verdict !== "mine" && seen.verdict !== "claimed") return refuse(seen);
  /* Which instance is this, and therefore which half of the vocabulary can
     be re-driven now. They are mutually exclusive by construction: an
     instance that can show a first-run gate has not had the steps that clear
     it, so the app is behind that gate and none of its states are reachable;
     an instance whose states are reachable has had them, so neither gate can
     be on screen. Each half is reported as not re-checkable from the other
     rather than as passing — an unknown that reads as a pass is the bug this
     whole bundle is about. */
  const gated = seen.verdict === "claimed";
  if (!password(plan)) return noPassword(plan);
  if (!(await listening(plan.renderer.value))) return noRenderer(plan);

  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    return noPlaywright();
  }

  const rows = [];
  const values = {
    "<server>": `127.0.0.1:${plan.control.value}`,
    "<password>": password(plan) ?? "",
    "<new-password>": newPassword(),
    "<organisation>": `Verify ${plan.key.slice(-8)}`,
    "<machine>": flags.at ?? "",
    "<remote>": flags.remote ?? "",
  };
  const browser = await chromium.launch({ channel: "chrome", headless: !flags.headed });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    await page.goto(rendererUrl(plan), { waitUntil: "networkidle" });

    /* The sign-in handles are audited by using them: if any one of them is
       wrong, nothing past here runs at all, which is itself the report. */
    for (const [name, handle] of Object.entries(SIGNIN)) {
      const found = await present(page, handle);
      rows.push({ group: "signin", handle: name, matches: found, how: describeHandle(handle), from: handle.from });
      if (!found) continue;
      if (name === "address") await page.getByPlaceholder(handle.handle).fill(`127.0.0.1:${plan.control.value}`);
      if (name === "connect") {
        await page.getByRole("button", { name: handle.handle, exact: true }).click();
        await page.waitForTimeout(800);
      }
      if (name === "username") await page.getByPlaceholder(handle.handle).fill("admin");
      if (name === "password") await page.getByPlaceholder(handle.handle, { exact: true }).fill(password(plan));
      if (name === "submit") {
        await page.getByRole("button", { name: handle.handle }).click();
        await page.waitForTimeout(1500);
      }
    }

    /* The first-run journeys, which are the two gates and the screen in front
       of them. Driven here when the instance can carry them, in the order a
       person meets them — each one leaves the app where the next one starts.
       They are one-shot by nature: driving the password change clears the
       password change. */
    for (const [name, journey] of Object.entries(FIRST_RUN)) {
      if (journey.needs === "first-run" && !gated) {
        rows.push({
          group: "journey",
          handle: name,
          matches: null,
          how: "this instance has had the steps that clear its gates — up --first-run makes one that has not",
          from: `${journey.from} — verified ${journey.verified}`,
        });
        continue;
      }
      /* **In a context of its own, with nothing remembered.** A successful
         sign-in writes the server into `localStorage` (`servers.ts`'s
         `remember`, called from Connect.tsx:169-177), so on the page the
         sign-in handles were just audited on, the renderer's root is the app
         and not the address screen. Found by running this: the journey
         reported NO MATCH on a heading that was perfectly fine, because the
         screen it names only exists before a server has been remembered.
         `browser.newPage()` makes its own context and closes it with the
         page, which is the real first-run condition. */
      const first = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
      let ok = true;
      let why = journey.does;
      try {
        await first.goto(rendererUrl(plan), { waitUntil: "networkidle" });
        await first.waitForTimeout(500);
        for (const action of journey.steps) {
          const outcome = await perform(first, action, values, { plan, page: first });
          if (!outcome.ok) {
            ok = false;
            why = outcome.why;
            break;
          }
        }
        if (ok && journey.then) {
          ok = await present(first, resolve(journey.then, values));
          if (!ok) why = `the journey ran and ${describeHandle(resolve(journey.then, values))} did not appear`;
        }
      } finally {
        await first.close();
      }
      if (ok) await settle(plan, name, journey, values);
      rows.push({ group: "journey", handle: name, matches: ok, how: why, from: journey.from });
      /* The lock has moved on — a replaced password, or a named organisation
         — so the next journey types what this run's credential is *now*. */
      values["<password>"] = password(plan) ?? values["<password>"];
    }


    /* And now the app's own states — including on an instance that arrived
       here gated, because the journeys above have just opened both gates.
       One audit covers the whole vocabulary where it can, which is the point:
       two halves reported from two runs is two chances to read a gap as a
       pass. */
    const reachable = !gated || rows.some((r) => r.group === "journey" && r.handle === "name-this-firetower" && r.matches === true);
    if (gated && reachable) {
      /* The main page signed in before the gates were cleared, so it is
         still at the door — and the password it signed in with has been
         replaced since. Sign in again, with what this run's credential is
         now, which is what a person would also have to do. */
      await page.goto(rendererUrl(plan), { waitUntil: "networkidle" });
      await signInOn(page, plan, values);
    }

    for (const [name, state] of Object.entries(STATES)) {
      if (!reachable) {
        rows.push({ group: "state", handle: name, matches: null, how: "behind the first-run gates this instance still has", from: state.from });
        continue;
      }
      await page.goto(`${rendererUrl(plan)}/#${state.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(Math.min(state.settle, 900));
      const matches = await present(page, state.landmark);
      rows.push({ group: "state", handle: name, matches, how: `#${state.path} shows ${describeHandle(state.landmark)}`, from: state.from });
    }

    for (const [name, gesture] of Object.entries(GESTURES)) {
      /* A gesture can want something this run has not got. `add-this-runs-machine`
         presses `Add it`, which makes the control plane open an ssh connection,
         so it needs an endpoint this run started and `--at` naming it. Reported
         as not performable here, with what it wants, rather than failed. */
      const wants = !reachable
        ? "the app is behind the first-run gates this instance still has"
        : await whatItNeeds(plan, flags, gesture.needs);
      if (wants) {
        rows.push({ group: "gesture", handle: name, matches: null, how: wants, from: gesture.from });
        continue;
      }
      await page.goto(`${rendererUrl(plan)}/#${STATES[gesture.at].path}`, { waitUntil: "networkidle" });
      /* **Reloaded, not merely navigated.** The app is behind a hash router,
         so changing the hash does not unmount anything — and a gesture that
         opens the command palette or a dialog leaves a `fixed inset-0`
         overlay up, which the next gesture's click lands on instead of the
         button. Found by running this: `add-this-runs-machine` timed out for
         30s on a button that was plainly there, because `open-the-palette`
         had run before it. Each gesture starts from a fresh page, which is
         also the state its own entry describes. */
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(Math.min(STATES[gesture.at].settle, 1200));
      /* The whole gesture is performed — including a keypress, which an
         earlier version of this skipped and therefore reported as verified
         without ever having pressed anything. Then its post-condition is
         asserted, because steps that all "succeed" while the app does
         nothing is precisely the failure that makes a run misleading. */
      let ok = true;
      let why = gesture.does;
      for (const action of gesture.steps) {
        const outcome = await perform(page, action, values, { plan, page });
        if (!outcome.ok) {
          ok = false;
          why = outcome.why;
          break;
        }
      }
      if (ok && gesture.then) {
        ok = await present(page, resolve(gesture.then, values));
        if (!ok) why = `the gesture ran and ${describeHandle(gesture.then)} did not appear`;
      }
      rows.push({ group: "gesture", handle: name, matches: ok, how: why, from: gesture.from });
    }

    /* The gate landmarks themselves. Asserted by the journeys above when this
       instance can show them, and otherwise recorded as verified once and not
       re-checkable here. */
    for (const gate of GATES) {
      const by = Object.entries(FIRST_RUN).find(([, j]) => j.steps.some((a) => a.expect?.name === gate.landmark.name));
      const row = by ? rows.find((r) => r.group === "journey" && r.handle === by[0]) : null;
      rows.push({
        group: "gate",
        handle: gate.landmark.name,
        matches: row ? row.matches : null,
        how: row?.matches ? `asserted on screen by journey ${by[0]}` : gate.name,
        from: `${gate.from} — verified ${gate.verified}`,
      });
    }
  } finally {
    await browser.close();
  }

  const checked = rows.filter((r) => r.matches !== null);
  const broken = checked.filter((r) => !r.matches);
  const unverified = rows.filter((r) => r.matches === null);

  if (flags.json) {
    return emit(
      { audited: rows, verified: checked.length - broken.length, broken: broken.length, unverified: unverified.length },
      broken.length ? EXIT.failed : EXIT.ok,
    );
  }
  say("");
  table([
    `Audited against the running app ${dim(gated ? "— an instance with its first-run gates standing" : "— a prepared instance")}`,
    ...rows.map((r) => [
      `${r.group} ${r.handle}`,
      `${r.matches === null ? `NOT RE-CHECKABLE here — ${r.how}` : r.matches ? r.how : `NO MATCH — ${r.how}`}  ${dim(r.from)}`,
      r.matches === null ? warn() : r.matches ? tick() : cross(),
    ]),
  ]);
  say("");
  say(`  ${checked.length - broken.length} re-checked now, ${broken.length} no longer matching, ${unverified.length} not re-checkable from this instance`);
  /* Which half is missing, said as what to do about it. On an instance that
     arrived gated and was opened by its own journeys, neither half is
     missing — which is the case worth saying out loud, because it is the one
     run that re-checked everything. */
  const opened = gated && !unverified.some((r) => r.group === "state");
  say(
    opened
      ? `  ${dim("the journeys opened both gates, so this one pass re-checked the first-run screens and the app's own")}`
      : gated
        ? `  ${dim("the app's own states need a prepared instance: control-firetower up (without --first-run)")}`
        : `  ${dim("the first-run journeys need an unprepared instance: control-firetower reset --first-run")}`,
  );
  say("");
  if (!broken.length) return emit({ verified: checked.length, unverified: unverified.length });
  return fail(EXIT.failed, {
    problem: `${broken.length} handle(s) in the shipped vocabulary no longer match the app`,
    because: broken.map((r) => `${r.group} ${r.handle} — copied from ${r.from}`),
    instead: [
      "Update lib/vocabulary.mjs: the handle AND the origin comment, together.",
      "A copy whose origin is stale is worse than no copy.",
      "",
      "Do not assume the checkout's harnesses are right. They disagree with each other:",
      "states.mjs drives /^Connect$/ against the mock server and cursor-live.mjs is stale",
      "against a real one. The running app is the source of truth, and this command is",
      "how you ask it.",
    ],
  });
}

/**
 * One step of a gesture or a journey.
 *
 * Returns `{ ok }`, and on a failure also *which kind* of failure it was, so
 * the auditor and the driver agree about what "it worked" means and the
 * reader is sent to the right thing. The three kinds are different problems:
 *
 *   handle         something that should be on screen is not, and the handle
 *                  is a copy that may have drifted
 *   expectation    the screen the journey is *about* is not the screen that
 *                  is up, which is a precondition rather than a drift
 *   offstage       the one step of a journey this transport cannot drive
 *                  failed on the way through
 */
async function perform(page, action, values = {}, ctx = {}) {
  if (action.pause) {
    await page.waitForTimeout(action.pause);
    return { ok: true };
  }
  if (action.press) {
    await page.keyboard.press(action.press);
    return { ok: true };
  }
  if (action.expect) {
    const want = resolve(action.expect, values);
    if (!(await present(page, want))) {
      return { ok: false, kind: "expectation", why: `${describeHandle(want)} is not on screen` };
    }
    /* **A picture of every state the journey passes through**, not only of
       where it ended. The reference is explicit that a proof shows the action
       and the state it produced rather than the final screen — and for the
       first-run journeys the state worth seeing is in the middle: the
       forced-password-change screen is gone by the time the journey has
       finished opening it. An `expect` is exactly "a state this journey says
       it was in", so it is the right thing to photograph. */
    if (ctx.alongside) {
      const slug = String(want.name ?? want.handle ?? "state").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
      const at = path.join(ctx.evidence, `${ctx.name}--${slug}.png`);
      await page.screenshot({ path: at });
      ctx.alongside.push({ was: describeHandle(want), at });
    }
    return { ok: true };
  }
  if (action.offstage) {
    const done = await offstage(action.offstage, values, ctx);
    return done.ok ? { ok: true, offstage: done } : { ok: false, kind: "offstage", why: done.why };
  }
  const handle = resolve(action.click ?? action.fill, values);
  if (!(await present(page, handle))) {
    return { ok: false, kind: "handle", why: `step did not find ${describeHandle(handle)}` };
  }
  if (action.click) await locate(page, handle).first().click();
  else await locate(page, handle).first().fill(fillIn(action.with, values));
  await page.waitForTimeout(300);
  return { ok: true };
}

/**
 * The five sign-in handles, used rather than merely asserted.
 *
 * One place, because the auditor needs it twice: once to audit the handles,
 * and once more after the first-run journeys have replaced the password it
 * signed in with the first time.
 */
async function signInOn(page, plan, values) {
  await page.getByPlaceholder(SIGNIN.address.handle).fill(values["<server>"]);
  await page.getByRole("button", { name: SIGNIN.connect.handle, exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByPlaceholder(SIGNIN.username.handle).fill("admin");
  await page.getByPlaceholder(SIGNIN.password.handle, { exact: true }).fill(password(plan) ?? values["<password>"]);
  await page.getByRole("button", { name: SIGNIN.submit.handle }).click();
  await page.waitForTimeout(1800);
}

/**
 * `<server>`, `<password>`, `<new-password>`, `<organisation>`, `<machine>`.
 *
 * The vocabulary holds the shape of a journey and never a value: a run's
 * address, its administrator password and the name it gives an organisation
 * are facts about the run, and a credential written into a committed file is
 * a credential published. So the steps carry placeholders and `drive` fills
 * them from the run lock and the flags.
 */
const fillIn = (text, values) =>
  typeof text === "string" ? text.replace(/<[a-z-]+>/g, (found) => values[found] ?? found) : text;

/** The same substitution, over a handle's accessible name or placeholder. */
function resolve(handle, values = {}) {
  if (!handle || typeof handle !== "object") return handle;
  return {
    ...handle,
    ...(handle.handle ? { handle: fillIn(handle.handle, values) } : {}),
    ...(handle.name ? { name: fillIn(handle.name, values) } : {}),
  };
}

/**
 * The step of a journey the desktop app deliberately does not carry.
 *
 * There is exactly one, and `OFFSTAGE` in the vocabulary says what it is and
 * why. Doing it and saying so is the honest option: pretending the desktop
 * replaced the password would report the web control plane as verified, and
 * skipping the journey would leave the gate exercised by nothing, which is
 * where firetower#336 started.
 */
async function offstage(which, values, { plan }) {
  const what = OFFSTAGE[which];
  if (!what) return { ok: false, why: `there is no offstage step called ${which}` };
  if (which !== "replace-the-password") return { ok: false, why: `${which} is declared and not implemented` };

  const held = readLock(plan).run ?? {};
  let token = held.token;
  if (!token) {
    const got = await signIn(plan);
    if (!got.ok) return { ok: false, why: `signing in to replace the password answered ${got.status}: ${JSON.stringify(got.body)}` };
    token = got.token;
  }
  const sent = await raw(plan, "POST", "/auth/password", {
    token,
    body: { current: values["<password>"], new: values["<new-password>"] },
  });
  if (sent.status !== 200) {
    return {
      ok: false,
      why: `POST /api/v1/auth/password answered ${sent.status}: ${JSON.stringify(sent.body)}`,
    };
  }
  /* The new password is this run's credential now, and the old one is a
     credential nobody is tracking. Every other session was ended by the
     change (api/auth.rs:195), so the token recorded here is the one the
     response handed back. */
  updateLock(plan, { adminPassword: values["<new-password>"], token: sent.body?.token ?? null });
  return { ok: true, what: what.what, how: what.how, because: what.because };
}

/**
 * What a journey changed, read back from somewhere other than the screen.
 *
 * Also where the run lock catches up with what the person just did: a journey
 * that named the organisation has *created* this instance's serverId, so the
 * instance stops being `claimed` and becomes `pinned` — on the positive fact
 * that `/bootstrap` now answers with one, not on the journey's name. A
 * journey that replaced the password has already recorded it, in `offstage`.
 */
async function settle(plan, id, journey, values, offstage = []) {
  const out = { readback: null, serverId: null, offstage };
  const held = readLock(plan).run ?? {};

  const found = await probe(serverUrl(plan));
  if (found.serverId && !held.serverId) {
    updateLock(plan, {
      phase: PHASE.pinned,
      serverId: found.serverId,
      organization: found.organization ?? null,
      firstRun: false,
    });
    out.serverId = found.serverId;
  }

  if (journey.readback) {
    const route = journey.readback.how.replace(/^GET\s+/, "");
    const saw =
      route === "/bootstrap"
        ? { serverId: found.serverId, organization: found.organization, version: found.version }
        : (await raw(plan, "GET", route, { token: readLock(plan).run?.token })).body;
    out.readback = { how: journey.readback.how, shows: journey.readback.shows, saw };
  }
  return out;
}

/** A journey that did not get where it was going, reported as what it is. */
function stumbled(outcome, id, journey) {
  const error = new Error(outcome.why);
  error.stumble = {
    journey: id,
    kind: outcome.kind ?? "post-condition",
    exit: outcome.kind === "handle" ? EXIT.failed : EXIT.precondition,
    problem:
      outcome.kind === "handle"
        ? `a handle this journey needs no longer matches the app: ${outcome.why}`
        : `${id} could not be driven to the end: ${outcome.why}`,
    because: [
      `the journey is: ${journey.does}`,
      `it ends at ${describeHandle(journey.then)}`,
      journey.needs === "first-run"
        ? "it needs an instance with its first-run gates still standing, and each gate is one-shot — driving it clears it"
        : "it runs against either instance",
      `origin: ${journey.from}`,
    ],
    instead:
      outcome.kind === "handle"
        ? [
            "control-firetower drive states          every handle, with its origin",
            "Update lib/vocabulary.mjs: the handle AND the origin comment, together.",
          ]
        : [
            "control-firetower reset --first-run    a fresh unprepared instance, about 3s",
            "control-firetower doctor               which of the six steps this instance has had",
            "",
            "A journey that has already been driven has cleared its gate, so the screen it",
            "is about is gone. That is the journey working, not the journey failing.",
          ],
  };
  return error;
}

/** One handle, one locator. Everything that looks for something uses this. */
export function locate(page, handle) {
  if (handle.how === "placeholder") {
    return page.getByPlaceholder(handle.handle, handle.exact ? { exact: true } : {});
  }
  return page.getByRole(handle.role, {
    name: handle.name ?? handle.handle,
    exact: handle.exact ?? false,
    ...(handle.level ? { level: handle.level } : {}),
  });
}

const present = (page, handle) => locate(page, handle).count().then((n) => n > 0);

const describeHandle = (handle) =>
  handle.how === "placeholder"
    ? `placeholder "${handle.handle}"`
    : `${handle.role}${handle.level ? ` ${handle.level}` : ""} named "${handle.name ?? handle.handle}"`;

/**
 * What `add-this-runs-machine` is missing, said in one line for the audit.
 *
 * Not a refusal here: an audit of a vocabulary is not the place to stand up a
 * container, and a gesture reported as "not performed, and here is what it
 * wants" is honest where a pass would not be.
 */
async function needsEndpoint(plan, flags) {
  if (!flags.at) return "needs --at user@host:port, an ssh endpoint this run started (firetower#332's Alpine container)";
  const endpoint = ownsEndpoint(plan, flags.at);
  if (!endpoint.ok) return `--at was given and refused: ${endpoint.why}`;
  /* And a machine that is already added cannot be added again: the dialog
     answers with the server's refusal rather than with the next step, so the
     post-condition would never appear. One-shot per machine, like the
     first-run journeys are one-shot per instance. */
  const hosts = await raw(plan, "GET", "/hosts", { token: readLock(plan).run?.token });
  if (hosts.status !== 200) return `GET /hosts answered ${hosts.status}, so whether this machine is already added cannot be established`;
  const already = (Array.isArray(hosts.body) ? hosts.body : []).some(
    (host) => host.compute?.host && endpoint.at.includes(host.compute.host) && String(host.compute.port ?? 22) === endpoint.at.split(":").pop(),
  );
  return already ? `${endpoint.at} is already a machine on this instance, and adding it twice is refused` : null;
}

/**
 * What a gesture wants before it can mean anything, asked of the control
 * plane rather than of the screen.
 *
 * **Several entries in this vocabulary describe an install in a particular
 * state**, and that is not a flaw in them: "the empty repositories screen
 * offers Connect a provider" is a claim about an empty install, and it stops
 * being true the moment one repository exists. An auditor that drove them
 * anyway would report four red rows on a perfectly healthy app — which is
 * what it did, and is how this table came to exist.
 *
 * Each returns a sentence saying what is missing, or null. The README's
 * sweep order is the other half of the same fact: the entries that describe
 * an empty install are walked before the ones that fill it.
 */
const NEEDS = {
  "ssh-endpoint": needsEndpoint,
  "a remote": needsRemote,
  "an empty fleet": needsEmptyFleet,
  "a bare repositories screen": needsBareRepos,
};

const whatItNeeds = (plan, flags, needs) => (needs && NEEDS[needs] ? NEEDS[needs](plan, flags) : null);

/** Every precondition something actually checks. The tests assert against it. */
export const PRECONDITIONS = Object.keys(NEEDS);

/** The composer's "Add a machine first" is a claim about a fleet with nothing in it. */
async function needsEmptyFleet(plan, flags) {
  const hosts = await raw(plan, "GET", "/hosts", { token: readLock(plan).run?.token });
  if (hosts.status !== 200) return `GET /hosts answered ${hosts.status}, so the fleet cannot be established`;
  return Array.isArray(hosts.body) && hosts.body.length === 0
    ? null
    : `this run has ${hosts.body.length} machine(s), and this gesture is about the home with none`;
}

/** And `Connect a provider` is a claim about a repositories screen with nothing on it. */
async function needsBareRepos(plan, flags) {
  const token = readLock(plan).run?.token;
  const repos = await raw(plan, "GET", "/repos", { token });
  if (repos.status !== 200) return `GET /repos answered ${repos.status}, so whether this screen is bare cannot be established`;
  if (Array.isArray(repos.body) && repos.body.length > 0) {
    return `this run has ${repos.body.length} repository(ies), so the screen is no longer bare and draws the lists instead of the way in`;
  }
  const providers = await raw(plan, "GET", "/providers", { token });
  const connected = Array.isArray(providers.body) ? providers.body.filter((p) => p.connected).length : 0;
  return connected ? `a git host is connected, so the screen is no longer bare` : null;
}

/**
 * What `paste-a-remote` is missing: a remote, and a screen that draws the
 * picker it lives in.
 *
 * Asked of the control plane rather than of the screen, because "no rows" and
 * "the request failed" look identical in a list and only one of them means
 * the install is empty — which is the bug `Repos.tsx:137-141` records against
 * itself.
 */
async function needsRemote(plan, flags) {
  if (!flags.remote) return "needs --remote <path or URL the machine can clone>";
  const repos = await raw(plan, "GET", "/repos", { token: readLock(plan).run?.token });
  if (repos.status !== 200) return `GET /repos answered ${repos.status}, so whether this screen is bare cannot be established`;
  if (!Array.isArray(repos.body) || repos.body.length === 0) {
    return "this install has no repository yet, so the screen is bare and draws no host picker — seed one first";
  }
  return null;
}

const nothingUp = (seen) =>
  fail(EXIT.precondition, {
    problem: `nothing is answering on ${seen.at}, so there is nothing to drive`,
    because: seen.reasons,
    instead: ["control-firetower up", "control-firetower doctor"],
  });

/**
 * The accessibility snapshot, beside the screenshot.
 *
 * `ariaSnapshot()` where the installed playwright has it, and the older
 * `accessibility.snapshot()` where it does not, because the bundle declares a
 * range rather than pinning one build.
 */
/**
 * `localhost` rather than `127.0.0.1` for the renderer.
 *
 * Vite binds `localhost`, which resolves to `::1` on macOS, so a v4 literal
 * does not reach it. The control plane is the other way about — ft-cli's
 * `--bind` default is the v4 literal — so the two addresses are written
 * differently on purpose rather than by inconsistency.
 */
export const rendererUrl = (plan) => `http://localhost:${plan.renderer.value}`;

async function ariaSnapshot(page) {
  try {
    return await page.locator("body").ariaSnapshot();
  } catch {
    try {
      return JSON.stringify(await page.accessibility.snapshot(), null, 2);
    } catch (error) {
      return `no accessibility snapshot: ${error.message}`;
    }
  }
}
