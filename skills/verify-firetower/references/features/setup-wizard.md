# The setup wizard

A Firetower nobody has named is not finished being set up, and the desktop
draws the wizard instead of the app until it is — on every visit, whatever
address was asked for. It asks one question: **Name this Firetower**, "what
the people who run it call themselves", behind a `Continue`. Naming it is
what creates the identity the rest of the product hangs off: the name in the
title strip, the name on the sign-in card, and the id every client files its
token under. Then one more screen says the Firetower is set up, names the two
things that have to exist before anything can run, and opens the app.

## Sub-features

- **Being held at the wizard** until setup is finished, from any route.
- **Naming the organisation**, one field with a `Westlabs` placeholder.
- **The last screen**, headed `<name> is set up`, which says a machine and a
  repository come next, in that order, and discloses the daily usage counts.
- **`Open Firetower`**, which finishes setup and lands on the home.
- **`/account` stays reachable while held**, because signing out and
  forgetting the server are legitimate answers to being stuck. Not driven —
  see `Gotchas`.

## How to get to it (user POV)

Sign in to a Firetower whose organisation has never been named. There is no
way to reach it afterwards and no way to skip it: it is drawn in front of
every screen the app has.

## Driving it with control-firetower

**Preconditions:** an instance with its gates standing — `up --first-run` or
`reset --first-run` — and the forced password change already cleared, which
is what `forced-password-change.md` leaves behind. The two are consecutive
steps of one sweep against one instance.

| User action | Command | Observable result |
|---|---|---|
| Sign in to an unnamed Firetower | `control-firetower drive act name-this-firetower --feature setup-wizard` | the journey asserts the level-1 heading `Name this Firetower` and photographs it |
| Type a name and press `Continue` | the same command fills the placeholder `Westlabs` and clicks the button | the level-1 heading `<the name typed> is set up`, photographed on the way through |
| Press `Open Firetower` | the same command | the app's home: the level-1 heading ending `what should we work on?` |
| Read the side effect back | included in the capture as `GET /bootstrap` | a `serverId` where there was none, and `organization` under the name that was typed |
| Confirm the wizard is gone for good | `control-firetower api GET /setup` | `completed: true`, `needsOrganization: false` |

Proof: three screenshots from one journey — the wizard, the confirmation and
the app — plus the `/bootstrap` readback showing the id that did not exist
before.

## Gotchas

- **`Continue` is this screen's button and the address screen's button.** Two
  different screens, one word. Match the heading to know where you are;
  matching the button tells you nothing.
- **The organisation's id is the proof, and it does not exist until this
  journey runs.** `/bootstrap` answers `serverId: null` until the
  organisation is *named* — the server joins on a `named_at` that only this
  screen sets. That is why an unprepared instance cannot be owned by a
  recorded serverId, and why driving this journey is what turns the run from
  `claimed` into `pinned`.
- **One-shot, like the password gate.** Setup completes once and stays
  complete. `reset --first-run` is the way to get another instance; it drops
  and recreates the database rather than truncating it.
- **The wizard the web control plane shows is not this one.** This file is
  about the desktop's own `Setup` screen; the GitHub step the web offers at
  this point is deliberately absent here, and nothing in this recipe says
  anything about the web client.
- **`/account` while held is not driven.** It is reachable by design, but
  reaching it means navigating to a route while the gate is up, and the only
  thing that would prove is that the route rendered. The handles for it are
  not in the vocabulary.
- **The name goes into the sign-in card too.** Once this has run, the first
  screen's card reads the organisation's name instead of `A Firetower` — so a
  capture of `first-run-connect.md` taken after this one looks different from
  one taken before, and both are correct.
