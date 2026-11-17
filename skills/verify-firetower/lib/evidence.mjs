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
import { EXIT, emit, fail, say, table, dim, tick, cross, warn } from "./out.mjs";

const run = promisify(execFile);

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
      because: [held.why],
      instead: [`cat ${plan.lock}`, `ls -la ${plan.evidence}`],
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
    `${c.postedAt ? tick() : warn()} ${c.feature ? `${c.feature}  ` : ""}${path.relative(plan.evidence, c.screenshot ?? c.at ?? "")}  ${dim(c.takenAt ?? "")}`,
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
    `| isolation key | \`${plan.key}\` |`,
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
    if (capture.consoleErrors?.length) {
      lines.push(`Page errors during this capture: ${capture.consoleErrors.length}`);
      lines.push("");
      for (const e of capture.consoleErrors.slice(0, 5)) lines.push(`- \`${e.slice(0, 200)}\``);
      lines.push("");
    }
  }
  lines.push("### What this does not prove");
  lines.push("");
  lines.push("A Chrome run proves the React app and nothing below `desktop/src/bridge.ts`:");
  lines.push("eleven of its twelve members are no-ops here, and `save` and `loadArtifact` are");
  lines.push("*different gestures* rather than absent ones, so a passing run looks like evidence.");
  lines.push("`open.ts`, `drag.ts`, `update.ts` and `telemetry.ts` reach Tauri past the bridge,");
  lines.push("as do `ui/Resize.tsx`, the Windows tray and the HTML5 drop path. Run");
  lines.push("`control-firetower limits --touched <path>` before writing \"verified\".");
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
  const text = body(plan, unposted, held);
  const file = path.join(plan.evidence, "comment.md");
  const attachments = unposted
    .filter((c) => c.screenshot && existsSync(c.screenshot))
    .map((c) => `${c.screenshot}#${c.name}`);
  const args = ["pr", "comment", String(flags.pr), "--body-file", file];
  if (flags.repo) args.splice(3, 0, "--repo", flags.repo);
  for (const attachment of attachments) args.push("--attach", attachment);

  if (flags["dry-run"]) {
    writeFileSync(file, text);
    say("");
    say(`${dim("dry run")} nothing has been posted`);
    say("");
    table([
      "Would run",
      ["gh", `gh ${args.join(" ")}`],
      ["body", `${file}  ${dim(`${text.length} bytes, written so you can read it`)}`],
      ["attach", attachments.length ? attachments.map((a) => path.basename(a)).join(", ") : "none"],
    ]);
    say("");
    say(`  ${dim("then")} control-firetower evidence verify --pr ${flags.pr}`);
    say("");
    return emit({ dryRun: true, gh: ["gh", ...args], bodyFile: file, attachments });
  }

  writeFileSync(file, text);
  let stdout;
  try {
    ({ stdout } = await run("gh", args, { maxBuffer: 1 << 24 }));
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
  updateLock(plan, {
    evidence: captures.map((c) => (unposted.includes(c) ? { ...c, postedAt, comment: url } : c)),
    posted: [...(held?.posted ?? []), { at: postedAt, pr: flags.pr, comment: url, captures: unposted.map((c) => c.name) }],
  });

  say("");
  table(["Posted", ["comment", url ?? "(gh printed no URL)"], ["captures", unposted.map((c) => c.name).join(", ")]]);
  say("");
  say(`  ${warn()} not yet verified. ${dim(`control-firetower evidence verify --pr ${flags.pr}`)}`);
  say("");
  return emit({ posted: true, comment: url, captures: unposted.map((c) => c.name) });
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

  const images = [...String(comment.body).matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
  const local = images.filter((u) => !/^https?:\/\//.test(u));
  const resolved = [];
  for (const url of images.filter((u) => /^https?:\/\//.test(u))) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(10_000) });
      resolved.push({ url, status: response.status, ok: response.ok });
    } catch (error) {
      resolved.push({ url, status: null, ok: false, why: error.message });
    }
  }

  const broken = resolved.filter((r) => !r.ok);
  say("");
  table([
    "Comment",
    ["url", last.comment],
    ["images", `${images.length} referenced, ${resolved.length} absolute, ${local.length} still local`],
    ...resolved.map((r) => [r.ok ? "resolves" : "BROKEN", `${r.status ?? r.why} ${r.url.slice(0, 80)}`, r.ok ? tick() : cross()]),
  ]);
  say("");

  if (local.length || broken.length || !images.length) {
    return fail(EXIT.evidence, {
      problem: "the comment is up but its proof does not render for a reviewer",
      because: [
        ...(local.length ? [`${local.length} image reference(s) are still local paths: ${local.join(", ")}`] : []),
        ...(broken.length ? broken.map((b) => `${b.url} -> ${b.status ?? b.why}`) : []),
        ...(images.length ? [] : ["the comment body references no images at all"]),
      ],
      instead: [
        "Post again with --attach so gh rewrites the reference to the uploaded asset:",
        `  control-firetower evidence post --pr ${flags.pr ?? last.pr}`,
        "",
        "Do not clean up. Until a reviewer can see it, it is not proof.",
      ],
    });
  }

  updateLock(plan, { verified: { at: new Date().toISOString(), comment: last.comment, images: resolved.length } });
  say(`  ${tick()} ${resolved.length} attachment(s) resolve. Cleanup is allowed from here.`);
  say("");
  say(`  ${dim("next")} control-firetower down --all`);
  say("");
  return emit({ verified: true, comment: last.comment, images: resolved });
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

async function originRepo(plan) {
  try {
    const { stdout } = await run("git", ["-C", plan.checkout, "remote", "get-url", "origin"]);
    const match = stdout.trim().match(/[:/]([^/:]+\/[^/]+?)(\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
