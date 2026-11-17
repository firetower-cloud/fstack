/**
 * Does a changed file reach the native surface?
 *
 * The question `limits --touched` has to answer, and the reason this file
 * exists rather than a list of filenames: **reachability is a property of the
 * import graph, not of a path.** `desktop/src/ui/Titlebar.tsx` is the proof.
 * Its name says nothing, it is not on anybody's list of native modules, and
 * its line 29 is `import { drag } from "~/drag"` — the one module whose
 * `startDragging()` call Chrome cannot reach at all. A denylist of filenames
 * called it safe. The graph does not.
 *
 * So the answer is computed, from the checkout, by walking imports from the
 * touched file until either the native surface is reached or the whole
 * reachable set has been read. And the default runs closed: a graph that
 * cannot be resolved is *outside*, because "I could not work out whether this
 * file reaches Tauri" is a thing that went wrong, and the reassuring reading
 * of a thing that went wrong is how a run reports "verified" for code it
 * never exercised. Firetower's own rule, at `desktop/src/servers.ts:15-44`:
 * not knowing that it is forbidden is not permission.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

/** `~/x` is `desktop/src/x` — desktop/vite.config.ts:17, desktop/tsconfig.json:15. */
const ALIAS = /^~\/(.*)$/;
const CODE = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
/** Imported for their bytes, not their behaviour. A leaf, not an unknown. */
const ASSET = /\.(css|scss|svg|png|jpe?g|gif|webp|woff2?|ttf|json|md|txt|wasm|ico)$/;

/**
 * The native surface, as modules rather than as capabilities.
 *
 * Every entry is a module that `limits`'s own research table already records
 * as unreachable or differently-reachable from a browser — the `where` column
 * of BRIDGE and PAST_BRIDGE. A file is outside the frontend transport if it
 * *is* one of these or if it can reach one, however many hops away.
 */
export const NATIVE = [
  ["desktop/src/bridge.ts", "bridge.ts is the native surface itself: the file exists to hold a browser implementation apart from a native one, so every member of it differs between the two. Some are absent in Chrome; the dangerous ones are those a browser can approximate rather than refuse — save and loadArtifact today — because an approximation passes a test that a refusal would fail"],
  ["desktop/src/open.ts", "open.ts reaches plugin-opener directly, past the bridge"],
  ["desktop/src/drag.ts", "drag.ts calls startDragging() on the Tauri window; Chrome's tauriWindow() is null"],
  ["desktop/src/update.ts", "update.ts is the updater; in Chrome it is mocked end to end"],
  ["desktop/src/telemetry.ts", "telemetry.ts reads the app version from api/app, which is absent in a browser"],
  ["desktop/src/platform.ts", "platform detection reads userAgentData and falls back to navigator.platform. userAgentData is Chromium-only, so Chrome always takes the first branch and the non-Chromium webviews Firetower ships on always take the fallback — the branch a Chrome run can never execute"],
  ["desktop/src/ui/Resize.tsx", "the resize strips are window-server gestures, and may not be drivable by any automated route"],
  ["desktop/src/ui/drop.ts", "the HTML5 drop path can only be driven with a synthetic DataTransfer; a real OS file drop needs a human"],
  ["desktop/src/skills.ts", "skills.ts carries the file-drop path (:168-181), which Chrome can only fake"],
];

/** Paths that are outside before any graph is walked, and why. */
const OUTSIDE_BY_LOCATION = [
  [/^desktop\/src-tauri\//, "anything under src-tauri is the shell: not loaded, not compiled and not reachable in a Chrome run"],
  [/(^|\/)tauri(\.[a-z]+)?\.conf\.json$/, "the Tauri configuration decides how the shipped window and its webview are set up — the CSP and the titlebar mechanism among them — and Vite applies none of it"],
  [/^desktop\/scripts\//, "the packaging scripts and the installer matrix are not observable from a browser tab"],
  [/^\.github\/workflows\//, "a workflow is not loaded by the page; the shell transport's own evidence comes out of one"],
  [/^crates\//, "a Rust crate is compiled, not served to the page. A browser executes none of it, and nothing a Chrome run does measures it"],
  [/^migrations\//, "a SQL migration is applied by the server to its database. A Chrome run can observe a consequence of one through the API; it cannot carry a claim about the migration"],
  [/^mobile\//, "mobile/ is a different application on a different runtime from the desktop renderer this transport drives; a Chrome run against that renderer carries no claim about it"],
  [/^web\//, "web/ is a different application from the desktop renderer this transport drives"],
  [/^api\//, "api/ is the interface description the clients are generated from, not code the page runs: a Chrome run exercises whatever was generated, never this"],
  [/^(deploy|install|fixtures|docs)\//, "not application code the renderer loads"],
];

/**
 * A `@tauri-apps/*` import is the native surface by definition, wherever it
 * appears. Some of the modules above are listed because they do exactly this;
 * this rule is what catches the next one, without anybody having to notice.
 */
const TAURI_PACKAGE = /^@tauri-apps\//;

/* Enough of an import parser to find edges. `from "x"`, bare `import "x"`,
   dynamic `import("x")`, and re-exports — a re-export is an import for this
   purpose, because the module is still evaluated.
 *
 * This is a regular expression and not a parser, and the two ways that can be
 * wrong are not symmetrical:
 *
 *   over-matching   comments are not stripped, so a commented-out import
 *                   counts as an edge. That can only move a verdict towards
 *                   "outside", which is the safe direction
 *   under-matching  an edge this misses would move a verdict towards
 *                   "inside", which is the unsafe direction. The one real
 *                   case is a specifier that is not a literal —
 *                   `import(somePath)` — so that is detected separately
 *                   below and read as unresolved rather than as absent
 */
const EDGES = /(?:^|[\s;}])(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[\s;])import\s*["']([^"']+)["']/gm;

/**
 * A dynamic import or require whose argument is not a string literal.
 *
 * `import("~/ui/StylePage")` is an edge this can follow. `import(whatever)`
 * is a module chosen at runtime, and a graph with an edge pointing at an
 * unknown is not a graph that was walked — so it reads as unresolved, which
 * reads as outside. Today's checkout has none; this is what catches the first
 * one somebody writes.
 */
const COMPUTED = /\b(?:import|require)\s*\(\s*(?!["'])(?!\s*\))/g;

function edges(file) {
  const text = readFileSync(file, "utf8");
  const found = [];
  for (const match of text.matchAll(EDGES)) found.push(match[1] ?? match[2] ?? match[3]);
  for (const match of text.matchAll(COMPUTED)) {
    /* `import.meta`, `import type`, and a bare `import(` at the start of a
       line continuation are not calls with a computed argument. */
    const after = text.slice(match.index, match.index + 60);
    if (/^import\s*\(\s*\/\*/.test(after)) continue;
    found.push({ computed: after.split("\n")[0].trim() });
  }
  return found;
}

function isFile(at) {
  try {
    return statSync(at).isFile();
  } catch {
    return false;
  }
}

/** One specifier, resolved the way Vite resolves it for this app. */
function resolveSpecifier(from, specifier, src) {
  const aliased = specifier.match(ALIAS);
  let base;
  if (aliased) base = path.join(src, aliased[1]);
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(path.dirname(from), specifier);
  else return TAURI_PACKAGE.test(specifier) ? { kind: "native", specifier } : { kind: "external", specifier };

  for (const extension of ["", ...CODE]) {
    const candidate = base + extension;
    if (isFile(candidate)) {
      return CODE.includes(path.extname(candidate)) ? { kind: "module", file: candidate } : { kind: "asset", file: candidate };
    }
  }
  for (const extension of CODE) {
    const candidate = path.join(base, `index${extension}`);
    if (isFile(candidate)) return { kind: "module", file: candidate };
  }
  if (ASSET.test(specifier)) return { kind: "asset", file: base };
  return { kind: "unresolved", specifier };
}

/**
 * Walk from one file and say whether it reaches the native surface.
 *
 * Breadth first, so the chain reported is the shortest one — which is what
 * makes the refusal actionable. A reader who is told
 * `ui/Home.tsx -> data.ts -> update.ts` can go and look; one who is told
 * "reaches the native surface" cannot.
 *
 * Returns `{ outside, why, chain }`. `outside: false` is only ever returned
 * after the entire reachable set has been read and none of it was native.
 */
export function reachesNative(given, checkout) {
  const relative = given.replace(/^\.\//, "");
  for (const [pattern, why] of OUTSIDE_BY_LOCATION) {
    if (pattern.test(relative)) return { outside: true, why, chain: [relative], how: "location" };
  }
  if (!/^desktop\/src\//.test(relative)) {
    return {
      outside: true,
      how: "location",
      chain: [relative],
      why: "only desktop/src/ is loaded by the page this transport drives, so nothing outside it can be established from a Chrome run",
    };
  }
  if (!checkout) {
    return {
      outside: true,
      how: "unresolved",
      chain: [relative],
      why: "the import graph could not be walked: there is no Firetower checkout to read it from, and a graph that cannot be resolved is outside rather than inside",
    };
  }

  const src = path.join(checkout, "desktop", "src");
  const start = path.join(checkout, relative);
  if (!existsSync(start)) {
    return {
      outside: true,
      how: "unresolved",
      chain: [relative],
      why: `${relative} is not in ${checkout}, so its imports cannot be read — and an unreadable graph is outside rather than inside`,
    };
  }
  const native = new Map(NATIVE.map(([file, why]) => [path.join(checkout, file), why]));

  const from = new Map([[start, null]]);
  const queue = [start];
  const chainTo = (file, tail) => {
    const chain = [];
    for (let at = file; at; at = from.get(at)) chain.unshift(path.relative(checkout, at));
    return tail ? [...chain, tail] : chain;
  };

  while (queue.length) {
    const file = queue.shift();
    if (native.has(file)) return { outside: true, how: "import graph", chain: chainTo(file), why: native.get(file) };

    let specifiers;
    try {
      specifiers = edges(file);
    } catch (error) {
      return {
        outside: true,
        how: "unresolved",
        chain: chainTo(file),
        why: `${path.relative(checkout, file)} could not be read (${error.code ?? error.message}), so the graph is incomplete — and an incomplete graph is outside`,
      };
    }

    for (const specifier of specifiers) {
      if (typeof specifier === "object") {
        return {
          outside: true,
          how: "unresolved",
          chain: chainTo(file, specifier.computed),
          why: `${path.relative(checkout, file)} imports a module chosen at runtime (${specifier.computed}), so what it reaches cannot be established — and an unestablished graph is outside, not inside`,
        };
      }
      const resolved = resolveSpecifier(file, specifier, src);
      if (resolved.kind === "native") {
        return {
          outside: true,
          how: "import graph",
          chain: chainTo(file, resolved.specifier),
          why: `${resolved.specifier} is the Tauri API itself; in Chrome it is absent or stubbed`,
        };
      }
      if (resolved.kind === "external" || resolved.kind === "asset") continue;
      if (resolved.kind === "unresolved") {
        return {
          outside: true,
          how: "unresolved",
          chain: chainTo(file, resolved.specifier),
          why: `"${resolved.specifier}" could not be resolved from ${path.relative(checkout, file)}, so what it reaches is unknown — and an unknown is outside, not inside`,
        };
      }
      if (!from.has(resolved.file)) {
        from.set(resolved.file, file);
        queue.push(resolved.file);
      }
    }
  }

  return {
    outside: false,
    how: "import graph",
    chain: [relative],
    modules: from.size,
    why: `${from.size} module(s) reachable from ${relative} were read and none of them is the native surface, so a Chrome run can carry a claim about this file`,
  };
}
