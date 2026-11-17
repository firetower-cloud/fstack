/**
 * The bundle's citations, re-read against the checkout.
 *
 * `drive audit` re-drives every handle. Nothing re-read the ~110 `file:line`
 * citations that are the evidence for why each handle is what it is — and a
 * false one shipped: the map's one rule was justified by saying
 * `cursor-live.mjs` "still clicks Connect", five hours after that had stopped
 * being true, with the five sign-in handles citing import statements and
 * `drive audit` printing the false sentence on every run.
 *
 * So this is the test that would have caught it. It needs a checkout — the
 * citations are *into* firetower — and it says so and skips rather than
 * passing when there is none, because a check that cannot run is not a check
 * that passed.
 *
 * Where it fails, the fix is the one in SKILL.md's maintenance section:
 * update the claim **and** its citation together, having looked at the line.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CITATIONS,
  checkCitations,
  discover,
  indexCheckout,
  ledgerIndex,
  shippedFiles,
} from "../lib/citations.mjs";
import { INHERITED, inheritedTally } from "../lib/vocabulary.mjs";
import { findCheckout } from "../lib/key.mjs";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files that live at the root of the firetower checkout and have no directory. */
const ROOT_FILES = new Set(["compose.yaml", "Cargo.toml", "justfile", "version.txt"]);

/**
 * The one file allowed to write the retired claim down.
 *
 * `lib/citations.mjs` exists because that claim shipped false, and it says so
 * in its own header, quoting it. Everywhere else, writing it is the defect.
 */
const DOCUMENTS_THE_DEFECT = new Set(["lib/citations.mjs"]);

/**
 * The checkout to read citations from.
 *
 * `FT_VERIFY_CHECKOUT` first, so this can be run against a checkout anywhere;
 * then the ordinary search upwards, which is what finds it when the bundle is
 * sitting inside firetower.
 */
function checkout() {
  const asked = process.env.FT_VERIFY_CHECKOUT;
  if (asked) return existsSync(path.join(asked, "crates", "ft-server", "Cargo.toml")) ? asked : null;
  return findCheckout(SKILL);
}

test("every citation in the ledger still says what the bundle claims", (t) => {
  const co = checkout();
  if (!co) {
    t.skip(
      "no firetower checkout to read. These citations point into firetower, so " +
        "there is nothing to check them against: run from inside a checkout, or set " +
        "FT_VERIFY_CHECKOUT=/path/to/firetower. Not a pass.",
    );
    return;
  }
  const { checked, findings, moved } = checkCitations(co);
  assert.deepEqual(
    findings,
    [],
    `${findings.length} citation(s) no longer hold against ${co}:\n` +
      findings.map((f) => `  ${f.kind}  ${f.cite}  (${f.claim})\n      ${f.why}${f.saw ? `\n      the line says: ${f.saw}` : ""}`).join("\n") +
      "\n\n  Update the claim AND its citation together, having read the line. A copy whose" +
      "\n  origin is stale is worse than no copy.\n",
  );
  assert.ok(checked > 100, `only ${checked} citations were read, which is fewer than this bundle ships`);
  /**
   * Hints that have drifted. **Not a failure**, by design: for a
   * content-anchored citation the line is a convenience for a reader and the
   * string is the claim, so an upstream reflow must not turn a true statement
   * red. Said out loud anyway, because a hint nobody refreshes eventually
   * sends somebody to the wrong place — and this is the list to paste from
   * when refreshing them.
   */
  if (moved.length) {
    t.diagnostic(`${moved.length} content citation(s) have moved. The claims hold; the hints want refreshing:`);
    for (const m of moved) t.diagnostic(`  ${m.from} -> ${m.now}   (${m.claim})`);
  }
});

test("every citation written in the bundle is registered in the ledger", () => {
  const ledger = ledgerIndex();
  const found = discover(SKILL);
  const unanchored = found.filter((f) => f.unanchored);
  assert.deepEqual(
    unanchored,
    [],
    "a bare `:NNN` with no file in front of it on the same line cannot be resolved by a\n" +
      "reader either. Name the file:\n" +
      unanchored.map((f) => `  ${f.in}:${f.at}  ${f.spelling}`).join("\n"),
  );

  const missing = found.filter((f) => !ledger.has(f.key));
  const unique = [...new Map(missing.map((m) => [m.key, m])).values()];
  assert.deepEqual(
    unique,
    [],
    `${unique.length} citation(s) are written in this bundle and not registered in\n` +
      "lib/citations.mjs, so nothing re-reads them. Add each one with the string the\n" +
      "cited line has to contain:\n" +
      unique.map((m) => `  ${m.spelling}   written at ${m.in}:${m.at}`).join("\n"),
  );
});

test("the ledger has no entry nothing cites, and none of it is a duplicate", () => {
  const spellings = new Set(discover(SKILL).map((f) => f.key));
  const stale = CITATIONS.filter((c) => {
    const base = path.basename(c.cite);
    return !spellings.has(base);
  });
  assert.deepEqual(
    stale.map((s) => s.cite),
    [],
    "these are in the ledger and cited nowhere in the bundle. A citation nothing makes\n" +
      "is a citation nobody reads: either cite it or drop it.",
  );
  const seen = new Set();
  for (const entry of CITATIONS) {
    assert.ok(!seen.has(entry.cite), `${entry.cite} is in the ledger twice`);
    seen.add(entry.cite);
  }
});

test("every ledger entry says what it is claiming", () => {
  for (const entry of CITATIONS) {
    assert.match(entry.cite, /^[A-Za-z0-9_./-]+:\d+(-\d+)?$/, `${entry.cite} is not a file:line`);
    /* The repo-relative path has to be pinned here even where the prose spells
       it short, so resolution never guesses between two files of the same
       name. `compose.yaml` and the like live at the root and have no
       directory to give. */
    assert.ok(
      entry.cite.includes("/") || ROOT_FILES.has(entry.cite.split(":")[0]),
      `${entry.cite} has no directory, so it cannot be resolved without guessing. ` +
        "Pin the full repo-relative path in the ledger even where the prose spells it short.",
    );
    assert.ok(entry.claim && entry.claim.length > 4, `${entry.cite} has no claim beside it`);
    assert.ok(
      entry.expect === null || typeof entry.expect === "string" || Array.isArray(entry.expect),
      `${entry.cite} has an expect that is neither a string, an array nor null`,
    );
    assert.ok(
      entry.where === undefined || entry.where === "line" || entry.where === "content",
      `${entry.cite} has where: ${JSON.stringify(entry.where)}, and the two anchors are "line" and "content"`,
    );
    /* A content anchor needs something to anchor *on*. `where: "content"`
       with nothing quoted would check that the file exists and call it a
       verified claim, which is the shape of reassurance this module exists
       to remove. */
    assert.ok(
      entry.where !== "content" || entry.expect !== null,
      `${entry.cite} is content-anchored and quotes nothing, so there is nothing to anchor on`,
    );
  }
});

/**
 * Most of this ledger should be content-anchored, and the exceptions should be
 * deliberate.
 *
 * A line number is the perishable half of a citation — firetower#394 moved one
 * minutes after it was written — so `"line"` is for the cases where the
 * occurrence genuinely is the claim: `<Home` appears twice in `Routes.tsx` and
 * only the second is the fallthrough; `SUPPORTED: bool = true` appears once
 * for macOS and once for Windows. Those must stay keyed on the line. This
 * guards the ratio rather than the list, so adding one is fine and quietly
 * reverting to line-keyed citations wholesale is not.
 */
test("the ledger prefers content anchoring, and says so where it does not", () => {
  const byLine = CITATIONS.filter((c) => c.where !== "content");
  assert.ok(
    byLine.length < CITATIONS.length / 4,
    `${byLine.length} of ${CITATIONS.length} citations are keyed on a line number, which is the perishable form:\n` +
      byLine.map((c) => `  ${c.cite}`).join("\n"),
  );
  /* Each line-keyed entry is one where the quoted text recurs in its file, so
     content anchoring could not tell the occurrences apart. */
  for (const entry of byLine) {
    assert.ok(entry.claim, `${entry.cite} is line-keyed with no claim saying why`);
  }
});

/**
 * The shipped files are the ones a citation can hide in.
 *
 * If a new reference directory is added and not swept, the check silently
 * covers less than it says. This is the guard for that.
 */
test("the citation sweep covers every file this bundle ships", () => {
  const swept = shippedFiles(SKILL);
  for (const required of ["SKILL.md", "lib/vocabulary.mjs", "lib/drive.mjs", "lib/help.mjs", "references/features/README.md"]) {
    assert.ok(swept.includes(required), `${required} is not swept for citations`);
  }
  assert.ok(swept.length > 25, `only ${swept.length} files are swept`);
});

/**
 * The one rule's measurement, which replaced a false claim about another
 * repository. The numbers in the prose are computed from this ledger, so the
 * sentence cannot drift away from the data the way the last one did.
 */
test("the inherited ledger is the 28 handles, 6 of them wrong", () => {
  const tally = inheritedTally();
  assert.equal(tally.total, 28, "the first vocabulary was 28 handles assembled by reading");
  assert.equal(tally.wrong, 6, "6 of them were wrong when driven");
  assert.equal(tally.stood, 22);
  for (const entry of INHERITED.entries) {
    assert.ok(["stood", "wrong"].includes(entry.verdict), `${entry.handle} has verdict ${entry.verdict}`);
    assert.ok(entry.read, `${entry.handle} does not say what it was read out of`);
    if (entry.verdict === "wrong") {
      assert.ok(entry.note && entry.note.length > 20, `${entry.handle} is recorded wrong with no reason beside it`);
    }
  }
  const names = INHERITED.entries.map((e) => e.handle);
  assert.equal(new Set(names).size, names.length, "a handle is in the inherited ledger twice");
});

/**
 * The claim that rotted, kept rotted-proof.
 *
 * Nothing in the shipped prose may assert what another repository's harness
 * *currently* says. That is the shape of the bug, not just its wording: a
 * sentence about a file in another repository, printed by a tool, that nothing
 * re-reads. The measurement in `INHERITED` is the replacement, and it is
 * about what driving found rather than about what a file says today.
 */
test("the bundle makes no live claim about what the checkout's harnesses say now", () => {
  const banned = [
    { pattern: /still (?:says|clicks) ["'`]?Connect/i, why: 'a claim that cursor-live.mjs currently clicks "Connect" — it does not, and this is the exact sentence that shipped false' },
    { pattern: /harnesses[^.]{0,80}disagree with each other/i, why: "the two-harnesses-disagree narrative: it was a claim about another repository's present state, which nothing re-reads" },
    { pattern: /could not have run anywhere/i, why: "a claim about whether another repository's harness runs" },
  ];
  const offences = [];
  for (const file of shippedFiles(SKILL)) {
    if (DOCUMENTS_THE_DEFECT.has(file)) continue;
    const text = readFileSync(path.join(SKILL, file), "utf8");
    for (const { pattern, why } of banned) {
      const hit = text.match(pattern);
      if (hit) offences.push(`  ${file}: ${JSON.stringify(hit[0])}\n      ${why}`);
    }
  }
  assert.deepEqual(offences, [], `\n${offences.join("\n")}\n`);
});
