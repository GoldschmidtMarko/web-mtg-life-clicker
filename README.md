# MTG Life Clicker

The ultimate Magic: The Gathering life counter app. Create lobbies, track life totals with friends, and play multiplayer MTG games online — commander damage, dice rolling, timers, and more.

**Hosted at:** [https://mtglifeclicker.com/](https://mtglifeclicker.com/)

## Repo info

Static frontend + Firebase backend, deployed via Firebase Hosting/Functions/Firestore.

```
public/                 Static site (Firebase Hosting root)
  index.html             Landing / lobby creation page
  lobby.html             In-game life counter / lobby view
  js/                     Client-side scripts (lobby, dice animation, commander modal, settings, etc.)
  styles/                 Per-page stylesheets
styles/base.css         Shared base styles
functions/               Firebase Cloud Functions (Node 22)
  index.js                Callable functions: lobby/player CRUD, commander damage, timers, warmup, etc.
firestore.rules          Firestore security rules
firebase.json            Firebase Hosting/Functions/Firestore/emulator config
firebase-dev.sh          Local dev/deploy helper script (see below)
useful_scripts/          One-off maintenance scripts (e.g. Firestore collection renaming)
```

Frontend uses the Firebase JS SDK (compat) directly in `public/index.html`/`lobby.html`, calling into the Cloud Functions in `functions/index.js` for all lobby and player state changes, backed by Firestore.

### Requirements

- Firebase CLI (`firebase-tools`)
- A `FIREBASE_TOKEN` environment variable for CLI auth
- `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account key (used by `firebase-dev.sh`)

## What `firebase-dev.sh` does

A convenience wrapper around the Firebase CLI for local development and deployment. It exports the env vars needed for local function execution (`FUNCTIONS_DISCOVERY_TIMEOUT`, `GOOGLE_APPLICATION_CREDENTIALS`), then dispatches to a subcommand:

| Command | Action |
|---|---|
| `start-emulators` | Kills any process already bound to the emulator ports (8080 Firestore, 9099 Auth, 5001 Functions, 5000 Hosting, 4000 UI), then starts all Firebase emulators |
| `test-functions` | Runs `npm run serve` inside `functions/` to test Cloud Functions locally |
| `deploy-functions` | Deploys only Cloud Functions (`firebase deploy --only functions`) |
| `deploy-hosting` | Deploys only Hosting (`firebase deploy --only hosting`) |
| `deploy-all` | Deploys everything (`firebase deploy`) |
| `serve-hosting` | Serves Hosting locally (`firebase serve --only hosting`) |

It requires `FIREBASE_TOKEN` to be set and exits with an error otherwise. Usage:

```bash
./firebase-dev.sh start-emulators
./firebase-dev.sh deploy-all
```
