# This Firetower

The screen that answers "what am I connected to, and as whom". It is a facts
pane rather than a list: the address this window reached the server on, the
account held on it and its role, the version running, where this person's
things live, and when the connection was made. Under it, one destructive
affordance — **Disconnect** — which forgets the connection and its token on
this Mac only. The server is not told, the sessions keep running, and the way
back is the address and a password.

## Sub-features

- **The facts**: Address, Signed in as, Running, Your things live at,
  Connected since.
- **Disconnect**, and the question it asks first, which names the Firetower
  it is about to forget.
- **The sentence under it**, saying the account exists on this server only
  and that switching Firetowers is under the avatar.
- **Confirming the disconnect.** Deliberately not driven — see `Gotchas`.

## How to get to it (user POV)

The route is `/configuration/server`, and that is what this recipe drives.
It is one of the panes no destination owns: the rail does not point at it, and
the page draws its own index with `This Firetower` under *This deployment*.
The menu path to it — under the avatar, then Settings — is not driven here, so
take it as where to look rather than as a verified handle.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`. Nothing else: this screen
reads what is already true of the connection.

| User action | Command | Observable result |
|---|---|---|
| Go to This Firetower | `control-firetower drive open server --feature this-firetower` | the level-1 heading `This Firetower` and the facts: `Address http://127.0.0.1:<port>`, `Signed in as admin — admin`, `Running 0.55.0`, `Your things live at u/admin`, `Connected since <a date>` |
| Check the facts against the server | `control-firetower api GET /auth/me` and `control-firetower api GET /bootstrap` | the same username, role, organisation and version the pane is showing, from two routes the pane does not own |
| Ask to disconnect | `control-firetower drive act ask-to-disconnect --feature this-firetower` | the confirm dialog, with the level-2 heading `Disconnect <organisation> from this Mac?` — the one place the app says *which* Firetower it is about to forget |

Proof: the facts pane, the confirm dialog, and the two readbacks — a
screenshot verifies layout and never a value, and every one of these facts is
a value.

## Gotchas

- **The heading is `This Firetower`, not `Server`**, though the route is
  `/configuration/server`. A handle taken from the route's word does not
  match anything.
- **The question is never answered.** `ask-to-disconnect` opens the confirm
  and stops. Pressing `Disconnect` drops this run's own token in the browser,
  which ends the sweep that is running — so the gesture asserts the dialog
  and leaves it open. The dialog is thrown away with the browser context, and
  nothing on the server changes either way.
- **The organisation's name is in the dialog's heading**, so the handle is
  filled in from this run rather than written down. A run whose organisation
  has a different name still matches; a vocabulary with a literal name there
  would not.
- **`Connected since` is a date from the browser's own record**, written when
  this context signed in — so in a driven run it is always today. It is not a
  server fact and cannot be checked against one.
- **The version shown is the server's**, not the desktop's. A Chrome run
  cannot see a desktop version at all: the app reads it through a native
  module, which answers nothing in a browser. Do not read this line as
  evidence about a release.
- **Disconnecting is not deleting.** If a sweep ever does confirm it, nothing
  on the server has changed and the next run signs in again as normal — but
  the capture after it is of the address screen, not of the app.
