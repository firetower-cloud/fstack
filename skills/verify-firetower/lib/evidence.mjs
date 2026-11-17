/**
 * Evidence: capture, post, verify — and only then may anything be cleaned up.
 *
 * firetower#337 settled where proof lives: **a GitHub pull request comment**,
 * posted with `gh --attach` so the images render inline. A path, a link or a
 * base64 data URI do not render and the reader never sees the picture.
 *
 * The consequence is the ordering, and it is a correctness property rather
 * than a preference. Durability comes from having posted, not from keeping a
 * directory: the whole workspace — checkout, `.firetower/`, everything a run
 * wrote under either — is deleted when this session ends
 * (`crates/ft-worker/src/lib.rs:941`), and the stack is swept before the
 * worktree, so a run interrupted after capture has lost the control plane it
 * would have re-read a side effect from even if the PNGs are intact.
 *
 *     capture  ->  post  ->  verify the comment  ->  only then clean up
 *
 * So: post early and post often. The window between capture and post is the
 * whole exposure, and nothing can recover a run that is killed inside it —
 * there is no pre-teardown hook to register for. Unposted evidence is the
 * failure state, not a tidy-up task, which is why `down` refuses on it.
 *
 * A run with nowhere to post says so and holds the evidence: `evidence hold`
 * names the directory and what has to happen to it. Silently leaving files on
 * disk that nobody will look at is the thing being avoided.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readLock, updateLock } from "./own.mjs";
import { runSecrets, sanitiseCapture } from "./redact.mjs";
import { EXIT, emit, fail, say, table, dim, tick, cross, warn } from "./out.mjs";

const run = promisify(execFile);

/**
 * The one place a GitHub attachment lives, and the only kind of URL this file
 * will ever put a credential on.
 *
 * `verify` used to regex every Markdown image out of the comment body and
 * send `Authorization: Bearer <the operator's gh token>` to each one,
 * whatever its host. The comment body contains a fenced accessibility
 * snapshot of the driven application, and the regex matched inside fences —
 * so any attacker-controlled text that reached a captured UI label was enough
 * to make the next `evidence verify` hand a real GitHub credential to a host
 * of the attacker's choosing. Confirmed by the security review against
 * `attacker.invalid`.
 *
 * The credential is genuinely needed: an unauthenticated HEAD cannot read a
 * private repository's attachment, which is why it was added. So it is kept,
 * and the *destination* is what gets decided here instead of by the page:
 *
 *   - exactly `https://github.com`, compared as an origin rather than matched
 *     as a prefix, so `https://github.com.attacker.invalid` is not it
 *   - exactly `/user-attachments/assets/<uuid>`, which is the shape every
 *     `gh --attach` upload resolves to
 *   - no query, no fragment, no userinfo
 *
 * And the URL that is checked comes from the manifest `post` recorded, never
 * from the comment text. The body is only ever asked whether it *contains*
 * the recorded URL.
 */
const ATTACHMENT_ORIGIN = "https://github.com";
const ATTACHMENT_PATH = /^\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function approvedAttachment(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, why: `${candidate} is not a URL` };
  }
  if (url.origin !== ATTACHMENT_ORIGIN) {
    return { ok: false, why: `origin is ${url.origin}, and the only approved origin is ${ATTACHMENT_ORIGIN}` };
  }
  if (!ATTACHMENT_PATH.test(url.pathname)) {
    return { ok: false, why: `path is ${url.pathname}, which is not /user-attachments/assets/<uuid>` };
  }
  if (url.search || url.hash || url.username || url.password) {
    return { ok: false, why: `${candidate} carries a query, fragment or userinfo, and an attachment URL has none` };
  }
  return { ok: true, url: url.toString() };
}

/** Append a capture to the run lock. Called by `drive`. */
export function record(plan, capture) {
  const { run: held } = readLock(plan);
  const evidence = [...(held?.evidence ?? []), capture];
  updateLock(plan, { evidence });
  return capture;
}

export async function evidence(plan, argv, flags) {
  const sub = argv[0];
  const held = readLock(plan);
  if (held.state === "unreadable") {
    return fail(EXIT.notMine, {
      problem: "the run lock cannot be read, so what has been captured is unknown",
      because: [held.why, "a lock that will not parse is not an empty one"],
      instead: [`cat ${plan.lock}`, `ls -la ${plan.evidence}`],
      /* --help promises the cause is in --json as error.cause, and this
         refusal is one of the six. It was the only exit-2 path in this file
         that did not carry it. */
      detail: { cause: "unreadable-lock" },
    });
  }
  const captures = held.run?.evidence ?? [];

  switch (sub) {
    case "list":
    case undefined:
      return list(plan, captures);
    case "post":
      return post(plan, captures, flags);
    case "verify":
      return verify(plan, captures, flags);
    case "hold":
      return hold(plan, captures);
    default:
      return fail(EXIT.usage, {
        problem: `evidence has no subcommand "${sub}"`,
        because: ["the subcommands are list, post, verify and hold"],
        instead: ["control-firetower evidence --help"],
      });
  }
}

function list(plan, captures) {
  const rows = captures.map((c) => [
    c.name,
    `${c.postedAt ? tick() : warn()} ${c.feature ? `${c.feature}  ` : ""}${c.screenshot ? path.basename(c.screenshot) : "(no file)"}  ${dim(c.takenAt ?? "")}`,
  ]);
  say("");
  table(["Captured", ...(rows.length ? rows : [["none", `nothing in ${plan.evidence}`]])]);
  say("");
  const unposted = captures.filter((c) => !c.postedAt).length;
  if (unposted) say(`  ${warn()} ${unposted} not posted. Until they are, they are not proof.`);
  say("");
  return emit({ captures, unposted });
}

function body(plan, captures, held) {
  const lines = [
    `## verify-firetower: ${captures.length} proof${captures.length === 1 ? "" : "s"}`,
    "",
    `Driven by \`control-firetower\` against an isolated stack on 127.0.0.1:${plan.control.value}.`,
    "",
    `| | |`,
    `|---|---|`,
    `| serverId | \`${held?.serverId ?? "?"}\` |`,
    `| transport | frontend (playwright-core, Chrome, Vite renderer) |`,
    `| ft-server | \`--dev\`, which is the only mode the driven page's calls get past CORS |`,
    "",
  ];
  for (const capture of captures) {
    lines.push(`### ${capture.name}`);
    lines.push("");
    if (capture.feature) lines.push(`Feature \`${capture.feature}\`, entered at \`${capture.entry ?? capture.state ?? "?"}\`.`);
    lines.push("");
    lines.push("The action:");
    lines.push("");
    lines.push("```");
    lines.push(capture.command ?? "?");
    lines.push("```");
    lines.push("");
    if (capture.screenshot) lines.push(`![${capture.name}](./${path.basename(capture.screenshot)})`);
    lines.push("");
    if (capture.snapshot) {
      lines.push("<details><summary>Accessibility snapshot — a screenshot verifies layout and never a value</summary>");
      lines.push("");
      lines.push("```");
      lines.push((capture.snapshotText ?? "").slice(0, 4000));
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    if (capture.readback) {
      lines.push(`Read back from a second view: \`${capture.readback.how}\` -> \`${JSON.stringify(capture.readback.saw).slice(0, 400)}\``);
      lines.push("");
    }
    /* Two different things, and the comment used to call the second one the
       first. An uncaught page error means the capture is not evidence of
       anything — `drive` fails the run on one. A console error is worth
       reading and does not fail a run; a 404 for a font is not a page error,
       and publishing it as one overstates what the capture found. */
    lines.push(`Uncaught page errors: ${capture.pageErrors?.length ?? 0}${capture.pageErrors?.length ? "" : " — the page threw nothing while being driven"}`);
    lines.push("");
    if (capture.pageErrors?.length) {
      for (const e of capture.pageErrors.slice(0, 5)) lines.push(`- \`${e.slice(0, 200)}\``);
      lines.push("");
    }
    if (capture.consoleErrors?.length) {
      lines.push(`Console errors, which do not fail a run: ${capture.consoleErrors.length}`);
      lines.push("");
      for (const e of capture.consoleErrors.slice(0, 5)) lines.push(`- \`${e.slice(0, 200)}\``);
      lines.push("");
    }
  }
  lines.push("### What this does not prove");
  lines.push("");
  lines.push("A Chrome run proves the React app and nothing below `desktop/src/bridge.ts`.");
  lines.push("That file exists to hold a browser implementation apart from a native one, so every");
  lines.push("member of it differs between the two: most are unavailable here, and `save` differs by");
  lines.push("running anyway, which is worse — the run passes and looks like evidence.");
  lines.push("`open.ts`, `drag.ts`, `update.ts` and `telemetry.ts` reach Tauri past the bridge,");
  lines.push("as do `ui/Resize.tsx`, the Windows tray and the HTML5 drop path. Run");
  lines.push("`control-firetower limits --touched <path>` before writing \"verified\".");
  lines.push("");
  lines.push("### How this evidence was sanitised");
  lines.push("");
  lines.push("This comment is public. Before posting, `control-firetower` scrubbed this run's own");
  lines.push("administrator password and bearer token out of the snapshot text, the readback and");
  lines.push("the console lines, blanked the values of secret-named fields — Playwright's");
  lines.push("accessibility snapshot *does* contain the value of an `<input type=\"password\">`,");
  lines.push("measured, so masking on screen is not enough — and neutralised markdown in captured");
  lines.push("text. **Screenshots cannot be sanitised**: PNG bytes are what the screen showed. The");
  lines.push("control is that a run captures its own isolated stack with synthetic data, never a");
  lines.push("populated real account.");
  lines.push("");
  return lines.join("\n");
}

async function post(plan, captures, flags) {
  const unposted = captures.filter((c) => !c.postedAt);
  if (!flags.pr) {
    return fail(EXIT.usage, {
      problem: "evidence post needs a pull request number",
      because: ["there is no default: posting to the wrong pull request is not recoverable"],
      instead: [
        "control-firetower evidence post --pr <number>",
        "control-firetower evidence hold                  if there is no pull request yet",
      ],
    });
  }
  if (!unposted.length) {
    return fail(EXIT.precondition, {
      problem: "there is nothing unposted to post",
      because: [`${captures.length} capture(s) recorded, all already posted`],
      instead: [
        "control-firetower drive open <state> --as <name>   capture something first",
        `control-firetower evidence verify --pr ${flags.pr}        confirm what is already up`,
      ],
    });
  }

  const held = readLock(plan).run;

  /* The explicit sanitisation step, run over everything about to be
     published, and reported rather than done quietly. `drive` already
     sanitised at capture time so nothing unredacted was persisted; this is
     the pass whose result the operator reads before the comment goes up. */
  const secrets = runSecrets(held);
  const cleaned = unposted.map((capture) => sanitiseCapture(capture, secrets));
  const scrubbed = [...new Set(cleaned.flatMap((c) => c.removed))];
  const publishing = cleaned.map((c) => c.capture);
  const text = body(plan, publishing, held);
  const file = path.join(plan.evidence, "comment.md");
  /* The attachment path has to be written the way the body writes it, or gh
     does not rewrite the reference — it uploads the asset and APPENDS it
     instead, leaving the body pointing at a local path that renders as a
     broken image. Measured on the first real post. So: run gh from the
     evidence directory and name both sides `./<file>`. */
  const attached = publishing.filter((c) => c.screenshot && existsSync(c.screenshot));
  const attachments = attached.map((c) => `./${path.basename(c.screenshot)}#${c.name}`);
  const args = ["pr", "comment", String(flags.pr), "--body-file", path.basename(file)];
  if (flags.repo) args.splice(3, 0, "--repo", flags.repo);
  for (const attachment of attachments) args.push("--attach", attachment);

  if (flags["dry-run"]) {
    writeFileSync(file, text);
    say("");
    say(`${dim("dry run")} nothing has been posted`);
    say("");
    table([
      "Would run",
      ["gh", `gh ${args.join(" ")}  ${dim(`(from ${plan.evidence})`)}`],
      ["body", `${file}  ${dim(`${text.length} bytes, written so you can read it`)}`],
      ["attach", attachments.length ? attachments.map((a) => path.basename(a)).join(", ") : "none"],
    ]);
    say("");
    table(["Sanitised", ...sanitationRows(cleaned, scrubbed)]);
    say("");
    say(`  ${dim("then")} control-firetower evidence verify --pr ${flags.pr}`);
    say("");
    return emit({ dryRun: true, gh: ["gh", ...args], bodyFile: file, attachments, sanitised: scrubbed, images: cleaned.flatMap((c) => c.images) });
  }

  writeFileSync(file, text);
  let stdout;
  try {
    ({ stdout } = await run("gh", args, { cwd: plan.evidence, maxBuffer: 1 << 24 }));
  } catch (error) {
    return fail(EXIT.failed, {
      problem: "gh did not post the comment, so nothing is durable yet",
      because: String(error.stderr ?? error.message).trim().split("\n").slice(-6),
      instead: [
        "gh auth status                       is this shell authenticated",
        `gh ${args.join(" ")}`,
        "",
        "Do NOT clean up. The captures are still the only copy:",
        `  ${plan.evidence}`,
      ],
    });
  }
  const url = stdout.trim().split("\n").filter(Boolean).pop() ?? null;
  const postedAt = new Date().toISOString();
  const sanitisedCaptures = new Map(publishing.map((c) => [c.name, c]));
  updateLock(plan, {
    evidence: captures.map((c) =>
      unposted.includes(c) ? { ...(sanitisedCaptures.get(c.name) ?? c), postedAt, comment: url } : c,
    ),
    posted: [...(held?.posted ?? []), { at: postedAt, pr: flags.pr, comment: url, captures: unposted.map((c) => c.name), sanitised: scrubbed }],
  });

  /* The manifest `verify` will use. Built here, once, from the comment GitHub
     actually rendered — and every entry has to clear the approved origin and
     path shape before it is written down. Nothing downstream of this point
     ever derives a request target from comment text. */
  const manifest = await recordAttachments(plan, { repo: flags.repo, comment: url, expected: attached });

  say("");
  table([
    "Posted",
    ["comment", url ?? "(gh printed no URL)"],
    ["captures", unposted.map((c) => c.name).join(", ")],
    ["attachments", manifest.ok ? `${manifest.attachments.length} recorded, each on ${ATTACHMENT_ORIGIN}` : manifest.why],
  ]);
  say("");
  table(["Sanitised", ...sanitationRows(cleaned, scrubbed)]);
  say("");
  if (!manifest.ok) {
    return fail(EXIT.evidence, {
      problem: "the comment is posted, but its attachments could not be recorded as this run's, so it is not verifiable",
      because: [
        manifest.why,
        `an attachment is only recorded when it is on ${ATTACHMENT_ORIGIN} at /user-attachments/assets/<uuid> and its alt text is a capture this run attached`,
        "verify will only ever check a URL recorded here — never one read back out of the comment body — so an unrecordable attachment stays unverified rather than being trusted",
      ],
      instead: [
        `open ${url ?? "the comment"}                     look at what rendered`,
        `control-firetower evidence post --pr ${flags.pr}    post again, which uploads the images again`,
        "",
        "Do not clean up. The captures are still the only copy:",
        `  ${plan.evidence}`,
      ],
      detail: { cause: "attachment-unrecordable", comment: url },
    });
  }
  say(`  ${warn()} not yet verified. ${dim(`control-firetower evidence verify --pr ${flags.pr}`)}`);
  say("");
  return emit({ posted: true, comment: url, captures: unposted.map((c) => c.name), attachments: manifest.attachments, sanitised: scrubbed });
}

/**
 * Read the comment back and confirm each attachment resolves.
 *
 * Until this passes, nothing may be cleaned up — and "could not confirm" is
 * not a pass. The usual reason a reviewer sees a broken image is that the
 * attachment went up but the body still points at a local path.
 */
async function verify(plan, captures, flags) {
  const held = readLock(plan).run;
  const posted = held?.posted ?? [];
  const last = posted[posted.length - 1];
  if (!last) {
    return fail(EXIT.precondition, {
      problem: "nothing has been posted, so there is no comment to verify",
      because: [`${captures.length} capture(s) recorded, none posted`],
      instead: ["control-firetower evidence post --pr <number>"],
    });
  }
  const id = last.comment?.split("#issuecomment-").pop();
  const repo = flags.repo ?? (await originRepo(plan));
  if (!id || !repo) {
    return fail(EXIT.precondition, {
      problem: "the posted comment cannot be read back",
      because: [`comment url ${last.comment ?? "none"}`, `repo ${repo ?? "unknown"}`],
      instead: [
        "control-firetower evidence verify --repo <owner/name>",
        `gh api repos/<owner>/<name>/issues/comments/<id>    read it by hand`,
      ],
    });
  }

  /* **The manifest, and only the manifest.** `post` recorded one URL per
     attachment it uploaded, each already checked against the approved origin
     and path shape. They are re-checked here rather than trusted, because the
     lock is a file on disk — but under no circumstances is a URL taken out of
     the comment body, which is where an accessibility snapshot of a driven
     application goes and therefore where attacker-chosen text goes. */
  const recorded = held?.attachments ?? [];
  if (!recorded.length) {
    return fail(EXIT.evidence, {
      problem: "no attachment is recorded for this run, so there is nothing that may be verified",
      because: [
        `${last.comment} was posted, and the lock records no attachment URL for it`,
        "verify checks a recorded manifest, not the comment body: the body contains a fenced accessibility snapshot of the driven application, so a URL found in it is a URL the page chose",
      ],
      instead: [
        `control-firetower evidence post --pr ${flags.pr ?? last.pr}    post again, which records the manifest`,
        `open ${last.comment}                         or read the comment yourself`,
        "",
        "Do not clean up. Until a reviewer can see it, it is not proof.",
      ],
      detail: { cause: "no-attachment-recorded" },
    });
  }

  const rejected = recorded.map((a) => ({ ...a, check: approvedAttachment(a.url) })).filter((a) => !a.check.ok);
  if (rejected.length) {
    return fail(EXIT.evidence, {
      problem: `${rejected.length} recorded attachment URL(s) are not on the one origin this command will send a credential to`,
      because: [
        ...rejected.map((a) => `${a.url} — ${a.check.why}`),
        `the only approved destination is ${ATTACHMENT_ORIGIN}/user-attachments/assets/<uuid>`,
        "a GitHub token is needed to read a private repository's attachment, so it must go only to an origin decided here and never to one anything else chose",
      ],
      instead: [
        `cat ${plan.lock}                      read what is recorded`,
        `control-firetower evidence post --pr ${flags.pr ?? last.pr}   post again from the captures on disk`,
        "",
        "This refuses rather than falling back to scanning the comment for images. That",
        "fallback is what sent the operator's GitHub token to a host named by captured",
        "page text.",
      ],
      detail: { cause: "attachment-not-approved" },
    });
  }

  let comment;
  try {
    const { stdout } = await run("gh", ["api", `repos/${repo}/issues/comments/${id}`], { maxBuffer: 1 << 24 });
    comment = JSON.parse(stdout);
  } catch (error) {
    return fail(EXIT.failed, {
      problem: "reading the comment back failed, so the proof is unconfirmed",
      because: String(error.stderr ?? error.message).trim().split("\n").slice(-4),
      instead: [`gh api repos/${repo}/issues/comments/${id}`, "Do not clean up until this reads back."],
    });
  }

  /* The body is asked one question — does it contain the URL that was
     recorded — and never asked to supply one. A recorded attachment the
     comment does not reference is a broken image for a reviewer. */
  const text = String(comment.body ?? "");
  const missing = recorded.filter((a) => !text.includes(a.url));
  const token = await ghToken();
  const resolved = [];
  for (const attachment of recorded) {
    resolved.push({ name: attachment.name, ...(await reaches(attachment.url, token)) });
  }

  const broken = resolved.filter((r) => !r.ok);
  say("");
  table([
    "Comment",
    ["url", last.comment],
    ["attachments", `${recorded.length} recorded for this run, all on ${ATTACHMENT_ORIGIN}`],
    ["in the body", missing.length ? `${missing.length} recorded attachment(s) are NOT referenced by the comment` : "every recorded attachment is referenced"],
    ...resolved.map((r) => [r.ok ? "resolves" : "BROKEN", `${r.ok ? `${r.status} ${r.type}` : r.why}  ${r.url.slice(0, 72)}`, r.ok ? tick() : cross()]),
  ]);
  say("");

  if (missing.length || broken.length) {
    return fail(EXIT.evidence, {
      problem: "the comment is up but its proof does not render for a reviewer",
      because: [
        ...missing.map((a) => `${a.url} is recorded for capture "${a.name}" and the comment body does not reference it`),
        ...broken.map((b) => `${b.url} -> ${b.status ?? b.why}`),
      ],
      instead: [
        "Post again with --attach so gh rewrites the reference to the uploaded asset:",
        `  control-firetower evidence post --pr ${flags.pr ?? last.pr}`,
        "",
        "Do not clean up. Until a reviewer can see it, it is not proof.",
      ],
      detail: { cause: "attachment-broken" },
    });
  }

  updateLock(plan, { verified: { at: new Date().toISOString(), comment: last.comment, images: resolved.length } });
  say(`  ${tick()} ${resolved.length} attachment(s) resolve. Cleanup is allowed from here.`);
  say("");
  say(`  ${dim("next")} control-firetower down --all`);
  say("");
  return emit({ verified: true, comment: last.comment, images: resolved });
}

/**
 * Record the attachments GitHub rendered, as the manifest `verify` will use.
 *
 * Read back once, here, under three conditions that all have to hold:
 * the URL clears `approvedAttachment`, its alt text is the name of a capture
 * this post attached, and the count matches what was uploaded. A reference
 * that fails any of them is not recorded, and an unrecordable post is a
 * refusal rather than a post with a looser manifest — because the looser
 * manifest is the bug.
 */
async function recordAttachments(plan, { repo, comment, expected }) {
  if (!expected.length) return { ok: true, attachments: [] };
  const id = comment?.split("#issuecomment-").pop();
  const where = repo ?? (await originRepo(plan));
  if (!id || !where) return { ok: false, why: `cannot read the comment back (url ${comment ?? "none"}, repo ${where ?? "unknown"})` };

  let body;
  try {
    const { stdout } = await run("gh", ["api", `repos/${where}/issues/comments/${id}`], { maxBuffer: 1 << 24 });
    body = String(JSON.parse(stdout).body ?? "");
  } catch (error) {
    return { ok: false, why: `reading the comment back failed: ${String(error.stderr ?? error.message).trim().split("\n").pop()}` };
  }

  const wanted = new Set(expected.map((c) => c.name));
  const attachments = [];
  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const [, alt, candidate] = match;
    if (!wanted.has(alt)) continue;
    const approved = approvedAttachment(candidate);
    if (!approved.ok) continue;
    if (attachments.some((a) => a.name === alt)) continue;
    attachments.push({ name: alt, url: approved.url, recordedAt: new Date().toISOString() });
  }

  if (attachments.length !== expected.length) {
    return {
      ok: false,
      why: `${expected.length} image(s) were attached and ${attachments.length} approved attachment URL(s) could be matched to them in the rendered comment`,
    };
  }
  updateLock(plan, { attachments: [...(readLock(plan).run?.attachments ?? []), ...attachments] });
  return { ok: true, attachments };
}

/** What the sanitisation step did, as rows. Images are named, never claimed clean. */
function sanitationRows(cleaned, scrubbed) {
  const images = cleaned.flatMap((c) => c.images);
  return [
    ["text", scrubbed.length ? `removed ${scrubbed.join("; ")}` : "nothing matched a secret this run knows about"],
    ["snapshot", "secret-named field values blanked; code fences and image syntax in captured text neutralised"],
    ["images", images.length
      ? `${images.length} PNG(s) PUBLISHED AS CAPTURED — pixels cannot be redacted. ${dim("Capture synthetic data only")}`
      : "none"],
  ];
}

function hold(plan, captures) {
  const unposted = captures.filter((c) => !c.postedAt);
  say("");
  table([
    "Held",
    ["where", plan.evidence],
    ["captures", unposted.length ? unposted.map((c) => c.name).join(", ") : "none"],
    ["survives", `this session ending — ${plan.evidence} is outside the checkout`],
    ["does not survive", "this machine being rebooted, or /tmp being swept"],
  ]);
  say("");
  say("  There is nowhere to post this yet. What has to happen to it:");
  say("");
  say("    1  open the pull request the change belongs to");
  say("    2  control-firetower evidence post --pr <number>");
  say("    3  control-firetower evidence verify --pr <number>");
  say("    4  only then control-firetower down --all");
  say("");
  say(`  ${warn()} If this session ends first, nothing recovers it: the stack is swept before`);
  say("      the worktree, and the next session gets a fresh workspace that knows nothing");
  say("      about that path. Unposted evidence is the failure state, not a to-do.");
  say("");
  return emit({ held: unposted.map((c) => c.name), where: plan.evidence }, unposted.length ? EXIT.evidence : EXIT.ok);
}

/**
 * Does this attachment actually resolve to bytes?
 *
 * Two hops, and following them automatically does not work. A
 * `user-attachments/assets/<id>` URL answers 302 to a *signed* S3 URL — which
 * it does even anonymously — and S3 then rejects the request if the
 * Authorization header is carried along with the signature, which is where
 * the 403 came from the first time this was run. So: ask GitHub with the
 * token and do not follow, then ask S3 for one byte with no credentials at
 * all.
 *
 * "Could not confirm" is reported as broken rather than as a pass, because
 * the whole point of this step is that a reviewer can see the picture.
 */
async function reaches(url, token) {
  /* Belt and braces: this is the only function that attaches a credential,
     so it re-checks its own argument rather than relying on every caller
     having done so. There is exactly one approved destination. */
  const approved = approvedAttachment(url);
  if (!approved.ok) {
    return { url, status: null, ok: false, why: `refused before any request: ${approved.why}` };
  }
  try {
    const hop = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const location = hop.headers.get("location");
    /* The redirect target is GitHub's choice of signed S3 URL and gets no
       credential — that is what the 403 the first run hit was about. It is
       still checked for a scheme, because an asset hop is https or it is not
       an asset hop. */
    if (location && !/^https:\/\//.test(location)) {
      return { url, status: hop.status, ok: false, why: `the attachment redirected to ${location.slice(0, 60)}, which is not https` };
    }
    if (!location) {
      return { url, status: hop.status, ok: hop.ok, why: hop.ok ? null : `HTTP ${hop.status} and no redirect${token ? "" : ", and there was no gh token to ask with"}` };
    }
    const asset = await fetch(location, {
      method: "GET",
      headers: { range: "bytes=0-0" },
      signal: AbortSignal.timeout(15_000),
    });
    const type = asset.headers.get("content-type") ?? "";
    const ok = asset.ok && /^(image|video)\//.test(type);
    return {
      url,
      status: asset.status,
      ok,
      type,
      why: ok ? null : `the asset answered ${asset.status} ${type || "with no content type"}`,
    };
  } catch (error) {
    return { url, status: null, ok: false, why: `could not be reached: ${error.message}` };
  }
}

async function ghToken() {
  try {
    const { stdout } = await run("gh", ["auth", "token"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function originRepo(plan) {
  try {
    const { stdout } = await run("git", ["-C", plan.checkout, "remote", "get-url", "origin"]);
    const match = stdout.trim().match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
