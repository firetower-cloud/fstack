# The feature map

One file per feature, each one a recipe for driving that feature against a
real Firetower and coming back with evidence a sceptical reviewer accepts.
They are written to be read one at a time: find the feature, do what it says,
post what it gave you.

Every file has the same four sections, in the same order — `Sub-features`,
`How to get to it (user POV)`, `Driving it with control-firetower`,
`Gotchas` — and the `Driving it` section always opens with `Preconditions:`.

### `How to get to it` names paths. It does not claim to have driven them

**`drive open` navigates by route, every time.** It goes to
`#/configuration/machines`; it does not press `Machines` in the rail. So
where a file names a rail button or a configuration-index pane as the way in,
that is **where a person would look, not a handle this bundle has verified**.
The snapshots prove the rail is on screen and carry its buttons' names; that
pressing one navigates is not proved by anything here.

Naming a path and leaving the reader to assume it was driven is an incomplete
proof, so each file says which of its ways in is the driven one.
`this-firetower.md` is the model: *"the menu path to it — under the avatar,
then Settings — is not driven here, so take it as where to look rather than
as a verified handle."*

## The one rule

**A handle is only in this map once it has been driven against the running
application.** Not read out of a harness, not grepped out of the source,
not inferred from a component's props. Driven.

The reason is a measurement. The first version of this vocabulary was
assembled by reading the repository — two harnesses for the gestures and the
sign-in sequence, the components themselves for the screens. 28 handles, every
one sourced from a file. Then they were driven, and **6 of the 28 were
wrong**: a button read as `Connect` that the app renders as `Continue`, two
gestures describing a dialog this build does not have, two routes that are not
the screen their name suggests, and a screen whose heading is not its route's
word. Not stale by a release — wrong about the application that was running
when they were read out of it.

So a selector that was read is a candidate, and a selector that was driven is
a fact. `lib/vocabulary.mjs` holds that measurement entry by entry, and the
six wrong ones each carry what driving found instead.

Two commands keep it true, and they check different things:

- `control-firetower drive audit` drives every handle this bundle ships and
  names the ones that no longer match. Run it after any UI change, and run it
  before believing this map.
- `node --test test/citations.test.mjs` re-reads every `file:line` this bundle
  cites in the checkout and fails when the cited line no longer says what is
  claimed. The handles were audited from the first day and the citations were
  not, and a false citation is how this map's own justification came to be
  wrong in print.

Anything that could not be driven is either absent from these files or marked
unverified with the reason it could not be. **An unverified selector is worse
than a missing one, because its failure looks like an application bug.**

## Baseline preconditions

Every recipe in this directory starts from here and says only what it adds.

1. **A firetower checkout**, and `control-firetower` run from inside it or
   pointed at it with `--checkout <path>`.
2. **`npm install`** once, in the skill directory, and Google Chrome on the
   machine.
3. **`pnpm install` in `<checkout>/desktop`**, once per checkout. The
   renderer at step 5 is the checkout's own Vite, and a fresh checkout has no
   `desktop/node_modules` — `pnpm exec vite` fails outright without this, and
   it is a separate dependency tree from the one at step 2. This is the step
   that was missing from this list.
4. **This run's own stack**, from `control-firetower up` — Postgres, an
   `ft-server --dev`, an administrator whose forced password change has been
   cleared, and a named organisation. Ports, Compose project, `FIRETOWER_HOME`
   and scratch root are all derived from `$FIRETOWER_SESSION`, and none of
   them can come out as `4400`, `5433` or `5273`.
5. **The renderer**, which `up` does not start because its port is a flag
   only:
   `cd <checkout>/desktop && pnpm exec vite --port <renderer port> --strictPort`.
   `pnpm dev -- --port N` does not work — pnpm swallows the flag and Vite
   binds its hardcoded 5273.
6. **`control-firetower doctor` green.** `up` does not grade itself, and a
   server that answers is not the same as a control plane that can be used.
   On a `--first-run` instance "green" means something different and `doctor`
   says which: the `instance` line reads *claimed by this run* rather than
   naming a `serverId`, because there is no `serverId` until the organisation
   is named. That is the correct reading of a first-run instance, not a
   failure — and `doctor` exits 0 on it.

Two of the ten features need an instance that is **not** at step 4:

- `first-run-connect.md` runs against either.
- `forced-password-change.md` and `setup-wizard.md` need
  `control-firetower up --first-run` (or `reset --first-run`), which does the
  first three steps and stops, leaving both gates standing. `up`'s steps 4
  and 6 exist to clear exactly those gates, so an instance that has had them
  cannot show the screens those two files are about.

And one needs Tier B — a machine. `add-a-machine.md` carries the recipe; the
container it stands up is also what `add-a-repository.md` borrows to probe a
remote.

### What the recipes assume about data

A fresh `up` is an empty install: no machine, no repository, no git host, no
tracker, and the skills the server ships with. **Several entries describe that
emptiness** — the composer's `Add a machine first`, the repositories screen's
`Connect a provider`, the tasks screen's `No tracker connected`. They stop
being true the moment something fills the install, which is why the sweep
order below is what it is, and why `drive audit` reports those entries as not
re-checkable rather than failed when it finds a populated instance.

### Evidence, and the one ordering rule

**Capture, post, verify the comment, then clean up.** Proof lives in a pull
request comment, with images attached by `gh --attach` so they render inline
(firetower#337). Durability comes from having posted, not from keeping a
directory: the whole workspace is deleted when the session ends.

Two consequences worth knowing before a sweep:

- `control-firetower down` refuses while any capture is unposted.
- `control-firetower reset` does **not**: it starts the run's record over, so
  captures taken before a reset are no longer in the run lock to post. Post
  between features, not at the end of the sweep.

## The sweep order

A full regression pass walks the features in this order. It is not
alphabetical and it is not arbitrary — each step leaves the install in the
state the next one needs, and running it backwards means seeding by hand or
reporting entries as unreachable that are merely out of order.

| | Feature | Instance it needs | What it leaves behind |
|---|---|---|---|
| 1 | [First-run connect](first-run-connect.md) | either | nothing; a fresh browser context each time |
| 2 | [The forced password change](forced-password-change.md) | `up --first-run` | the password gate cleared, the wizard still standing |
| 3 | [The setup wizard](setup-wizard.md) | the same instance, mid-journey | a named organisation, a serverId, a prepared instance |
| 4 | [Sign in](sign-in.md) | prepared | a signed-in administrator |
| 5 | [Tasks](tasks.md) | prepared, no tracker | nothing |
| 6 | [The Skills library](skills-library.md) | prepared | nothing |
| 7 | [Agent profiles](agent-profiles.md) | prepared, no profile yet | a draft, unsaved |
| 8 | [This Firetower](this-firetower.md) | prepared | nothing; the disconnect question is opened and never confirmed |
| 9 | [Compute → Add a machine](add-a-machine.md) | prepared, empty fleet, a container | a machine, and a fleet that is no longer empty |
| 10 | [Configuration → Repositories](add-a-repository.md) | prepared, a machine, one repository seeded | two repositories |

Three ordering facts behind that table, each measured rather than assumed:

- **2 and 3 are one instance.** The password gate stands in front of the
  wizard, so the wizard is only reachable once the first has been opened.
  Each is one-shot: driving it clears it. `reset --first-run` makes another,
  measured at 2.7s on 2026-11-17.
- **9 before 10.** The probe behind the repositories screen's `Add it` is
  answered by a *machine*, not by the control plane, so pasting a remote
  before there is a machine cannot succeed.
- **5 to 8 before 9.** Their recipes describe an empty install. Adding a
  machine ends that for the home screen's composer, and adding a repository
  ends it for the repositories screen.

A sweep that has to start in the middle can: `control-firetower reset` puts
the data back without restarting anything, and `reset --first-run` puts it
back further than that.

## Keeping it honest

- `control-firetower drive states` lists every handle with the file and line
  it came from.
- `control-firetower drive audit` drives them. From a `--first-run` instance
  it covers the first-run screens *and* the app's own, because the journeys
  open the gates on the way through.
- When one fails, update the handle **and** its origin comment together. A
  copy whose origin is stale is worse than no copy, because the origin is what
  the next reader checks instead of the application.
- `node --test test/citations.test.mjs` re-reads every `file:line` this bundle
  cites. It needs a checkout and says so rather than passing without one.
- `control-firetower limits --touched <path>` before writing the word
  verified. A Chrome run proves the React app and almost nothing below it.
