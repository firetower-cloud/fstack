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
import { adminPassword } from "./key.mjs";
import { verdict, listening } from "./own.mjs";
import { refuse } from "./api.mjs";
import { record } from "./evidence.mjs";
import { VIEWPORT, SCALE, SIGNIN, GATES, STATES, GESTURES, NOT_WHAT_THEY_SAY } from "./vocabulary.mjs";
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
        because: ["the subcommands are states, open, act and signin"],
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
  return emit({ states: Object.keys(STATES), gestures: Object.keys(GESTURES) });
}

async function capture(plan, { state, gesture, signinOnly }, flags) {
  const chosen = gesture ? GESTURES[gesture] : null;
  if (gesture && !chosen) {
    return fail(EXIT.usage, {
      problem: `there is no gesture called "${gesture}"`,
      because: [`the vocabulary has: ${Object.keys(GESTURES).join(", ")}`],
      instead: ["control-firetower drive states          the whole vocabulary, with origins"],
    });
  }
  const where = chosen ? chosen.at : (state ?? "home");
  if (!STATES[where]) {
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
      instead: ["control-firetower up", "control-firetower doctor"],
    });
  }
  if (seen.verdict !== "mine") return refuse(seen);

  if (!(await listening(plan.renderer.value))) return noRenderer(plan);

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

async function captureWith(chromium, plan, { state, gesture, signinOnly }, flags) {
  const chosen = gesture ? GESTURES[gesture] : null;
  const where = chosen ? chosen.at : (state ?? "home");
  const seen = await verdict(plan);

  if (flags["dry-run"]) {
    say("");
    say(`${dim("dry run")} no browser has been opened`);
    say("");
    table([
      "Would drive",
      ["renderer", rendererUrl(plan)],
      ["server typed in", `127.0.0.1:${plan.control.value}`],
      ["sign in as", "admin"],
      ["state", `#${STATES[where].path}  ${dim(STATES[where].from)}`],
      ...(chosen ? [["gesture", `${gesture}: ${chosen.does}`]] : []),
      ["capture", path.join(plan.evidence, `${flags.as ?? gesture ?? where}.png`)],
    ]);
    say("");
    return emit({ dryRun: true, state: where, gesture: gesture ?? null });
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
  const browser = await chromium.launch({ channel: "chrome", headless: !flags.headed });
  let result;
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    page.on("pageerror", (error) => thrown.push(String(error.message ?? error)));
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });

    step(1, signinOnly ? 2 : 3, "sign in, the way a person does");
    let at = Date.now();
    await page.goto(rendererUrl(plan), { waitUntil: "networkidle" });
    await page.getByPlaceholder(SIGNIN.address.handle).fill(`127.0.0.1:${plan.control.value}`);
    await page.getByRole("button", { name: SIGNIN.connect.handle, exact: true }).click();
    await page.getByPlaceholder(SIGNIN.username.handle).fill("admin");
    await page.getByPlaceholder(SIGNIN.password.handle, { exact: true }).fill(adminPassword(plan.key));
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
      for (const action of chosen.steps) await perform(page, action);
      if (chosen.then && !(await present(page, chosen.then))) {
        throw new Error(`the gesture ran and its post-condition — ${describeHandle(chosen.then)} — did not appear`);
      }
      done("done", Date.now() - at);
    }

    const screenshot = path.join(plan.evidence, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: Boolean(flags["full-page"]) });
    const snapshotText = await ariaSnapshot(page);
    const snapshot = path.join(plan.evidence, `${name}.aria.txt`);
    writeFileSync(snapshot, snapshotText);

    const command = `control-firetower drive ${gesture ? `act ${gesture}` : `open ${where}`}${flags.as ? ` --as ${flags.as}` : ""}`;
    result = record(plan, {
      name,
      takenAt: new Date().toISOString(),
      feature: flags.feature ?? null,
      entry: `#${STATES[where].path}`,
      state: where,
      gesture: gesture ?? null,
      command,
      screenshot,
      snapshot,
      snapshotText: snapshotText.slice(0, 20_000),
      pageErrors: thrown,
      consoleErrors: logged,
      transport: "frontend",
      serverId: seen.recorded,
      title: await page.title(),
      url: page.url(),
      ms: Date.now() - started,
    });
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
  if (seen.verdict !== "mine") return seen.verdict === "nothing-here" ? nothingUp(seen) : refuse(seen);
  if (!(await listening(plan.renderer.value))) return noRenderer(plan);

  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    return noPlaywright();
  }

  const rows = [];
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
      if (name === "password") await page.getByPlaceholder(handle.handle, { exact: true }).fill(adminPassword(plan.key));
      if (name === "submit") {
        await page.getByRole("button", { name: handle.handle }).click();
        await page.waitForTimeout(1500);
      }
    }

    for (const [name, state] of Object.entries(STATES)) {
      await page.goto(`${rendererUrl(plan)}/#${state.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(Math.min(state.settle, 900));
      const matches = await present(page, state.landmark);
      rows.push({ group: "state", handle: name, matches, how: `#${state.path} shows ${describeHandle(state.landmark)}`, from: state.from });
    }

    for (const [name, gesture] of Object.entries(GESTURES)) {
      await page.goto(`${rendererUrl(plan)}/#${STATES[gesture.at].path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(Math.min(STATES[gesture.at].settle, 1200));
      /* The whole gesture is performed — including a keypress, which an
         earlier version of this skipped and therefore reported as verified
         without ever having pressed anything. Then its post-condition is
         asserted, because steps that all "succeed" while the app does
         nothing is precisely the failure that makes a run misleading. */
      let ok = true;
      let why = gesture.does;
      for (const action of gesture.steps) {
        if (!(await perform(page, action))) {
          ok = false;
          why = `step did not find ${describeHandle(action.click ?? action.fill)}`;
          break;
        }
      }
      if (ok && gesture.then) {
        ok = await present(page, gesture.then);
        if (!ok) why = `the gesture ran and ${describeHandle(gesture.then)} did not appear`;
      }
      rows.push({ group: "gesture", handle: name, matches: ok, how: why, from: gesture.from });
    }

    /* The two gates cannot be reached from a run that cleared them, which is
       every run `up` prepares. Reported as unverified rather than as passing:
       an unknown that reads as a pass is the bug this whole bundle is about. */
    for (const gate of GATES) {
      rows.push({ group: "gate", handle: gate.landmark.name, matches: null, how: gate.name, from: `${gate.from} — verified ${gate.verified}` });
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
    "Audited against the running app",
    ...rows.map((r) => [
      `${r.group} ${r.handle}`,
      `${r.matches === null ? "NOT RE-CHECKABLE from a prepared run" : r.matches ? r.how : `NO MATCH — ${r.how}`}  ${dim(r.from)}`,
      r.matches === null ? warn() : r.matches ? tick() : cross(),
    ]),
  ]);
  say("");
  say(`  ${checked.length - broken.length} re-checked now, ${broken.length} no longer matching, ${unverified.length} verified once and not re-checkable here`);
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
 * One step of a gesture. Returns whether it found what it was looking for,
 * so the auditor and the driver agree about what "it worked" means.
 */
async function perform(page, action) {
  if (action.pause) {
    await page.waitForTimeout(action.pause);
    return true;
  }
  if (action.press) {
    await page.keyboard.press(action.press);
    return true;
  }
  const handle = action.click ?? action.fill;
  if (!(await present(page, handle))) return false;
  if (action.click) await locate(page, handle).first().click();
  else await locate(page, handle).first().fill(action.with);
  await page.waitForTimeout(300);
  return true;
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
