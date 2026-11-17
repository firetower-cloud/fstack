/**
 * Output, and the only way this CLI is allowed to fail.
 *
 * Two readers: an agent reading the terminal, and an agent reading `--json`.
 * Both get the same facts, so nothing is said in one that is missing from the
 * other.
 *
 * **Every failure names what to do instead.** `fail()` will not accept a
 * message without one. An error that only says what went wrong hands the
 * problem back to whoever has the least context — which, mid-task, is the
 * agent.
 */

/** Exit codes. Documented in `--help`, so they are a contract. */
export const EXIT = {
  ok: 0,
  usage: 1,
  /** This run does not own what it was about to drive. Never retry. */
  notMine: 2,
  /** The transport cannot support the claim being made. */
  cannotProve: 3,
  /** Something has to be brought up or recorded first. */
  precondition: 4,
  /** Doing this would lose evidence that has not been posted. */
  evidence: 5,
  /** The thing being driven failed. The CLI worked. */
  failed: 6,
};

export const mode = { json: false, quiet: false, verbose: false, color: true };

export function configure(flags) {
  mode.json = Boolean(flags.json);
  mode.quiet = Boolean(flags.quiet);
  mode.verbose = Boolean(flags.verbose);
  mode.color = !flags["no-color"] && !process.env.NO_COLOR && process.stdout.isTTY === true;
}

const ESC = String.fromCharCode(27);
const paint = (code, text) => (mode.color ? `${ESC}[${code}m${text}${ESC}[0m` : text);
export const bold = (t) => paint("1", t);
export const dim = (t) => paint("2", t);
export const red = (t) => paint("31", t);
export const green = (t) => paint("32", t);
export const yellow = (t) => paint("33", t);

export function say(line = "") {
  if (!mode.json && !mode.quiet) console.log(line);
}

export function note(line) {
  if (!mode.json && mode.verbose) console.log(dim(`  ${line}`));
}

/** A step of a multi-step command. */
export function step(n, of, what) {
  if (!mode.json && !mode.quiet) console.log(`${dim(`[${n}/${of}]`)} ${what}`);
}

export function done(what, ms) {
  if (!mode.json && !mode.quiet) {
    console.log(`      ${green("ok")} ${what} ${dim(`${(ms / 1000).toFixed(2)}s`)}`);
  }
}

/** The success half. In `--json` this is the whole output. */
export function emit(payload, exit = EXIT.ok) {
  if (mode.json) console.log(JSON.stringify({ ok: exit === EXIT.ok, ...payload }, null, 2));
  return exit;
}

/**
 * Stop, with a reason and a next action.
 *
 * `problem` is what is wrong. `because` is the evidence for it — a port, a
 * serverId, a path, something the agent can check itself. `instead` is a list
 * of commands or decisions, and it is required.
 */
export function fail(exit, { problem, because = [], instead = [], detail = {} }) {
  const keep = (line) => line !== null && line !== undefined && line !== false;
  const reasons = [because].flat().filter(keep);
  const actions = [instead].flat().filter(keep);
  if (actions.length === 0) {
    throw new Error("fail() needs an `instead`: an error that cannot be acted on is a dead end");
  }

  if (mode.json) {
    const error = { problem, because: reasons, instead: actions, ...detail };
    console.log(JSON.stringify({ ok: false, exit, error }, null, 2));
    return exit;
  }
  console.error("");
  console.error(`${red("refused")} ${bold(problem)}`);
  for (const line of reasons) console.error(line === "" ? "" : `        ${line}`);
  console.error("");
  console.error(`  ${bold("What to do instead")}`);
  for (const line of actions) console.error(line === "" ? "" : `    ${line}`);
  console.error("");
  return exit;
}

/** A two-column block, the shape `doctor` reports in. */
export function table(rows) {
  if (mode.json || mode.quiet) return;
  const keys = rows.filter((r) => Array.isArray(r)).map(([k]) => k.length);
  const width = keys.length ? Math.max(...keys) : 0;
  for (const row of rows) {
    if (!Array.isArray(row)) {
      console.log(row === "" ? "" : `  ${bold(row)}`);
      continue;
    }
    const [key, value, mark] = row;
    console.log(`    ${key.padEnd(width)}  ${mark ? `${mark} ` : ""}${value}`);
  }
}

export const tick = () => green("ok");
export const cross = () => red("no");
export const warn = () => yellow("??");
