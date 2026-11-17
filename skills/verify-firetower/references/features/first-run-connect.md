# First-run connect

The first thing the desktop app shows somebody who has never used it: one
field, one button, and the question *Where is your Firetower?* They type the
address of a control plane and press **Continue**. The app goes and asks that
address what it is — trying https, then http, keeping whichever answers — and
comes back with the Firetower's name, its version and a sign-in form. Nothing
has been stored yet and nobody is signed in; the only thing that has happened
is that an address turned into a server.

## Sub-features

- **Typing an address.** The field takes a host, with or without a port and
  with or without a scheme.
- **Finding what is there.** A card appears above the form carrying the
  organisation's name, the address as typed and the version the server
  reports.
- **Landing signed out.** The screen that follows asks who you are; it does
  not assume.
- **Getting out again.** The card's × is *Use a different address*, which is
  the way back to the first screen.
- **Nothing answered there.** A dead address lands on its own screen rather
  than on a silent failure. Not driven — see `Gotchas`.

## How to get to it (user POV)

Open the desktop app on a Mac that has never connected to a Firetower. There
is no navigation to it and no way back to it from inside the app except by
forgetting the server you are on (see `this-firetower.md`). In a browser tab
against the Vite renderer, the same screen appears whenever `localStorage`
has no server in it — which is every fresh browser context.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`. Either instance: a prepared
one or a `--first-run` one. Nothing else — this journey runs before anything
is signed in.

| User action | Command | Observable result |
|---|---|---|
| Open the app with nothing remembered | `control-firetower drive act connect-an-address --feature first-run-connect` | the journey asserts the level-1 heading `Where is your Firetower?` is on screen before it types anything, and photographs it |
| Type the control plane's address and press Continue | the same command — it fills the placeholder `ft-e1.tail9c2b.ts.net` with this run's address and clicks the button named `Continue` | the level-1 heading `Who are you here?`, with the found server's card above it: the organisation's name, `127.0.0.1:<port>` and the version |
| Read back what the app found | `control-firetower api GET /bootstrap` | the same `organization` and `version` the card is showing, from the route the app itself asked |

Proof for the pull request comment: the capture named `connect-an-address`,
its accessibility snapshot — which carries the card's text, and a screenshot
never carries a value — and the `/bootstrap` readback beside it.

## Gotchas

- **Every capture carries one console 404, for `/favicon.ico`.** The Vite
  renderer does not serve one. It is not a finding and it is not this run's
  doing; `drive` classifies it as known noise and says how many it set aside,
  so anything it *does* print is the application talking.
- **The button is `Continue`, not `Connect`** —
  `desktop/src/ui/Connect.tsx:224`. This handle was read as `Connect` and
  driving it is what settled the question; it is one of the six in `INHERITED`
  that reading got wrong. The word `Connect` is alive elsewhere in the app —
  connecting a git host, connecting a tracker, connecting an account, and
  `desktop/scripts/states.mjs:500` presses the git-hosts one correctly — so a
  global substitution is its own bug. Match this one on the address screen
  only.
- **Before the setup wizard has run, there is no organisation to show.** The
  card reads **`A Firetower`** with a monogram taken from the address, because
  `/bootstrap` answers `organization: null` until the organisation is named.
  A run that asserts an organisation name here passes on a prepared instance
  and fails on a first-run one, which is the wrong way round for a first-run
  journey. Measured 2026-11-17 against 0.55.0.
- **This screen only exists in a fresh browser context.** A successful
  sign-in writes the server into `localStorage`, and from then on the
  renderer's root draws the app. `drive` opens a context per journey for that
  reason; `drive audit` used to reuse one page and reported this heading as
  missing when it was perfectly fine.
- **The app asks the address, so CORS has to allow it.** The verification
  server runs `--dev`, which is the only branch that allows any origin.
  Pointed at a production-shaped server, every call this screen makes is
  refused — which is a limit of the whole transport, not of this feature.
- **`Nothing answered there` is not driven.** Reaching it means typing an
  address that fails to answer, and this bundle refuses to point a run at an
  address it cannot positively establish is its own. The handles for that
  screen are therefore not in the vocabulary at all rather than being guessed.
