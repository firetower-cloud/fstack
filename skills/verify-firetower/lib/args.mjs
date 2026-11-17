/**
 * Argument parsing, hand-rolled because this bundle has no dependencies.
 *
 * The rule the parser enforces for us: a boolean flag never eats the next
 * token. `--dry-run down` has to mean the `down` positional and not a run
 * named "down", because the one command where that mistake matters is the one
 * that stops things.
 */

/** Every boolean flag in the CLI. Anything else takes a value. */
const BOOLEANS = new Set([
  "help",
  "version",
  "json",
  "dry-run",
  "quiet",
  "verbose",
  "no-color",
  "rebuild",
  "all",
  "force",
  "full-page",
  "keep-browser",
  "headed",
]);

const SHORT = { h: "help", q: "quiet", v: "verbose", V: "version" };

export function parse(argv) {
  const positional = [];
  const flags = {};
  const repeated = {};
  let only = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (only || !token.startsWith("-") || token === "-") {
      positional.push(token);
      continue;
    }
    if (token === "--") {
      only = true;
      continue;
    }
    let name;
    let inline = null;
    if (token.startsWith("--")) {
      const cut = token.indexOf("=");
      name = cut === -1 ? token.slice(2) : token.slice(2, cut);
      inline = cut === -1 ? null : token.slice(cut + 1);
    } else {
      name = SHORT[token.slice(1)] ?? token.slice(1);
    }
    if (BOOLEANS.has(name)) {
      flags[name] = inline === null ? true : inline !== "false" && inline !== "0";
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined) {
      return { positional, flags, repeated, missing: name };
    }
    flags[name] = value;
    (repeated[name] ??= []).push(value);
  }
  return { positional, flags, repeated, missing: null };
}
