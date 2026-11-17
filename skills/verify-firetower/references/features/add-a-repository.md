# Configuration → Repositories: add a repository

Repositories are what Firetower cuts worktrees from — every workspace is a
branch of one of them, in a copy of its own. The screen is one heading and
two lists: what is imported, and what the chosen host can see that is not.
A control above them chooses which host to look at, and its last row is
**Paste a remote** — the way in for a remote no host can list, "anything git
can clone, a URL or a path on the machine that will do the cloning". Typing
one and pausing probes it: the screen says what the repository is called and
what its default branch is, and the button changes from `Save it anyway` to
`Add it`. The row that appears afterwards carries the slug and that branch.

## Sub-features

- **The host filter**, governing both lists, defaulting to `All hosts`.
- **Paste a remote**, and the probe behind it.
- **The probe's answer** — slug, default branch, and whether the remote is
  reachable only from the server.
- **Saving it anyway** when the probe fails, because the row *is* a URL and
  its name is read the first time a workspace clones it.
- **The empty screen**, which offers `Connect a provider` instead of any of
  this. That is the first repository, and it is a different journey — see
  `Gotchas`.
- **A repository's settings** — setup command, env file, variables, remove.
  Not driven.

## How to get to it (user POV)

`Repositories` in the destinations rail — the rail is drawn as a navigation
landmark called `Destinations` and this is one of its buttons. It lands on
`/configuration/repositories`, which is also where bare `/configuration`
falls through to. (The rail's keyboard shortcuts are in the source and are
not driven here.)

**Driven by route** (`#/configuration/repositories`), not by pressing the rail: the rail's presence is in the snapshot, that pressing it navigates is not proved here.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`, plus three things this
feature cannot supply itself:

- **A machine.** The probe behind `Add it` is answered by a machine, not by
  the control plane (`crates/ft-server/src/api/repos.rs:634-647`), so a
  remote cannot be checked before `add-a-machine.md` has run. Measured
  2026-11-17: with an empty fleet the probe refuses. `drive` now checks this
  before driving and names it — it used to run anyway and report the missing
  `Add it` as a drifted selector.
- **At least one repository already imported.** The control holding
  `Paste a remote` is not drawn while the screen is bare, and bare means no
  repository *and* no connected host. Seed one over the API — the precondition
  is seeded, the journey is driven.
- **A bare git repository on the machine, at the path `--remote` names.**
  `git init --bare /home/editor/web.git` inside the container from
  `add-a-machine.md` is enough. The probe asks the *machine* to reach that
  path, so a remote nothing can clone fails the probe — and the button then
  reads `Save it anyway` rather than `Add it`. This was only hinted at in a
  Gotcha before, and it has to be created by hand.

| User action | Command | Observable result |
|---|---|---|
| (precondition) have something on the screen | `control-firetower api POST /repos --body '{"slug":"seeded","remote":"/home/editor/seed"}'` | the row exists; the screen is no longer bare |
| Open the host filter and choose `Paste a remote` | `control-firetower drive act paste-a-remote --remote /home/editor/web.git --feature add-a-repository` | the control's label becomes `Paste a remote` and a field appears, placeholder `git@github.com:acme/web.git` |
| Type a remote and pause | the same command types it and presses Enter | the probe answers and the button reads **`Add it`**. The journey asserts that before pressing, because with nothing found the same button says `Save it anyway` — so this assertion is what makes the capture proof that the remote was reached |
| Press `Add it` | the same command | a new row under `Checked out`, reading the slug and its default branch — `web main` |
| Read the side effect back | `control-firetower api GET /repos` | the new row, with the remote that was typed |

Proof: the `paste-a-remote` capture, its accessibility snapshot showing the
row, and the `/repos` readback.

## Gotchas

- **The first repository cannot be added on this screen.** With nothing
  imported and no host connected, the screen draws its empty state, whose
  only action is `Connect a provider` — and the control that holds
  `Paste a remote` is inside the branch that empty state replaces. So
  pasting is how you add the *next* repository, never the first. Connecting a
  provider needs an OAuth application and a real account on that provider,
  which an isolated run cannot supply: **that journey's precondition cannot
  be met here, and it is reported as a failure rather than worked around.**
  What is driven instead is the step before it: `drive act connect-a-git-host`
  presses `Connect a provider` from the empty screen and lands on `Git hosts`.
- **The default branch on the screen and the one in the API are not the same
  field.** The row shows `main`; `GET /repos` answers `defaultBranch: null`
  for the same repository, because the stored row's branch is read the first
  time a workspace clones it. Read the branch off the screen, or off the
  probe — not off the row. Measured 2026-11-17 against 0.55.0.
- **The remote has to be reachable from the machine, not from here.** A path
  under `/tmp` on the developer's Mac is not a repository as far as an Alpine
  container is concerned, and the refusal says `isn't a git repository`,
  which sends you to look at the wrong thing. Put the bare repository inside
  the machine, or use a URL the machine can fetch.
- **`Add it` is a button two screens share.** The one here saves a
  repository; the one in the Add a machine dialog opens an ssh connection.
  Both answer to the same rule in this bundle: the address is typed from a
  placeholder this run fills in, never from a literal in the vocabulary, and
  a test enforces it.
- **A populated screen is a different screen.** Once there are repositories
  the empty state is gone, so `connect-a-git-host` stops being drivable.
  `drive audit` reports it as not re-checkable, with the count it found, and
  the sweep order puts it first for that reason.
