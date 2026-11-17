/**
 * The help, which is the part of this CLI most likely to be read.
 *
 * Written for an agent that has never seen Firetower, is mid-task, and will
 * read this once. So the top-level page says what Firetower is, what is
 * dangerous about the machine it is probably running on, and the shortest
 * path to a working stack — and then gets out of the way. The detail is one
 * `--help` deeper, per command, which is the gradual disclosure the method
 * asks for.
 */

export const TOP = `control-firetower — drive a real, isolated Firetower and prove what you saw

  Firetower runs coding agents on your own machines: an ft-server on Postgres,
  a desktop app that connects to it, and workers on hosts. This command brings
  up a Firetower that belongs to this run alone, drives its desktop app in
  Chrome, and posts the evidence to a pull request.

  Read this before the first command. You are almost certainly on a shared
  machine, and the developer's own Firetower is usually listening on
  127.0.0.1:4400 — the control plane that is hosting this very session.
  Driving that would not be a port clash. It would be driving your host.

  So there are no default addresses here. Every port is derived from this
  run's isolation key, every connection re-checks that the Firetower
  answering is the one this run started, and anything unexpected is refused
  rather than adapted to.

USAGE
  control-firetower <command> [options]

COMMANDS
  up         Bring this run's own stack to a signed-in administrator
  doctor     Say whether this run owns what it is about to drive
  api        Call the control plane as this run's administrator
  drive      Drive the desktop app in Chrome and capture what happened
  evidence   Capture, post to a pull request, verify — in that order
  reset      Put the data back to a signed-in administrator, in about 3s
  down       Stop only what this run started
  limits     What the transport you used cannot prove

  control-firetower <command> --help   for that command's own page.

A RUN, START TO FINISH
  control-firetower up                      # six steps, about 10s warm
  control-firetower doctor                  # read this before believing anything
  control-firetower api GET /hosts
  control-firetower drive open tasks --as proof
  control-firetower evidence post --pr 334  # proof is durable once posted
  control-firetower limits --touched desktop/src/ui/Tasks.tsx
  control-firetower down                    # refuses while evidence is unposted

GLOBAL OPTIONS
  --key <id>          This run's isolation key. Default $FIRETOWER_SESSION,
                      else a hash of this checkout. The control-plane port,
                      the Postgres port, the renderer port, the Compose
                      project, FIRETOWER_HOME and the scratch root all come
                      from it, so one key is one run.
  --checkout <path>   The Firetower checkout to build and run. Default: the
                      nearest one at or above the working directory.
  --json              Machine-readable output. Every command, including every
                      refusal, which carries its reasons as data.
  --dry-run           Print what would happen, change nothing. Accepted by
                      every command that has a side effect.
  --control-port, --postgres-port, --renderer-port
                      Override one derived port. doctor prints where each port
                      came from, so an override is never invisible.
  -q, --quiet   -v, --verbose   --no-color   -h, --help   -V, --version

WHERE THINGS GO
  scratch   \${TMPDIR}/firetower-verify/<key>/   survives this session ending
  run lock  .../run.json                        ports, pids, serverId, evidence
  home      .../home/                           FIRETOWER_HOME: root key, ssh
  never     the checkout. The whole workspace is deleted when the session
            ends (crates/ft-worker/src/lib.rs:941), and that includes the
            repository's own .firetower/ directory.

EXIT CODES
  Worth branching on: that is what the machine-readable half is for.

  0  did it
  1  usage
  2  REFUSED: this is not this run's instance. Never retry, never adapt.
     One class with several causes, which share this code on purpose because
     every one of them reads as "not mine". Which one it was is in --json as
     error.cause: no-lock, unreadable-lock, serverid-mismatch,
     serverid-unreadable, nothing-recorded, probe-failed
  3  the transport cannot support the claim you are making
  4  a precondition is missing; nothing is up, or nothing is recorded
  5  doing that would destroy evidence that has not been posted
  6  what was driven failed. The CLI worked; read the output

TWO RULES THIS COMMAND WILL NOT LET YOU BREAK
  Ownership is a positive assertion. A probe that errors, a lock that will
  not parse, a serverId that cannot be read: each one reads as *not mine*.
  Not knowing that an instance is somebody else's is not ownership. The rule
  is Firetower's own, at desktop/src/servers.ts:15-44, and 'refuse' is the
  only thing this CLI does with it. There is no fallback to the next free
  port: that silently relocates a run away from the port its evidence names.

  Capture, post, verify the comment, then clean up. Proof lives in a pull
  request comment (gh --attach), and durability comes from having posted it,
  not from a directory. A cleanup that runs before a verified post has
  destroyed the proof, so 'down' refuses to be that cleanup.

NEVER, ON THIS MACHINE
  just reset        is 'docker compose down -v' plus 'rm -rf ~/.firetower/
                    worker' — 54GB and every live session's worktree on this
                    host, including your own working directory. No subcommand
                    here calls it, 'doctor' refuses it by name, and 'reset'
                    means this run's database only.
  pkill -f firetower | vite | next
                    kills the :4400 control plane hosting this session and
                    every other session's processes. 'down' acts only on pids
                    this run recorded and on its own Compose project.

WHAT THIS CANNOT PROVE
  A Chrome run proves the React app and almost nothing below it: 11 of the 12
  members of desktop/src/bridge.ts are no-ops in a browser, and two of them —
  save and loadArtifact — are *different gestures* rather than absent ones, so
  a passing Chrome run looks like evidence. Run 'control-firetower limits'
  before writing the word "verified" anywhere.
`;

export const COMMANDS = {
  up: `control-firetower up — bring this run's own stack to a signed-in administrator

  Six steps, because a server that answers is not a usable control plane.
  Measured under firetower#330; the two steps everybody forgets are 4 and 6.

    1  build          cargo build -p ft-cli in the checkout (skipped if built)
    2  postgres       docker compose -p ft-verify-<key> up -d, on a derived port
    3  serve          ft-server --dev on a derived port, with DATABASE_URL and
                      FIRETOWER_HOME set explicitly. --dev is not optional: it
                      is the only branch that reaches AllowOrigin::any()
                      (crates/ft-server/src/lib.rs:631), and without it every
                      call from the driven page is refused by CORS
    4  passwd         the first administrator carries must_change_password, and
                      every authenticated route answers 403 until it is
                      cleared. 'firetower passwd admin' clears it in the same
                      statement, unattended, in 0.4s
    5  login          POST /api/v1/auth/login, and the token into the run lock
    6  setup          POST /setup/organization and /setup/complete, or the
                      desktop shows the setup wizard instead of the app
                      (desktop/src/ui/Gate.tsx:47)

  Then /bootstrap finally has a serverId, and 'up' records it. That recorded
  id is what every later command checks before it touches anything.

  Before step 2 it asserts that both derived ports are silent. If either
  answers, 'up' refuses and does not look for a free one.

USAGE
  control-firetower up [--rebuild] [--dry-run] [--json]

OPTIONS
  --rebuild      cargo build even if target/debug/firetower exists
  --dry-run      print the six steps, with the real ports and paths, and do
                 nothing. Safe to run first, and worth it on a machine you
                 have not run this on before
  --json         the run lock as JSON on success

AFTER
  control-firetower doctor          read it; 'up' does not grade itself
  control-firetower api GET /hosts  an empty fleet. Nothing runs until a
                                    machine is added (CONTRIBUTING.md)
`,

  doctor: `control-firetower doctor — say whether this run owns what it is about to drive

  The question is not "is something listening". It is "is the thing listening
  mine". Those have different answers on this machine, and the second is the
  one that matters: the developer's own Firetower on 127.0.0.1:4400 is the
  control plane hosting this session.

  Every line is a fact read at the moment you asked, not a cached one. An
  unknown is never reported as a pass.

USAGE
  control-firetower doctor [--server <host:port>] [--json]

OPTIONS
  --server <host:port>
       Ask about an address this run did not derive. This is the explicit
       opt-in, and it is still never an adoption: if that address answers
       with a serverId this run did not record, doctor says so and exits 2.
       Use it to check what a port you are worried about actually is.
  --json
       Every check as data: { check, state, detail }, with the verdict and
       the refusal reasons alongside.

WHAT IT CHECKS
  key           the isolation key and where it came from
  ports         derived or overridden, and what is listening on each
  instance      /bootstrap's serverId against the one this run recorded
  lock          the run lock, its pids, and whether they are alive
  database      the Compose project and whether Postgres accepts a connection
  admin         whether must_change_password is still blocking every route
  setup         whether the wizard would still be in the way
  evidence      captures taken, and whether they have been posted yet
  hazards       'just reset' and kill-by-name, refused by name

EXIT
  0  this run owns the instance at the address asked about
  2  it does not. The reasons are printed, and retrying will not help
  4  nothing is up yet; run 'control-firetower up'
`,

  api: `control-firetower api — call the control plane as this run's administrator

  One command instead of twenty read-only ones. It asserts ownership before
  every call, attaches this run's token, signs in again if the token has been
  invalidated, and translates the two failures that are really instructions:

    403 PasswordChangeRequired  ->  step 4 of 'up' has not been done
    401                         ->  the token is stale; it signs in again once

  Paths are relative to /api/v1, so 'GET /hosts' is the whole call.

USAGE
  control-firetower api <METHOD> <path> [--body <json>] [--dry-run] [--json]

OPTIONS
  --body <json>   request body, as a JSON string, for POST/PATCH/PUT
  --raw           do not unwrap or pretty-print; print exactly what came back
  --dry-run       required reading before any method that is not GET or HEAD:
                  prints the request, sends nothing
  --json          { status, body } as data, with the ownership check included

EXAMPLES
  control-firetower api GET /bootstrap          # who is answering
  control-firetower api GET /setup              # is the wizard still up
  control-firetower api GET /skills             # the library. [] means broken,
                                                # not empty, if you truncated
  control-firetower api GET /hosts
  control-firetower api POST /organization --body '{"name":"Verify"}' --dry-run

  A side effect read back from the API is half of a proof. The other half is
  the same effect read back from a second user-facing view — see 'drive'.
`,

  drive: `control-firetower drive — drive the desktop app in Chrome and capture what happened

  The frontend transport: playwright-core against the desktop's own Vite
  renderer, pointed at this run's ft-server. This is the production user path
  rather than a test hook — the app's first screen is "type a control plane
  address and Connect" — and desktop/src/bridge.ts exists precisely so the
  app renders in an ordinary tab.

  Each call opens the app, signs in with this run's administrator, gets past
  the forced password change and the setup wizard, goes where you asked, and
  captures the resulting state: a screenshot, an accessibility snapshot, the
  page's console errors, and the command that produced them. A screenshot
  verifies layout and never a value, which is why the snapshot is not
  optional.

USAGE
  control-firetower drive <subcommand> [options]

SUBCOMMANDS
  states              list the states this build can be driven into, and the
                      selector each one uses
  open <state>        go to a state and capture it
  act <gesture>       perform a named gesture, then capture
  signin              just the sign-in sequence, for checking the renderer

OPTIONS
  --as <name>         name this capture; it becomes the evidence filename
  --feature <id>      the feature-map entry this proof is for. Recorded with
                      the capture, so a proof is traceable to the entry that
                      demanded it and a different path can never be reported
                      as that entry
  --target <t>        'frontend' (default) is the only transport this binary
                      has. '--target shell' is refused on purpose, with the
                      reason and where the shell evidence actually lives
  --headed            show the browser. Useful once, never in CI
  --full-page         full-page screenshot rather than the 1280x824 viewport
  --json              the capture manifest as data

THE SELECTOR VOCABULARY IS COPIED, NOT IMPORTED
  Every selector here is copied from desktop/scripts/states.mjs and the
  sign-in sequence from desktop/e2e/cursor-live.mjs, each with a comment
  saying which line it came from. That is the cost of a self-contained
  bundle: the copies can drift, and the comments are what make the drift
  traceable. 'drive states --json' prints each selector with its origin so a
  reviewer can diff them against the checkout.

WHAT A PASSING RUN HERE DOES NOT MEAN
  See 'control-firetower limits'. Eleven of bridge.ts's twelve members are
  no-ops in Chrome, and two are different gestures rather than absent ones.
`,

  evidence: `control-firetower evidence — capture, post to a pull request, verify, in that order

  Proof lives in a GitHub pull request comment, posted with 'gh --attach' so
  the images render inline. Durability comes from having posted it, not from
  keeping a directory: the whole workspace is deleted when this session ends.

  Which makes the ordering a correctness property rather than a preference:

    capture  ->  post  ->  verify the comment  ->  only then clean up

  A cleanup that runs before a verified post has destroyed the proof. 'down'
  knows this and refuses; this command is where the ordering is recorded.

USAGE
  control-firetower evidence <subcommand> [options]

SUBCOMMANDS
  list                  what has been captured, and what has been posted
  post --pr <number>    post every unposted capture as one comment, with the
                        images attached. Outward-facing and irreversible, so
                        --dry-run prints the comment body and the gh command
                        and sends nothing
  verify --pr <number>  read the comment back and confirm each attachment
                        resolves. Until this passes, nothing may be cleaned up
  hold                  with nowhere to post, say where the evidence is being
                        held and what has to happen to it. Never silently
                        leaves files nobody will look at

OPTIONS
  --pr <number>    the pull request. No default: posting to the wrong one is
                   not recoverable
  --repo <owner/name>
                   default: the checkout's origin remote
  --dry-run        on 'post', prints what would be posted
  --json           the manifest as data

WHAT ONE PROOF CONSISTS OF
  the user action, as the command that performed it; the resulting state
  captured after it; an accessibility snapshot beside the screenshot, because
  a screenshot never verifies a value; the side effect read back from a second
  user-facing view where the feature has one; and the feature id and entry
  point used, so the proof is traceable to the map entry that demanded it.
`,

  reset: `control-firetower reset — put this run's data back to a signed-in administrator

  Drop the database and create it again, then redo steps 3 to 6 of 'up'.
  Measured at 2.93s under firetower#330, which is cheap enough to do between
  features rather than once per run.

  It will not truncate. A generic 'TRUNCATE ... CASCADE' is 2.8s faster and
  silently reaches skill_files, skill_defaults, skill_pins, roles and
  role_defaults, which leaves GET /api/v1/skills returning [] in a way a
  restart does not repair. A run that reset that way would verify an empty
  Skills library and report it as the product's behaviour.

  It also does not touch ~/.firetower, and it is not 'just reset'. The reset
  unit is this run's database plus its own FIRETOWER_HOME — whose ssh/
  known_hosts belongs in the unit too, because a container machine rebuilt at
  the same address answers with a different host key and the next probe fails
  with HostKeyChanged.

USAGE
  control-firetower reset [--keep-home] [--dry-run] [--json]

OPTIONS
  --keep-home   leave FIRETOWER_HOME alone. The root key survives, so stored
                credentials survive with it; the control plane's own ssh
                identity rotates with the database regardless, so anything
                already in a machine's authorized_keys is stale afterwards
  --dry-run     print the statements and the steps, run none of them
`,

  down: `control-firetower down — stop only what this run started

  By recorded pid, by this run's Compose project, by this run's session
  label. Never by process name: 'pkill -f firetower' from inside a session
  kills the :4400 control plane that is hosting it, and 'pkill -f vite' or
  'next' kills every other session's renderer. The in-repo precedent for
  killing only your own children is justfile:74-87.

  It refuses while there is unposted evidence, because teardown is also when
  proof is lost: the stack a side effect would be read back from is gone
  first, and the captures are next.

USAGE
  control-firetower down [--all] [--force] [--dry-run] [--json]

OPTIONS
  --all       also remove the scratch root. Only after 'evidence verify'
  --force     tear down with evidence still unposted. Say in the pull request
              that you did this and why; nothing else records it
  --dry-run   print exactly what would be stopped and removed: the pids, the
              Compose project, the volume, the paths

WHAT IT WILL NOT DO
  'docker compose down -v --remove-orphans' on an inherited project name.
  From another compose file, every container in a shared project is an
  orphan. The project is always named explicitly.
`,

  limits: `control-firetower limits — what the transport you used cannot prove

  This exists to stop a run reporting "verified" for a change it never
  exercised. Ask it about the files a change touched and it will say whether
  the transport you have can support that claim.

  The short version: a Chrome run proves the React app and nothing below
  desktop/src/bridge.ts. Eleven of that file's twelve members are no-ops in a
  browser. The other two, save and loadArtifact, are *different gestures*
  rather than absent ones — which is worse than absent, because the run
  passes and looks like evidence. And bridge.ts is not the whole native
  surface: open.ts, drag.ts, update.ts and telemetry.ts reach Tauri directly
  past it, plus ui/Resize.tsx, the Windows tray and the HTML5 drop path.

USAGE
  control-firetower limits [--target frontend|shell|any] [--touched <path>]... [--json]

OPTIONS
  --target <t>     which transport to report on. 'frontend' is this binary.
                   'shell' is the WebdriverIO run in CI, which this binary
                   reads evidence from and cannot launch. 'any' is the list
                   nothing automated proves
  --touched <path> repeatable. A changed path to check against the native
                   surface. Exit 3 if a Chrome run cannot support a claim
                   about it, with the reason and what would
  --json           the table as data, one row per capability

EXIT
  0  nothing you named is outside what this transport proves
  3  something you named is. Do not write "verified"; write what you drove
`,
};

export const USAGE_LINES = `control-firetower <command> [options]

  up  doctor  api  drive  evidence  reset  down  limits

  control-firetower --help              the whole thing, written to be read cold
  control-firetower <command> --help    one command
`;
