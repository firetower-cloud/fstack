/**
 * `limits --touched` is an allowlist, and these are the paths that proved it
 * had to be.
 *
 * Every path below is one QA found the previous denylist calling **safe**, on
 * a real firetower checkout. The denylist was twelve regular expressions with
 * an open default, so anything matching none of them was reported
 * `provable: true, "a Chrome run can carry a claim about the React app here"`
 * — including a Rust crate and a SQL migration.
 *
 * **Why a fixture rather than the checkout.** The mechanism under test is an
 * import-graph walk, and it has to be provable on a machine with no firetower
 * checkout at all — a CI runner, a clean laptop — or it would quietly become
 * a no-op exactly where it matters. So the fixture is a miniature checkout
 * with the same shape and the same edges: `api/download.ts` imports
 * `~/bridge`, `ui/Titlebar.tsx` imports `~/drag`, and the chain through
 * `data.ts` is three hops deep the way the real one is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkTouched } from "../lib/limits.mjs";
import { reachesNative } from "../lib/reach.mjs";

/** A miniature firetower checkout: the files, and the edges between them. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "verify-firetower-limits-"));
  const write = (relative, text) => {
    const at = path.join(root, relative);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, text);
    return at;
  };
  write("crates/ft-server/Cargo.toml", "[package]\nname = \"ft-server\"\n");

  /* The native surface. */
  write("desktop/src/bridge.ts", 'import { invoke } from "@tauri-apps/api/core";\nexport const bridge = { invoke };\n');
  write("desktop/src/open.ts", 'import { openUrl } from "@tauri-apps/plugin-opener";\nexport const openExternal = openUrl;\n');
  write("desktop/src/drag.ts", 'import { getCurrentWindow } from "@tauri-apps/api/window";\nexport const drag = { getCurrentWindow };\n');
  write("desktop/src/update.ts", 'import { check } from "@tauri-apps/plugin-updater";\nexport const update = check;\n');
  write("desktop/src/telemetry.ts", 'import { getVersion } from "@tauri-apps/api/app";\nexport const version = getVersion;\n');
  write("desktop/src/platform.ts", "export const isMac = true;\n");
  write("desktop/src-tauri/src/main.rs", "fn main() {}\n");
  write("desktop/src-tauri/tauri.conf.json", "{}\n");

  /* The ones QA found called safe, with the real import that makes each one
     reach the surface. */
  write("desktop/src/api/download.ts", 'import { bridge } from "~/bridge";\nimport { apiBase } from "~/client/http";\nexport const save = bridge;\n');
  write("desktop/src/ui/ArtifactTab.tsx", 'import { openExternal } from "~/open";\nimport { Pop } from "~/ui/Pop";\nexport const Tab = () => null;\n');
  write("desktop/src/artifacts/posters.tsx", 'import { bridge } from "~/bridge";\nexport const shoot = bridge;\n');
  /* The one the filename denylist could never have caught: nothing in its
     name says native, and it imports a module that is on every list. */
  write("desktop/src/ui/Titlebar.tsx", 'import { Pop } from "~/ui/Pop";\nimport { drag } from "~/drag";\nexport const Titlebar = () => null;\n');
  /* And a three-hop chain, which is the real ui/Home.tsx -> data.ts ->
     update.ts. */
  write("desktop/src/data.ts", 'import { update } from "~/update";\nexport const why = update;\n');
  write("desktop/src/ui/Home.tsx", 'import { why } from "~/data";\nexport const Home = () => null;\n');

  /* And the ones that genuinely are inside. */
  write("desktop/src/client/http.ts", "export const apiBase = \"/api/v1\";\n");
  write("desktop/src/ui/Pop.tsx", 'import "./pop.css";\nexport const Pop = () => null;\n');
  write("desktop/src/ui/pop.css", ".pop {}\n");
  write("desktop/src/ui/ContextMenu.tsx", 'import { Pop } from "~/ui/Pop";\nimport { apiBase } from "~/client/http";\nexport const Menu = () => null;\n');

  /* Other applications and other languages. */
  write("mobile/app/(tabs)/index.tsx", "export default () => null;\n");
  write("web/app/page.tsx", "export default () => null;\n");
  write("crates/ft-server/src/lib.rs", "pub fn serve() {}\n");
  write("migrations/0001_init.sql", "CREATE TABLE tasks ();\n");

  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("every path QA found the denylist calling safe is now outside", () => {
  const { root, remove } = fixture();
  try {
    const paths = [
      /* calls bridge.save() — limits' own table says "PARTLY, AND
         MISLEADINGLY" about it */
      "desktop/src/api/download.ts",
      /* calls loadArtifact — "NO, AND THE REASON IS THE POINT" */
      "desktop/src/ui/ArtifactTab.tsx",
      /* shoot and canShoot, both hardcoded no-ops in Chrome */
      "desktop/src/artifacts/posters.tsx",
      /* imports the denylisted drag.ts; its own name is on no list */
      "desktop/src/ui/Titlebar.tsx",
      /* a Rust crate and a SQL migration, which used to be told that "a
         Chrome run can carry a claim about the React app here" */
      "crates/ft-server/src/lib.rs",
      "migrations/0001_init.sql",
      /* different applications entirely */
      "mobile/app/(tabs)/index.tsx",
      "web/app/page.tsx",
    ];
    for (const given of paths) {
      const [result] = checkTouched([given], root);
      assert.equal(result.provable, false, `${given} must be outside what a Chrome run proves`);
      assert.ok(result.why.length > 20, `${given} needs a reason an agent can act on`);
    }
  } finally {
    remove();
  }
});

test("reachability is through the import graph, not the filename", () => {
  const { root, remove } = fixture();
  try {
    /* Titlebar.tsx is the case. One hop. */
    const [titlebar] = checkTouched(["desktop/src/ui/Titlebar.tsx"], root);
    assert.equal(titlebar.how, "import graph");
    assert.deepEqual(titlebar.chain, ["desktop/src/ui/Titlebar.tsx", "desktop/src/drag.ts"]);

    /* And it works at distance: Home.tsx -> data.ts -> update.ts, which is
       the real chain in firetower 0.55.0. */
    const [home] = checkTouched(["desktop/src/ui/Home.tsx"], root);
    assert.equal(home.provable, false);
    assert.deepEqual(home.chain, ["desktop/src/ui/Home.tsx", "desktop/src/data.ts", "desktop/src/update.ts"]);
  } finally {
    remove();
  }
});

test("a module whose whole reachable set was read and is native-free is inside", () => {
  const { root, remove } = fixture();
  try {
    for (const given of ["desktop/src/ui/Pop.tsx", "desktop/src/ui/ContextMenu.tsx", "desktop/src/client/http.ts"]) {
      const [result] = checkTouched([given], root);
      assert.equal(result.provable, true, `${given} should be inside: ${result.why}`);
      assert.ok(result.modules >= 1, "it says how much of the graph it read");
    }
    /* A boundary and not a wall: the allowlist has to let the ordinary case
       through or nobody will run it. */
    assert.equal(checkTouched(["desktop/src/ui/ContextMenu.tsx"], root)[0].modules, 3);
  } finally {
    remove();
  }
});

test("a graph that cannot be walked is outside, not inside", () => {
  const { root, remove } = fixture();
  try {
    /* No checkout at all. This is the one that would have made the whole
       check a no-op if it had defaulted open. */
    const [noCheckout] = checkTouched(["desktop/src/ui/Pop.tsx"], null);
    assert.equal(noCheckout.provable, false);
    assert.equal(noCheckout.how, "unresolved");

    /* A path that is not in the checkout. */
    const [missing] = checkTouched(["desktop/src/ui/NotThere.tsx"], root);
    assert.equal(missing.provable, false);
    assert.equal(missing.how, "unresolved");

    /* A specifier that will not resolve: the file might import anything. */
    writeFileSync(path.join(root, "desktop/src/ui/Broken.tsx"), 'import { x } from "~/does/not/exist";\n');
    const [broken] = checkTouched(["desktop/src/ui/Broken.tsx"], root);
    assert.equal(broken.provable, false);
    assert.equal(broken.how, "unresolved");
    assert.match(broken.why, /could not be resolved/);
  } finally {
    remove();
  }
});

test("@tauri-apps is the native surface wherever it is imported from", () => {
  const { root, remove } = fixture();
  try {
    /* Some of NATIVE is listed because those modules do exactly this. This
       is what catches the next one, without anybody adding it to a list. */
    writeFileSync(
      path.join(root, "desktop/src/ui/Sixth.tsx"),
      'import { invoke } from "@tauri-apps/api/core";\nexport const Sixth = () => invoke("x");\n',
    );
    const seen = reachesNative("desktop/src/ui/Sixth.tsx", root);
    assert.equal(seen.outside, true);
    assert.match(seen.why, /@tauri-apps\/api\/core/);
  } finally {
    remove();
  }
});

test("an asset import is a leaf, not an unknown", () => {
  /* Pop.tsx imports ./pop.css. If that read as unresolved, every styled
     component in the application would be outside and the check would be a
     wall rather than a boundary. */
  const { root, remove } = fixture();
  try {
    assert.equal(checkTouched(["desktop/src/ui/Pop.tsx"], root)[0].provable, true);
  } finally {
    remove();
  }
});

test("a module chosen at runtime is an unestablished graph, so outside", () => {
  /* The one way a regex-based walk could under-match and therefore report
     "inside" for a file that really does reach Tauri. `import(somePath)` is
     an edge pointing at an unknown, and a graph with an unknown in it was not
     walked. firetower 0.55.0 has none of these; this is what catches the
     first one somebody writes. */
  const { root, remove } = fixture();
  try {
    writeFileSync(
      path.join(root, "desktop/src/ui/Lazy.tsx"),
      'const where = Math.random() > 0.5 ? "~/bridge" : "~/ui/Pop";\nexport const load = () => import(where);\n',
    );
    const [result] = checkTouched(["desktop/src/ui/Lazy.tsx"], root);
    assert.equal(result.provable, false);
    assert.equal(result.how, "unresolved");
    assert.match(result.why, /chosen at runtime/);

    /* And a literal dynamic import is still followed, because it is an edge
       this can resolve — which is how open.ts reaches @tauri-apps. */
    writeFileSync(
      path.join(root, "desktop/src/ui/LazyLiteral.tsx"),
      'export const load = () => import("~/ui/Pop");\n',
    );
    assert.equal(checkTouched(["desktop/src/ui/LazyLiteral.tsx"], root)[0].provable, true);
    writeFileSync(
      path.join(root, "desktop/src/ui/LazyNative.tsx"),
      'export const load = async () => (await import("~/bridge")).bridge;\n',
    );
    assert.equal(checkTouched(["desktop/src/ui/LazyNative.tsx"], root)[0].provable, false);
  } finally {
    remove();
  }
});
