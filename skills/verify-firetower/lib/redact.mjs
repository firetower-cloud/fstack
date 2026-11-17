/**
 * Sanitising evidence, which is published.
 *
 * The thing this exists for, measured rather than assumed: **Playwright's
 * accessibility snapshot contains the value of an `<input type="password">`.**
 * A dummy Chrome page with the locked playwright-core confirmed it. Visual
 * masking is a property of the rendered pixels and not of the accessibility
 * tree, so `.aria.txt` of a signed-in application carries the password that
 * was typed into it — and `evidence post` inlines `.aria.txt` into a public
 * pull request comment.
 *
 * Truncation is not redaction. Slicing the first 4,000 characters of a
 * snapshot removes whatever is at the end, which is not the same as removing
 * whatever is a secret.
 *
 * So there are three channels and they are sanitised independently, because
 * they fail independently:
 *
 *   text       the accessibility snapshot and the readback. Secret-named
 *              fields lose their values; this run's own credentials are
 *              replaced wherever they appear
 *   logs       console errors. Same scrub, plus the markdown that would let
 *              captured text escape the code fence it is published inside
 *   images     **cannot be sanitised at all.** PNG bytes are what the screen
 *              showed. They are reported, counted and published verbatim, and
 *              the only control over them is not capturing a populated real
 *              account in the first place
 *
 * That last one is why `post` prints what it is about to publish and why the
 * skill says evidence must be captured from a run's own synthetic stack.
 */

/** Field names whose value is a secret whatever it happens to contain. */
const SECRET_NAMED = /pass(word|phrase)?|secret|token|credential|api[-_ ]?key|private[-_ ]key|bearer/i;

/** The literal strings this run knows are its own secrets. */
export function runSecrets(held) {
  return [
    held?.adminPassword ? { what: "the administrator password", value: held.adminPassword } : null,
    held?.token ? { what: "the control-plane bearer token", value: held.token } : null,
  ].filter(Boolean);
}

const WITHHELD = (what) => `«${what}, withheld»`;

/** Roles that hold a value a person typed. */
const FIELD = /^(textbox|searchbox|combobox|spinbutton|slider)$/;
const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Blank the value of any field whose *name* says it holds a secret.
 *
 * The mechanism that catches a secret this run does not know: a credential
 * typed by a gesture, a key displayed by a Reveal, somebody else's password.
 * Scrubbing known literals cannot do that, so both run.
 *
 * It has to understand ariaSnapshot's real shape, which is nested and was
 * measured against this app rather than guessed:
 *
 *     - textbox:
 *       - /placeholder: Password
 *       - text: <the value>
 *
 * The name can be a quoted accessible name on the node, or a `/placeholder`,
 * `/aria-label` or `/title` child. The name is kept — it is the part that is
 * evidence — and the value is not.
 */
function blankSecretFields(text) {
  const lines = text.split("\n");
  const out = [...lines];

  for (let i = 0; i < lines.length; i++) {
    const node = lines[i].match(/^(\s*)-\s+([a-z]+)(?:\s+"([^"]*)")?\s*:?\s*(.*)$/);
    if (!node) continue;
    const [, indent, role, quoted, inline] = node;
    if (!FIELD.test(role)) continue;

    /* The node's children: everything indented further, up to the next
       sibling or shallower line. */
    const children = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || indentOf(lines[j]) > indent.length); j++) {
      if (lines[j].trim() !== "") children.push(j);
    }

    const named = [
      quoted,
      ...children.map((j) => lines[j].match(/^\s*-\s*\/(?:placeholder|aria-label|title|label)\s*:\s*(.*)$/)?.[1]),
    ].filter(Boolean);
    if (!named.some((name) => SECRET_NAMED.test(name))) continue;

    /* `- textbox "Password": hunter2` */
    if (inline) {
      out[i] = `${indent}- ${role}${quoted ? ` "${quoted}"` : ""}: ${WITHHELD("a secret-named field's value")}`;
    }
    /* and the nested `- text: hunter2` under it */
    for (const j of children) {
      const value = lines[j].match(/^(\s*-\s*text\s*:\s*)(.*)$/);
      if (value && value[2].trim() !== "") {
        out[j] = `${value[1]}${WITHHELD("a secret-named field's value")}`;
      }
    }
  }
  return out.join("\n");
}

/** Escape text so it cannot leave the code fence it is published inside. */
function neutralise(text) {
  return String(text)
    /* A capture containing a fence closes the fence and everything after it
       becomes markdown — including image syntax, which then renders. */
    .replace(/```/g, "ʼʼʼ")
    /* And an image reference inside captured text is attacker-chosen content
       being published under this run's name. Named, not rendered. */
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, "![$1](image reference removed by control-firetower)");
}

/**
 * One channel, sanitised. Returns the text and what was done to it, because
 * "it was redacted" is a fact the comment should carry rather than a silent
 * improvement.
 */
export function sanitise(text, secrets = [], { fields = true } = {}) {
  if (text === null || text === undefined) return { text, removed: [] };
  let out = String(text);
  const removed = [];
  const count = (before, after, what) => {
    if (before !== after) removed.push(what);
  };

  for (const secret of secrets) {
    if (!secret.value) continue;
    const before = out;
    out = out.split(secret.value).join(WITHHELD(secret.what));
    count(before, out, secret.what);
  }

  if (fields) {
    const before = out;
    out = blankSecretFields(out);
    count(before, out, "the values of secret-named fields");
  }

  const before = out;
  out = neutralise(out);
  count(before, out, "markdown that would have escaped the code fence");

  return { text: out, removed };
}

/**
 * The whole sanitisation pass over one capture, as data.
 *
 * Run at capture time, so nothing unredacted is ever written to the run lock
 * or to `.aria.txt`, and again at post time over whatever is about to be
 * published. Doing it twice is deliberate: the first pass is the one that
 * matters and the second is the one that is read out loud.
 */
export function sanitiseCapture(capture, secrets) {
  const snapshot = sanitise(capture.snapshotText, secrets);
  const logs = (capture.consoleErrors ?? []).map((line) => sanitise(line, secrets, { fields: false }));
  const thrown = (capture.pageErrors ?? []).map((line) => sanitise(line, secrets, { fields: false }));
  const readback = capture.readback
    ? sanitise(JSON.stringify(capture.readback.saw), secrets, { fields: false })
    : null;

  const removed = [
    ...snapshot.removed,
    ...logs.flatMap((l) => l.removed),
    ...thrown.flatMap((t) => t.removed),
    ...(readback?.removed ?? []),
  ];

  return {
    capture: {
      ...capture,
      snapshotText: snapshot.text,
      consoleErrors: logs.map((l) => l.text),
      pageErrors: thrown.map((t) => t.text),
      ...(capture.readback ? { readback: { ...capture.readback, saw: readback.text } } : {}),
    },
    removed: [...new Set(removed)],
    /* Counted and named, never claimed to be redacted — and that includes
       the states a journey photographed on the way through. A count that
       named fewer pictures than the comment publishes is the kind of number
       that rots quietly, which is exactly what this report exists to stop. */
    images: [
      ...(capture.screenshot ? [capture.screenshot] : []),
      ...(capture.alongside ?? []).map((shot) => shot.at),
    ],
  };
}
