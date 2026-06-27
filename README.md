# Bluff Card Game v9

This version keeps the v8 visual redesign and the v7 gameplay logic (with the pass/bluff turn-order bug fixed). What's new is a real **home dashboard, profile page, avatars, guest login, and stat tracking**.

## What's new in v9

**Guest login**
- A third "Guest" tab on the login screen lets anyone play with just a display name — no email or password.
- Guest accounts use Firebase Anonymous Authentication, so they still get a real `uid`, can host/join rooms, and keep stats — but only on that device/browser until they save a profile.
- From the Profile page, a guest can add an email + password to permanently save their account (Firebase's "link credential" flow) — same name, avatar, and stats carry over, no progress lost.

**Avatars**
- 24 emoji avatars to choose from, each shown inside a colored ring (color is derived from the player's uid, so it's consistent every session).
- Set from the Profile page; shows up in the waiting room, the in-game player chips, and the home page profile pill.

**Profile page**
- Tap your avatar/name pill on the home screen to open it.
- Change your display name and avatar.
- See your stats: games played, games won, win rate, bluffs caught, bluffs landed (your bluffs that nobody challenged), and bluff success rate.
- Guests see a "Save your profile" panel here to upgrade to a full account.

**Stats tracking**
- Recorded automatically as you play — no setup needed.
- `gamesPlayed` / `gamesWon`: counted once per finished game, for every player at the table (not just the winner).
- `bluffsCaught`: +1 when you call Bluff and you were right.
- `bluffsBackfired`: +1 when someone calls Bluff on *your* claim and you really were lying.
- `bluffsLanded`: +1 when your claim survives a full round unchallenged and it actually was a bluff.
- Stats live at `users/{uid}/stats` in the Realtime Database and are visible to the player on their own Profile page.

**Home page redesign**
- Profile pill at the top (avatar + name) — tap it to open your profile.
- Quick stat strip (Played / Won / Bluffs Caught) right under the hero.
- Create Room / Join Room / How to Play are now full-width cards with icons and a one-line description each, instead of plain buttons.

## Carried over from v8 (unchanged)
- 2–6 players per room.
- "Smoky card room" visual theme: emerald felt, brass accents, Fraunces + Inter typography.
- Sticky bottom hand panel, responsive card sizing, reduced-motion support.
- Same-rank claim / pass / bluff-call gameplay logic, including the fix where the last player to move always gets their turn back before the pile can clear.

## Firebase setup

Enable, in the Firebase Console under **Authentication → Sign-in method**:

1. **Email/Password** — for full accounts.
2. **Anonymous** — required for Guest login to work. If you skip this, the Guest tab will show an "operation-not-allowed" error.

Also enable **Realtime Database**.

Use these Realtime Database rules (unchanged from v8 — anonymous users still satisfy `auth != null`, so no rule changes are needed for guests):

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

Use a mix of logins to see everything:

- Player 1: Normal Chrome -> sign up with email -> create room -> keep tab open
- Player 2: Incognito -> use **Guest** tab with just a name -> join the same room code
- Player 3+: more incognito windows / other devices, mix of guest and email accounts

Then Player 1 clicks Start Game. After a game finishes, open each player's Profile page to confirm `gamesPlayed`/`gamesWon` went up, and try a Bluff call to confirm `bluffsCaught` / `bluffsBackfired` update on the right accounts.

For clean testing, create a new room with this v9 version instead of joining old rooms created with previous versions (older rooms won't have `avatar` on player records, which is handled gracefully with a default avatar fallback, but it's cleaner to start fresh).

## What's not in this version yet (planned next)

- Quick in-game reactions/emotes
- Scrollable round-by-round game history log
- Animated card-to-pile movement when a move is played
- Rematch button on the winner screen

## Latest fixes in this version (game room polish + gameplay rules)

**Layout**
- Reduced stacked padding across `.screen` / `.table-panel` / `.hand-panel` so there's no more wasted black space on the sides on mobile.
- The center pile now shows a compact one-line message when empty instead of reserving a tall, mostly-blank block — this is what was pushing "Your Cards" off-screen.
- Cards are smaller on phones (56px, down to 50px under 380px width) so multiple rank-groups can sit on the same line instead of each one forcing a new row.
- Card-selection no longer jumps your scroll position back to the start of your hand every time you tap a card.

**Gameplay rules**
- You can only ever select/play up to 4 cards in one move (selecting a 5th shows a toast; already-maxed-out cards visually dim so it's clear you're capped).
- Ranks where all 4 cards have already been revealed (shown face-up after a bluff call) no longer appear as claimable ranks when starting a new set — claiming a fully "dead" rank made no sense since everyone already knows it.
- **Big one:** if you play your last card(s) and your hand goes to 0, you are *not* declared the winner immediately. The next player still gets a normal turn and can Pass or Call Bluff on your claim, exactly like any other move. You only actually win if:
  - nobody challenges and the round naturally clears back to you, or
  - someone challenges, you were genuinely honest, and the challenge fails (in that case you win immediately since your claim was just proven true).
  
  If someone calls Bluff and you really were lying, you pick the whole pile back up and keep playing — no more "winning" by sneaking a lie past on your last turn.
- Selected cards now show a small numbered badge (1–4) so you can see the order you picked them in, and the "X selected" counter shows "X/4" so the cap is always visible.

**Sound**
- Lightweight sound effects using the Web Audio API (no external files, so they work fully offline): a click for playing cards, a soft tone for selecting/deselecting, a low tone for passing, a dramatic sting when Bluff is called, a result chime for catch/backfire, and a short fanfare when a game is won.
- A speaker icon in the game header lets you mute/unmute; your preference is remembered (`localStorage`).
- Sounds for other players' moves play in real time as their actions sync in, not just for your own actions.

