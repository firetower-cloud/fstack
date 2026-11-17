---
name: verify-firetower
description: "Verify a change to Firetower by driving the real stack rather than reading the diff: brings up an isolated ft-server, Postgres and desktop renderer that belong to this run alone, drives the desktop app in Chrome as a person would, and posts the evidence to the pull request. Use it whenever a QA pass, a regression check or a claim that something works is asked for on the firetower repository, before writing the word verified anywhere. It exists because Firetower's host is shared: the developer's own control plane usually answers on 127.0.0.1:4400 and a run that drove it would be driving the machine hosting the session. The CLI beside this file refuses that by construction, and says plainly which parts of the app a browser run cannot prove at all."
---

# Verifying Firetower against a real stack

The instrument is `control-firetower`, beside this file. **Read its `--help`
before anything else** — it is written for a reader who has never seen
Firetower, and it carries the two safety rules in full.

```sh
chmod +x ./control-firetower          # once, if git did not preserve the bit
npm install                           # once, in this directory: playwright-core
./control-firetower --help
```

It is the first non-markdown file in this library, so: it lives beside this
`SKILL.md` with its `lib/` and `test/` directories, it is a Node 22 script
with one dependency, and nothing in it is imported from the repository it
verifies. Run it from inside a firetower checkout, or pass `--checkout`.

## Before the first command: what is dangerous here

Firetower's development host is shared between every session on it.

- **The developer's own control plane is usually listening on
  `127.0.0.1:4400`, and it is what hosts these sessions.** A run that
  defaulted there would not clash over a port. It would drive its own host.
- **Never run `just reset`.** It is `docker compose down -v` plus
  `rm -rf ~/.firetower/worker` — measured at 54GB and 47 live session
  worktrees on one laptop, including the measuring session's own working
  directory. The reset unit for a verification run is this run's database,
  and `control-firetower reset` is that.
- **Never kill by process name.** `pkill -f firetower`, `pkill -f vite` or
  `pkill -f next` kills the `:4400` control plane hosting the session doing
  the killing, and every other session's processes with it.

`control-firetower` will not do any of these, and `doctor` refuses them by
name. The reason they are written out here as well is that an agent that has
run out of ideas reaches past its tools for the repository's most convenient
clean-slate command.

## Launch

```sh
./control-firetower up          # add --dry-run first on a machine you do not know
./control-firetower doctor      # up does not grade itself
```

Six steps, not four, and the two everybody misses are 4 and 6:

| | | why it is not optional |
|---|---|---|
| 1 | `cargo build -p ft-cli` | about 60s cold, 3.3GB in `target/` |
| 2 | Postgres, on a derived port | its own Compose project, named explicitly |
| 3 | `ft-server --dev` | `--dev` is the only branch that reaches `AllowOrigin::any()`; without it CORS refuses every call the driven page makes |
| 4 | `firetower passwd admin` | the first administrator carries `must_change_password` and **every authenticated route answers 403** until it is cleared |
| 5 | `POST /auth/login` | the token goes into the run lock |
| 6 | `POST /setup/organization`, `/setup/complete` | otherwise the desktop renders the setup wizard instead of the app |

Then `/bootstrap` finally has a `serverId`, and `up` records it. Measured at
7.1s warm on a Mac. A full reset back to this state is about 3s, so reset
between features rather than reusing dirty data.

Everything is derived from one isolation key — `$FIRETOWER_SESSION` inside a
session, a hash of the checkout outside one. The control-plane port, the
Postgres port, the renderer port, the Compose project, `FIRETOWER_HOME` and
the scratch root all come from it. No derivation can produce 4400, 5433 or
5273, and that is enforced by a test rather than by intention.

The renderer is the one thing `up` does not start, because its port is a flag
only:

```sh
cd <checkout>/desktop && pnpm exec vite --port <renderer port> --strictPort
```

`pnpm dev -- --port N` does **not** work: pnpm swallows the argument and Vite
binds its hardcoded 5273, which is a port another session may own.
`strictPort` failing rather than sliding is the behaviour this run wants.

## Doctor

```sh
./control-firetower doctor
./control-firetower doctor --server 127.0.0.1:4400    # ask about an address you are worried about
```

The question `doctor` answers is not "is something listening" but "is the
thing listening mine". **Ownership is a positive assertion**: `up` records the
`serverId` that `GET /api/v1/bootstrap` returns, and every later command
re-reads it and compares. The rule is Firetower's own, written at
`desktop/src/servers.ts:15-44`: *not knowing that it is forbidden is not
permission.* Applied here, not knowing that an instance is somebody else's is
not ownership.

So all of these are refusals, exit 2, with the cause in `--json`:

| what happened | `cause` |
|---|---|
| something answers and there is no run lock | `no-lock` |
| the run lock will not parse | `unreadable-lock` |
| the answering `serverId` differs from the recorded one | `serverid-mismatch` |
| the instance will not say which Firetower it is | `serverid-unreadable` |
| the recorded server stopped answering | `probe-failed` |

**Never adopt an instance that is already answering, and never fall back to
the next free port.** Sliding to another port relocates a run away from the
port its own evidence names, so the screenshot is of one Firetower and the
lock describes another. `web/playwright.config.ts:13` is
`reuseExistingServer: !process.env.CI` — the failure this exists to prevent is
already in the repository, one line long.

## Drive

```sh
./control-firetower drive states                         # the vocabulary, with origins
./control-firetower drive open tasks --as tasks --feature tasks
./control-firetower drive act add-a-machine --as probing
```

`playwright-core` against Chrome, against the desktop's own Vite renderer,
against this run's `ft-server`. Signing in by typing the address into the
first screen is the production first-run journey, not a test hook. Each call
captures a screenshot, an accessibility snapshot — a screenshot verifies
layout and never a value — the page's console output, and the command that
produced the state.

**The selectors are copies, not imports.** `lib/vocabulary.mjs` holds them,
each with the file and line it came from in `desktop/scripts/states.mjs` and
`desktop/e2e/cursor-live.mjs`. That is the price of a bundle that can be
lifted into another repository: the copies drift, and the attribution is what
makes a drift traceable. One was already stale when this was written — the
address step's button is `Continue`, and `cursor-live.mjs:30` still clicks
`Connect`. When a handle stops matching, `drive` says so as a finding and
names the origin to diff; it does not crash.

`--target shell` is refused. The shell transport is a WebdriverIO run with a
per-OS driver provider, invoked by CI on three platforms, and on macOS it
needs a binary built with a non-default Cargo feature — a different binary
from the one the release matrix ships. This CLI reads that evidence and says
what it does not cover. It does not pretend to launch it.

## Evidence

**Capture, post, verify the comment, only then clean up.** This ordering is a
correctness property, not tidiness.

```sh
./control-firetower evidence post --pr 334 --dry-run   # read the comment first
./control-firetower evidence post --pr 334
./control-firetower evidence verify --pr 334           # until this passes, nothing may be removed
```

Proof lives in a GitHub pull request comment, with the images attached by
`gh --attach` so they render inline. A path, a link or a base64 data URI do
not render and the reader never sees the picture. Durability comes from
having posted, not from keeping a directory: the whole workspace — checkout,
`.firetower/`, anything a run wrote under either — is deleted when the session
ends, and the stack is swept before the worktree, so a run interrupted after
capture has also lost the control plane it would have re-read a side effect
from.

So **post early and post often**: the window between capture and post is the
whole exposure, and nothing recovers a run killed inside it. Unposted
evidence is the failure state, not a to-do. With no pull request yet,
`evidence hold` says where the evidence is and what has to happen to it.

One proof is: the user action as the command that performed it; the resulting
state captured after it; the accessibility snapshot beside the screenshot;
the side effect read back from a second user-facing view where the feature has
one; and the feature id and entry point, so the proof is traceable to the
entry that demanded it and a different path can never be reported as that
entry.

## Cleanup

```sh
./control-firetower down --dry-run
./control-firetower down --all          # only after `evidence verify` passed
```

`down` stops this run's recorded pids, brings down its own Compose project by
name, and removes its own volume. It refuses while any capture is unposted.
It never passes `--remove-orphans` — from another compose file, every
container in a shared project is an orphan — never kills by name, and never
calls `just reset`.

## Helpers

```sh
./control-firetower api GET /hosts                  # read the control plane as this run's admin
./control-firetower api GET /setup                  # which of the six steps is outstanding
./control-firetower reset                           # back to a signed-in administrator, about 3s
./control-firetower limits --touched desktop/src/bridge.ts
node --test test/*.test.mjs                         # the bundle's own tests, no stack needed
```

`api` is one command rather than twenty: it checks ownership, attaches the
token, signs in again when a reset invalidated it, and translates the 403 that
means "step 4 has not been done".

`reset` drops and recreates the database. It does **not** truncate: a generic
`TRUNCATE ... CASCADE` is faster and silently reaches `skill_files`,
`skill_defaults`, `skill_pins`, `roles` and `role_defaults`, leaving
`GET /api/v1/skills` answering `[]` in a way a restart does not repair — so a
run would verify an empty Skills library and report it as the product's
behaviour.

## What this cannot prove

Run `./control-firetower limits` for the table, and
`limits --touched <path>` before claiming anything. It exits 3 when the files
a change touched are outside what the transport exercises. This list is the
thing that stops a QA pass reporting "verified" for code it never ran.

**A Chrome run proves the React app and almost nothing below it.** Eleven of
the twelve members of `desktop/src/bridge.ts` are no-ops in a browser:
`native`, `setTitle`, `setBadge`, `notify`, `minimize`, `zoom`, `close`,
`shoot`, `canShoot`, `loadArtifact` and `secrets`. The twelfth is worse than
absent — `save` takes the browser branch, `fetch` plus a blob plus an
`a download`, which the file itself is at pains to say is *not the same
gesture dressed differently*. `loadArtifact` is the same trap from the other
side: it returns null, and the mixed-content refusal the native path exists to
dodge never happens on Vite. **A passing Chrome run on either of those looks
like evidence.**

**And `bridge.ts` is not the whole native surface**, despite its header
claiming to be. Four modules reach Tauri directly past it — `open.ts` (system
browser and external links), `drag.ts` (titlebar drag and double-click
maximise), `update.ts` (the updater), `telemetry.ts` (the app version) — plus
`ui/Resize.tsx`, the Windows-only tray, and the HTML5 file-drop path that
exists *because* Tauri's own drag-drop handler is off. A cannot-prove list
scoped to `bridge.ts` alone would silently omit the updater, the opener, the
titlebar drag and the tray.

**A real binary in CI adds** `native`, window state and its persistence across
a restart, `canShoot`'s three per-OS values, real `shoot` bytes,
`loadArtifact`'s secure-origin path, the CSP actually being applied, platform
detection on three real webviews, the two different titlebar mechanisms
(macOS runs a native overlay with real traffic lights; Windows and Linux run
fully custom chrome), and the keychain round trip — which on Windows would be
the first *measurement* of a path the repository says has never been measured.

**Nothing automated proves** the native save sheet, which is an OS modal
outside the webview; a real file drop from Finder, Explorer or Nautilus — that
one needs a human; that a system browser or settings pane actually opened;
the dock badge, taskbar overlay or tray; an OS notification arriving; the
updater end to end; installing from a `.dmg`, `.msi` or `.AppImage`; or the
keychain's refusal cases. Titlebar drag and the resize strips are **unknown
and probably not drivable** — `startDragging()` hands the pointer to the
window server and the webview usually never sees the `mouseup`.

**True of the whole approach:** this transport can never be pointed at a
production-shaped server, because `ft-server` reaches `AllowOrigin::any()`
only under `--dev`. Chrome is one webview sample taken at the wrong end —
nearest to Windows, furthest from macOS and Linux, which is where most
development happens. Firetower is single-tenant per database, so nothing here
exercises tenant separation. A machine reading `state: "Online"` does not mean
a session can run there; read `GET /hosts/{id}/readiness` and assert every
required check is `available`. And a worker built on macOS is darwin-only, so
an install onto a Linux machine silently downloads a release instead — a run
that does not assert which worker was installed may verify the released worker
while believing it verified the branch.

When a change touches any of that, do not write "verified". Write what you
drove, and what remains unexercised.

## Maintaining this

The feature map and these selectors do not change in the same pull request as
the UI they describe — that is the deliberate cost of keeping the bundle
separate from the repository it verifies. Maintenance is therefore the only
thing keeping it honest, and the procedure when a handle stops matching is:
update the copy **and** its origin comment together. A copy whose origin is
stale is worse than no copy.
