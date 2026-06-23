# Bluff Card Game v8

This version keeps the working login, room join, start game, play, pass, and bluff-call logic from v7 — the Firebase auth and Realtime Database flow is unchanged. What's new is a full visual/UX redesign and the player cap increase.

## What changed from v7

**Players**
- Room size increased from 2–4 to **2–6 players**. Dealing animation, player chips, and waiting-room grid all updated to lay out cleanly at 6.

**Visual redesign ("smoky card room" theme)**
- New color palette: deep emerald felt, warm brass/gold (replacing flat gold), ivory text, ruby for danger/bluff actions.
- New typography: **Fraunces** (a characterful serif) for headings and the room code, **Inter** for body/UI text — loaded from Google Fonts in `index.html`.
- Cards redesigned with better proportions, soft inner highlight, and a smoother lift/selection animation.
- "Call Bluff" button now pulses subtly so it reads as the high-stakes action it is.
- Bluff reveal modal now opens with a stamp-style "Bluff Caught" / "Honest Move" badge, and revealed cards flip in one by one.
- Pile shows a small floating card-count tag instead of burying the count in text.
- Active player's turn pill has a soft glow; active player chip is more clearly highlighted.
- Reduced-motion support: all animations are disabled if the user's OS has "reduce motion" turned on.

**Mobile responsiveness**
- Hand panel (your cards + action buttons) is sticky to the bottom of the screen so it's always thumb-reachable while scrolling.
- Card sizes scale down further on very narrow screens (<380px) instead of just shrinking the layout around them.
- Player chip grid responsively goes from 2 columns (phone) → 3 (tablet) → 6 (desktop) so it doesn't look sparse on large screens with few players, or cramped on phones with many.

No gameplay rules changed — same-rank claim, pass, pile-clear-on-all-pass, and bluff-resolution logic is identical to v7.

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

Then Player 1 clicks Start Game. Try it with 5-6 logins/devices to see the new player-count layout.

For clean testing, create a new room with this v8 version instead of joining old rooms created with previous versions.

