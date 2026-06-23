# Bluff Card Game v7

This version keeps the working login, room join, start game, and play flow from v6, then adds the requested gameplay improvements:

- Cards in your hand are sorted and grouped by rank, so pairs/triples/quads stay together.
- Rank groups show a small badge like `2× Jacks` or `3× 6s`.
- Pass option added during an active set.
- Same-rank set rule added: after someone claims Jacks, the next players must continue Jacks, pass, or call bluff.
- If everyone passes until the turn reaches the last player who placed cards, the center pile is cleared and the first passer starts a new set.
- Start Game now shows a face-down deck dealing animation before the game table appears.

## Firebase setup

Enable:

1. Authentication -> Email/Password
2. Realtime Database

Use these Realtime Database rules for authenticated play:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "users": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

## Config

`firebase-config.js` should only contain `window.firebaseConfig`.

Do not add these lines in `firebase-config.js`:

```js
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
```

`app.js` handles Firebase initialization internally.

## Testing

Use two different logins:

- Player 1: Normal Chrome -> create room -> keep tab open
- Player 2: Incognito / Edge / phone -> join same room code

Then Player 1 clicks Start Game.

For clean testing, create a new room with this v7 version instead of joining old rooms created with previous versions.
