/*
  Bluff Card Game
  HTML + CSS + Vanilla JS + Firebase Auth + Firebase Realtime Database
*/

const APP_NAME = "Bluff Card Game";
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];
const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };

const RANK_NAMES = {
  A: ["Ace", "Aces"],
  J: ["Jack", "Jacks"],
  Q: ["Queen", "Queens"],
  K: ["King", "Kings"]
};

const appEl = document.getElementById("app");
const modalRoot = document.getElementById("modalRoot");
const toastEl = document.getElementById("toast");

let auth = null;
let db = null;
let currentUser = null;
let userProfile = null;
let playerName = localStorage.getItem("bluffPlayerName") || "";
let authMode = "login";
let currentScreen = "loading";
let currentRoomCode = localStorage.getItem("bluffCurrentRoom") || "";
let currentRoom = null;
let roomRef = null;
let roomListener = null;
let selectedCards = [];
let isBusy = false;
let lastShownResultId = "";
let lastShownRoundMessageId = "";
let toastTimer = null;
let dealAnimationRoomCode = "";
let dealAnimationTimer = null;
const seenDealAnimationRooms = new Set();

initApp();

function initApp() {
  renderLoading();

  if (!window.firebaseConfig || isPlaceholderConfig(window.firebaseConfig)) {
    renderFirebaseConfigMissing();
    return;
  }

  try {
    firebase.initializeApp(window.firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
  } catch (error) {
    renderFatalError("Firebase could not start", error.message);
    return;
  }

  auth.onAuthStateChanged(async (user) => {
    try {
      currentUser = user || null;

      if (!currentUser) {
        userProfile = null;
        playerName = "";
        clearRoomLocalState();
        navigate("auth", false);
        return;
      }

      await loadCurrentUserProfile();

      if (currentRoomCode) {
        subscribeToRoom(currentRoomCode);
        return;
      }

      navigate(playerName ? "home" : "name", false);
    } catch (error) {
      renderFatalError("Sign in failed", error.message);
    }
  });

  window.history.replaceState({ bluff: true, screen: currentScreen }, "", window.location.pathname);
}

function isPlaceholderConfig(config) {
  return !config || !config.apiKey || !config.projectId || !config.databaseURL ||
    String(config.apiKey).includes("YOUR_") ||
    String(config.projectId).includes("YOUR_") ||
    String(config.databaseURL).includes("YOUR_");
}

function renderLoading() {
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card loading-card">
        <div class="logo-mark">♠</div>
        <span class="badge">Realtime Multiplayer</span>
        <h1>${APP_NAME}</h1>
        <p>Loading table...</p>
      </div>
    </section>
  `;
}

function renderFirebaseConfigMissing() {
  currentScreen = "config";
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card config-warning">
        <div class="logo-mark">!</div>
        <h2>Firebase config needed</h2>
        <p>Open <span class="code-inline">firebase-config.js</span> and replace the placeholder values with your Firebase web app config.</p>
        <p>After that, enable Email/Password Authentication and Realtime Database in Firebase Console.</p>
      </div>
    </section>
  `;
}

function renderFatalError(title, message) {
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card config-warning">
        <div class="logo-mark">!</div>
        <h2>${escapeHTML(title)}</h2>
        <p>${escapeHTML(message || "Something went wrong.")}</p>
      </div>
    </section>
  `;
}

async function loadCurrentUserProfile() {
  if (!currentUser || !db) return;

  const snap = await db.ref(`users/${currentUser.uid}`).once("value");
  userProfile = snap.val() || null;

  const savedName = userProfile?.username || currentUser.displayName || localStorage.getItem("bluffPlayerName") || "";
  playerName = String(savedName || "").trim().slice(0, 18);

  if (playerName) {
    localStorage.setItem("bluffPlayerName", playerName);
  }

  if (!userProfile && playerName) {
    await saveUserProfile(playerName).catch(() => {});
  }
}

async function saveUserProfile(username) {
  if (!currentUser || !db) return;
  const cleanName = String(username || "").trim().slice(0, 18);
  if (!cleanName) throw new Error("Enter a username");

  playerName = cleanName;
  localStorage.setItem("bluffPlayerName", cleanName);

  await currentUser.updateProfile({ displayName: cleanName }).catch(() => {});
  await db.ref(`users/${currentUser.uid}`).update({
    username: cleanName,
    email: currentUser.email || "",
    uid: currentUser.uid,
    updatedAt: firebase.database.ServerValue.TIMESTAMP,
    createdAt: userProfile?.createdAt || firebase.database.ServerValue.TIMESTAMP
  });

  userProfile = {
    ...(userProfile || {}),
    username: cleanName,
    email: currentUser.email || "",
    uid: currentUser.uid
  };
}

async function signUpWithEmail(username, email, password) {
  if (!auth || !db || isBusy) return;
  const cleanName = String(username || "").trim().slice(0, 18);
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanName) return showToast("Enter username");
  if (!cleanEmail) return showToast("Enter email");
  if (String(password || "").length < 6) return showToast("Password must be at least 6 characters");

  setBusy(true);
  try {
    const credential = await auth.createUserWithEmailAndPassword(cleanEmail, password);
    currentUser = credential.user;
    await saveUserProfile(cleanName);
    showToast("Account created");
    navigate("home", false);
  } catch (error) {
    showToast(formatAuthError(error));
  } finally {
    setBusy(false);
  }
}

async function loginWithEmail(email, password) {
  if (!auth || isBusy) return;
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) return showToast("Enter email");
  if (!password) return showToast("Enter password");

  setBusy(true);
  try {
    await auth.signInWithEmailAndPassword(cleanEmail, password);
    showToast("Logged in");
  } catch (error) {
    showToast(formatAuthError(error));
  } finally {
    setBusy(false);
  }
}

async function logout() {
  if (!auth || isBusy) return;
  if (currentRoomCode) {
    await leaveRoom();
  }
  setBusy(true);
  try {
    clearRoomLocalState();
    localStorage.removeItem("bluffCurrentRoom");
    await auth.signOut();
    showToast("Logged out");
  } catch (error) {
    showToast(error.message || "Could not logout");
  } finally {
    setBusy(false);
  }
}

function resetPasswordPrompt() {
  const email = document.getElementById("loginEmail")?.value || "";
  showModal("Reset password", `
    <p>Enter your account email. Firebase will send a password reset email.</p>
    <input class="input" id="resetEmail" type="email" placeholder="Email address" value="${escapeHTML(email)}" />
  `, `
    <button class="btn secondary" data-action="close-modal">Cancel</button>
    <button class="btn" data-action="send-reset-email">Send Email</button>
  `);
}

async function sendPasswordReset() {
  const email = String(document.getElementById("resetEmail")?.value || "").trim().toLowerCase();
  if (!email) return showToast("Enter email");
  setBusy(true);
  try {
    await auth.sendPasswordResetEmail(email);
    closeModal();
    showToast("Reset email sent");
  } catch (error) {
    showToast(formatAuthError(error));
  } finally {
    setBusy(false);
  }
}

function formatAuthError(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "This email is already registered";
  if (code.includes("invalid-email")) return "Invalid email address";
  if (code.includes("weak-password")) return "Password is too weak";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong email or password";
  if (code.includes("operation-not-allowed")) return "Enable Email/Password Authentication in Firebase";
  return error?.message || "Authentication failed";
}

function navigate(screen, push = true) {
  currentScreen = screen;
  closeModal(false);

  if (push) {
    window.history.pushState({ bluff: true, screen }, "", `#${screen}`);
  }

  renderCurrentScreen();
}

function renderCurrentScreen() {
  if (currentRoomCode && currentRoom) {
    if (currentRoom.status === "waiting") {
      renderWaitingRoom(currentRoom);
      return;
    }
    if (currentRoom.status === "playing") {
      renderGame(currentRoom);
      return;
    }
    if (currentRoom.status === "finished") {
      renderWinner(currentRoom);
      return;
    }
  }

  if (currentScreen === "auth") renderAuthScreen();
  else if (currentScreen === "name") renderNameScreen();
  else if (currentScreen === "home") renderHome();
  else if (currentScreen === "join") renderJoinRoom();
  else if (currentScreen === "how") renderHowToPlay();
  else renderLoading();
}

function renderAuthScreen() {
  const isSignup = authMode === "signup";
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card auth-card">
        <div class="logo-mark">♠</div>
        <span class="badge">Realtime Multiplayer</span>
        <h1>${isSignup ? "Create Account" : "Login"}</h1>
        <p>${isSignup ? "Make your Bluff account with a username, email and password." : "Login to create or join online Bluff rooms."}</p>

        <div class="auth-tabs" role="tablist" aria-label="Authentication tabs">
          <button type="button" class="auth-tab ${!isSignup ? "active" : ""}" data-action="show-login">Login</button>
          <button type="button" class="auth-tab ${isSignup ? "active" : ""}" data-action="show-signup">Sign Up</button>
        </div>

        <form id="${isSignup ? "signupForm" : "loginForm"}" class="form">
          ${isSignup ? `<input class="input" id="signupUsername" maxlength="18" autocomplete="name" placeholder="Username" required />` : ""}
          <input class="input" id="${isSignup ? "signupEmail" : "loginEmail"}" type="email" autocomplete="email" placeholder="Email address" required />
          <input class="input" id="${isSignup ? "signupPassword" : "loginPassword"}" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="6" placeholder="Password" required />
          <button class="btn" type="submit">${isSignup ? "Create Account" : "Login"}</button>
        </form>

        ${!isSignup ? `<p style="margin: 16px 0 0;"><button class="text-button" data-action="reset-password">Forgot password?</button></p>` : `<p style="margin: 16px 0 0;">Password must be at least 6 characters.</p>`}
      </div>
    </section>
  `;
}

function renderNameScreen() {
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card">
        <div class="logo-mark">♣</div>
        <span class="badge">Username</span>
        <h1>Your Name</h1>
        <p>This username will be shown to other players in your Bluff room.</p>
        <form id="nameForm" class="form">
          <input class="input" id="nameInput" maxlength="18" autocomplete="name" placeholder="Enter your username" value="${escapeHTML(playerName)}" required />
          <button class="btn" type="submit">Save Username</button>
        </form>
        <p style="margin: 16px 0 0;"><button class="text-button" data-action="logout">Logout</button></p>
      </div>
    </section>
  `;
}

function renderHome() {
  const email = currentUser?.email || "";
  appEl.innerHTML = `
    <section class="screen hero">
      <div class="brand-card">
        <div class="logo-mark">♠</div>
        <span class="badge">2 to 4 Players</span>
        <h1>${APP_NAME}</h1>
        <p>Create a room, invite friends, play cards face-down, and call Bluff when someone is lying.</p>
        <div class="home-grid">
          <button class="btn" data-action="create-room">Create Room</button>
          <button class="btn secondary" data-action="open-join">Join Room</button>
          <button class="btn secondary" data-action="how-to-play">How to Play</button>
        </div>
        <div class="profile-mini">
          <div>
            <strong>${escapeHTML(playerName || "Player")}</strong>
            <span>${escapeHTML(email)}</span>
          </div>
          <div class="profile-actions">
            <button class="text-button" data-action="change-name">Edit username</button>
            <button class="text-button" data-action="logout">Logout</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderJoinRoom() {
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card">
        <div class="topbar" style="position: static; padding: 0 0 18px; background: transparent;">
          <div class="topbar-title">
            <strong>Join Room</strong>
            <span>Enter the 6-character room code</span>
          </div>
          <button class="btn secondary" data-action="back-home" type="button">Back</button>
        </div>
        <form id="joinForm" class="form">
          <input class="input" id="roomCodeInput" maxlength="6" autocomplete="off" placeholder="ABC123" required />
          <button class="btn" type="submit">Join Game</button>
        </form>
      </div>
    </section>
  `;
}

function renderHowToPlay() {
  appEl.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div class="topbar-title">
          <strong>How to Play</strong>
          <span>Quick Bluff rules</span>
        </div>
        <button class="btn secondary" data-action="back-home">Back</button>
      </div>
      <div class="panel">
        <h2>Bluff Rules</h2>
        <ul class="rules-list">
          <li>2 to 4 players can play in one online room.</li>
          <li>Every player gets cards from a shuffled 52-card deck.</li>
          <li>On your turn, select one or more cards and claim a rank like “2 Kings”.</li>
          <li>After a set starts, the next players must continue the same claimed rank or press <strong>Pass</strong>.</li>
          <li>If everyone passes until the turn reaches the last player who placed cards, the center pile is cleared and the first passer starts a new set.</li>
          <li>Your cards go face-down into the center pile, so others cannot see them.</li>
          <li>The next player can play, pass, or tap <strong>Call Bluff</strong>.</li>
          <li>If the last player lied, they pick up the full pile. If they were honest, the caller picks up the pile.</li>
          <li>The first player with zero cards wins.</li>
        </ul>
      </div>
    </section>
  `;
}

async function createRoom() {
  if (!ensureReady() || isBusy) return;
  setBusy(true);

  try {
    const roomCode = await generateUniqueRoomCode();
    const uid = currentUser.uid;
    const newRoom = {
      status: "waiting",
      hostId: uid,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      maxPlayers: MAX_PLAYERS,
      currentTurnIndex: 0,
      turnOrder: [],
      pile: [],
      lastMove: null,
      lastResult: null,
      roundRank: null,
      passes: [],
      firstPassAfterLastMove: null,
      winner: null,
      players: {
        [uid]: {
          name: playerName,
          cardsCount: 0,
          isHost: true,
          online: true,
          joinedAt: firebase.database.ServerValue.TIMESTAMP
        }
      },
      hands: {}
    };

    await db.ref(`rooms/${roomCode}`).set(newRoom);
    currentRoomCode = roomCode;
    localStorage.setItem("bluffCurrentRoom", roomCode);
    subscribeToRoom(roomCode);
    showToast(`Room ${roomCode} created`);
  } catch (error) {
    showToast(error.message || "Could not create room");
  } finally {
    setBusy(false);
  }
}

async function generateUniqueRoomCode() {
  for (let i = 0; i < 12; i += 1) {
    const code = generateRoomCode();
    const snap = await db.ref(`rooms/${code}`).once("value");
    if (!snap.exists()) return code;
  }
  throw new Error("Could not generate a room code. Try again.");
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function joinRoom(roomCode) {
  if (!ensureReady() || isBusy) return;

  // Accept copied codes with spaces or lowercase and normalize them.
  const code = String(roomCode || "").trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (code.length !== 6) {
    showToast("Enter a valid 6-character room code");
    return;
  }

  setBusy(true);

  try {
    const uid = currentUser.uid;
    const targetRef = db.ref(`rooms/${code}`);

    // Stable join flow:
    // 1) Read the room once.
    // 2) Validate status/player count.
    // 3) Add only this player under rooms/{code}/players/{uid}.
    // This avoids Realtime Database transaction's first null callback issue,
    // which was causing valid rooms to show "Room was closed".
    const snap = await targetRef.once("value");
    const room = snap.val();

    if (!room) {
      showToast(`Room ${code} does not exist. Check the code again.`);
      return;
    }

    if (room.status !== "waiting") {
      showToast(room.status === "playing" ? "This game has already started" : "This room is closed");
      return;
    }

    const players = room.players || {};
    const alreadyInside = Boolean(players[uid]);
    const playerCount = Object.keys(players).length;

    if (!alreadyInside && playerCount >= (room.maxPlayers || MAX_PLAYERS)) {
      showToast("Room is full");
      return;
    }

    await targetRef.child(`players/${uid}`).update({
      name: playerName,
      cardsCount: players[uid]?.cardsCount || 0,
      isHost: room.hostId === uid,
      online: true,
      joinedAt: players[uid]?.joinedAt || firebase.database.ServerValue.TIMESTAMP
    });

    currentRoomCode = code;
    localStorage.setItem("bluffCurrentRoom", code);
    subscribeToRoom(code);
    showToast(alreadyInside ? "You are already in this room. For a second player, use another account/browser or incognito." : `Joined room ${code}`);
  } catch (error) {
    showToast(error.message || "Could not join room");
  } finally {
    setBusy(false);
  }
}

function subscribeToRoom(roomCode) {
  unsubscribeRoom();
  currentRoomCode = roomCode;
  roomRef = db.ref(`rooms/${roomCode}`);

  roomListener = roomRef.on("value", (snapshot) => {
    const room = snapshot.val();

    if (!room) {
      clearRoomLocalState();
      showToast("Room closed");
      navigate("home", false);
      return;
    }

    currentRoom = room;
    setPlayerOnline(roomCode);

    if (room.status === "playing" && dealAnimationRoomCode === roomCode) {
      return;
    }

    if (room.status === "playing" && !seenDealAnimationRooms.has(roomCode)) {
      startDealAnimation(roomCode, room);
      return;
    }

    if (room.status === "waiting") currentScreen = "waiting";
    if (room.status === "playing") currentScreen = "game";
    if (room.status === "finished") currentScreen = "winner";

    renderCurrentScreen();
  });
}

function unsubscribeRoom() {
  if (roomRef && roomListener) {
    roomRef.off("value", roomListener);
  }
  roomRef = null;
  roomListener = null;
}

function setPlayerOnline(roomCode) {
  if (!currentUser || !db) return;
  const statusRef = db.ref(`rooms/${roomCode}/players/${currentUser.uid}/online`);
  statusRef.set(true).catch(() => {});
  statusRef.onDisconnect().set(false);
}

function startDealAnimation(roomCode, room) {
  seenDealAnimationRooms.add(roomCode);
  currentRoom = room;
  currentScreen = "game";
  dealAnimationRoomCode = roomCode;
  clearTimeout(dealAnimationTimer);
  renderDealAnimation(room);
  dealAnimationTimer = setTimeout(() => {
    if (dealAnimationRoomCode === roomCode) {
      dealAnimationRoomCode = "";
      renderCurrentScreen();
    }
  }, 3200);
}

function renderDealAnimation(room) {
  const players = (room.turnOrder || []).map((uid) => room.players?.[uid]?.name || "Player");
  const animatedCards = Array.from({ length: Math.min(24, Math.max(8, players.length * 6)) }, (_, index) => {
    const target = index % Math.max(players.length, 1);
    return `<div class="deal-card fly-card target-${target}" style="--i:${index};"></div>`;
  }).join("");

  appEl.innerHTML = `
    <section class="screen dealing-screen">
      <div class="table-panel dealing-table">
        <div class="dealing-top">
          <div class="room-code">${escapeHTML(currentRoomCode)}</div>
          <h2>Dealing Cards</h2>
          <p>Deck is being shuffled and distributed to players...</p>
        </div>
        <div class="deal-arena">
          <div class="deck-stack" aria-label="Full deck face down">
            ${Array.from({ length: 8 }, (_, i) => `<div class="deck-layer" style="--i:${i}"></div>`).join("")}
            ${animatedCards}
          </div>
        </div>
        <div class="deal-players deal-count-${players.length}">
          ${players.map((name, index) => `<div class="deal-player target-${index}"><span>${escapeHTML(shortName(name))}</span><strong>Receiving cards</strong></div>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderWaitingRoom(room) {
  const players = getSortedPlayers(room);
  const isHost = room.hostId === currentUser?.uid;
  const isFull = players.length >= MAX_PLAYERS;

  appEl.innerHTML = `
    <section class="screen">
      <div class="topbar">
        <div class="topbar-title">
          <strong>Waiting Room</strong>
          <span>${players.length}/${MAX_PLAYERS} players joined</span>
        </div>
        <button class="btn secondary" data-action="leave-room">Leave</button>
      </div>

      <div class="panel">
        <div class="btn-row" style="align-items: center;">
          <div class="room-code">${escapeHTML(currentRoomCode)}</div>
          <button class="btn secondary" data-action="copy-room-code">Copy Code</button>
        </div>
        <p style="margin: 14px 0 0;">Share this code with friends so they can join your table.</p>
        <p class="helper-text">Testing on one laptop? Open another browser/incognito and login with a different account. The same account will not count as a second player.</p>
      </div>

      <div class="panel">
        <h2>Players</h2>
        <div class="player-list">
          ${players.map(({ uid, player }) => renderWaitingPlayer(uid, player, room.hostId)).join("")}
        </div>
      </div>

      <div class="panel">
        ${isFull ? `<span class="badge">Room Full</span>` : `<span class="badge">Need ${Math.max(0, MIN_PLAYERS - players.length)} more</span>`}
        <p style="margin-top: 12px;">Host can start when at least ${MIN_PLAYERS} players are inside.</p>
        ${isHost ? `<button class="btn" data-action="start-game" ${players.length < MIN_PLAYERS ? "disabled" : ""}>Start Game</button>` : `<button class="btn secondary" disabled>Waiting for host</button>`}
      </div>
    </section>
  `;
}

function renderWaitingPlayer(uid, player, hostId) {
  const online = player.online ? "online" : "";
  return `
    <div class="player-item">
      <div class="player-left">
        <div class="avatar">${escapeHTML(getInitial(player.name))}</div>
        <div style="min-width: 0;">
          <div class="player-name">${escapeHTML(player.name || "Player")}</div>
          <div class="player-meta">${uid === hostId ? "Host" : "Player"}${uid === currentUser?.uid ? " · You" : ""}</div>
        </div>
      </div>
      <div class="status-dot ${online}" title="${player.online ? "Online" : "Offline"}"></div>
    </div>
  `;
}

async function startGame() {
  if (!currentRoomCode || !ensureReady() || isBusy) return;
  setBusy(true);

  try {
    const targetRef = db.ref(`rooms/${currentRoomCode}`);
    const snap = await targetRef.once("value");
    const room = snap.val();

    if (!room) {
      showToast("Room does not exist");
      return;
    }

    if (room.status !== "waiting") {
      showToast(room.status === "playing" ? "Game already started" : "Room is not waiting");
      return;
    }

    if (room.hostId !== currentUser.uid) {
      showToast("Only host can start the game");
      return;
    }

    const playerEntries = Object.entries(room.players || {})
      .filter(([, player]) => player)
      .sort((a, b) => Number(a[1].joinedAt || 0) - Number(b[1].joinedAt || 0));

    if (playerEntries.length < MIN_PLAYERS) {
      showToast(`At least ${MIN_PLAYERS} players are required`);
      return;
    }

    const playerIds = playerEntries.slice(0, MAX_PLAYERS).map(([uid]) => uid);
    const deck = shuffleDeck(createDeck());
    const hands = dealCards(deck, playerIds);
    const updatedPlayers = { ...(room.players || {}) };

    playerIds.forEach((uid) => {
      updatedPlayers[uid] = {
        ...(updatedPlayers[uid] || {}),
        name: updatedPlayers[uid]?.name || "Player",
        cardsCount: hands[uid].length,
        online: true,
        isHost: room.hostId === uid
      };
    });

    const startedRoom = {
      ...room,
      status: "playing",
      turnOrder: playerIds,
      currentTurnIndex: 0,
      players: updatedPlayers,
      hands,
      pile: [],
      lastMove: null,
      lastResult: null,
      roundRank: null,
      passes: [],
      firstPassAfterLastMove: null,
      winner: null,
      startedAt: firebase.database.ServerValue.TIMESTAMP
    };

    // Use set instead of transaction here. Realtime Database transactions can run
    // once with null locally before the server value arrives, which previously
    // made Start Game look stuck for some users.
    await targetRef.set(startedRoom);

    selectedCards = [];
    currentRoom = startedRoom;
    currentScreen = "game";
    showToast("Game started");
    if (dealAnimationRoomCode === currentRoomCode) {
      return;
    }
    if (!seenDealAnimationRooms.has(currentRoomCode)) {
      startDealAnimation(currentRoomCode, startedRoom);
    } else {
      renderGame(startedRoom);
    }
  } catch (error) {
    console.error("Start game error", error);
    showToast(error.message || "Could not start game");
  } finally {
    setBusy(false);
  }
}

function renderGame(room) {
  const turnOrder = room.turnOrder || [];
  const currentTurnId = turnOrder[room.currentTurnIndex || 0];
  const currentTurnName = room.players?.[currentTurnId]?.name || "Player";
  const isMyTurn = currentTurnId === currentUser?.uid;
  const myHand = sortHand(room.hands?.[currentUser.uid] || []);
  const pile = room.pile || [];
  const lastMove = room.lastMove || null;
  const roundRank = room.roundRank || lastMove?.claimedRank || null;
  const passes = Array.isArray(room.passes) ? room.passes : [];
  const bluffAllowed = Boolean(isMyTurn && lastMove && lastMove.playerId !== currentUser.uid && pile.length > 0);
  const passAllowed = Boolean(isMyTurn && lastMove && lastMove.playerId !== currentUser.uid && pile.length > 0);
  const playButtonLabel = roundRank ? `Play ${getRankName(roundRank, 2)} Set` : "Play Selected Cards";

  appEl.innerHTML = `
    <section class="screen">
      <div class="table-panel">
        <div class="game-header">
          <div>
            <div class="room-code">${escapeHTML(currentRoomCode)}</div>
            <h2 style="margin: 10px 0 4px;">${isMyTurn ? "Your Turn" : `${escapeHTML(currentTurnName)}'s Turn`}</h2>
            <div class="turn-pill ${isMyTurn ? "my-turn" : ""}">${isMyTurn ? (roundRank ? "Play same set, pass, or call bluff" : "Start a new set") : "Wait for your turn"}</div>
          </div>
          <button class="btn secondary" data-action="confirm-leave-game">Leave</button>
        </div>

        <div class="players-strip">
          ${renderPlayerChips(room, currentTurnId)}
        </div>

        <div class="game-center">
          <div class="pile-zone">
            <div class="pile-cards">
              ${renderPileCards(pile.length)}
            </div>
            <div class="last-claim">
              ${lastMove ? `${escapeHTML(lastMove.playerName || "Player")} claimed ${lastMove.claimedCount} ${escapeHTML(getRankName(lastMove.claimedRank, lastMove.claimedCount))}` : "No claim yet"}
              <small>${roundRank ? `Current set: ${escapeHTML(getRankName(roundRank, 2))}` : "Start any rank"} · ${pile.length} card${pile.length === 1 ? "" : "s"} in pile</small>
              ${passes.length ? `<small>${passes.length} pass${passes.length === 1 ? "" : "es"} after last play</small>` : ""}
            </div>
            <div class="btn-row" style="margin-top: 14px; justify-content: center;">
              ${bluffAllowed ? `<button class="btn danger" data-action="call-bluff">Call Bluff</button>` : ""}
              ${passAllowed ? `<button class="btn secondary" data-action="pass-turn">Pass</button>` : ""}
            </div>
          </div>
        </div>

        <div class="hand-panel">
          <div class="hand-top">
            <div>
              <strong>Your Cards</strong>
              <span> · ${myHand.length} left</span>
            </div>
            <span>${selectedCards.length} selected</span>
          </div>
          <div id="cardsRow" class="cards-row">
            ${renderCards(myHand)}
          </div>
          <div class="btn-row" style="margin-top: 10px;">
            <button class="btn" data-action="open-claim" ${!isMyTurn || selectedCards.length === 0 ? "disabled" : ""}>${playButtonLabel}</button>
            ${passAllowed ? `<button class="btn secondary" data-action="pass-turn">Pass</button>` : ""}
            <button class="btn secondary" data-action="clear-selection" ${selectedCards.length === 0 ? "disabled" : ""}>Clear</button>
          </div>
        </div>
      </div>
    </section>
  `;

  showResultIfNeeded(room);
  showRoundMessageIfNeeded(room);
}

function renderPlayerChips(room, currentTurnId) {
  const entries = (room.turnOrder || []).map((uid) => [uid, room.players?.[uid]]).filter(([, player]) => player);

  return entries.map(([uid, player]) => {
    const isActive = uid === currentTurnId;
    const you = uid === currentUser?.uid ? " · You" : "";
    return `
      <div class="player-chip ${isActive ? "active" : ""}">
        <span title="${escapeHTML(player.name || "Player")}">${escapeHTML(shortName(player.name || "Player"))}${you}</span>
        <strong>${Number(player.cardsCount || 0)} cards</strong>
      </div>
    `;
  }).join("");
}

function renderPileCards(count) {
  if (!count) return `<div class="empty-state">Center pile is empty</div>`;
  const visible = Math.min(count, 5);
  return Array.from({ length: visible }, () => renderCardBack()).join("");
}

function renderCards(cards) {
  if (!cards || cards.length === 0) {
    return `<div class="empty-state">No cards left</div>`;
  }

  const grouped = groupCardsByRank(sortHand(cards));
  let cardIndex = 0;
  return grouped.map((group) => {
    const cardsHTML = group.cards.map((card) => {
      const html = renderCard(card, {
        selectable: true,
        selected: selectedCards.includes(card),
        index: cardIndex
      });
      cardIndex += 1;
      return html;
    }).join("");

    return `
      <div class="card-group ${group.cards.length > 1 ? "has-pair" : ""}">
        ${group.cards.length > 1 ? `<div class="rank-group-badge">${group.cards.length}× ${escapeHTML(getRankName(group.rank, group.cards.length))}</div>` : ""}
        <div class="card-group-row">${cardsHTML}</div>
      </div>
    `;
  }).join("");
}

function renderCard(card, options = {}) {
  const rank = getCardRank(card);
  const suit = getCardSuit(card);
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const red = suit === "H" || suit === "D";
  const selected = options.selected ? "selected" : "";
  const selectable = options.selectable ? "tap-card" : "";
  const data = options.selectable ? `data-card="${escapeHTML(card)}" data-card-index="${Number(options.index || 0)}"` : "";

  return `
    <div class="card ${red ? "red" : ""} ${selected} ${selectable}" ${data} role="button" aria-label="${escapeHTML(card)}">
      <div class="corner top-left"><span>${escapeHTML(rank)}</span><span class="suit-small">${symbol}</span></div>
      <div class="center-suit">${symbol}</div>
      <div class="corner bottom-right"><span>${escapeHTML(rank)}</span><span class="suit-small">${symbol}</span></div>
    </div>
  `;
}

function renderCardBack() {
  return `<div class="card-back" aria-label="Face-down card"></div>`;
}

function openClaimPopup() {
  if (!selectedCards.length) {
    showToast("Select at least one card");
    return;
  }

  const forcedRank = currentRoom?.roundRank || currentRoom?.lastMove?.claimedRank || "";
  const availableRanks = forcedRank ? [forcedRank] : RANKS;
  const rankOptions = availableRanks.map((rank) => `<option value="${rank}">${getRankName(rank, selectedCards.length)}</option>`).join("");

  showModal(`Claim ${selectedCards.length} card${selectedCards.length === 1 ? "" : "s"}`, `
    <p>You selected <strong>${selectedCards.length}</strong> card${selectedCards.length === 1 ? "" : "s"}. ${forcedRank ? `Current set is <strong>${escapeHTML(getRankName(forcedRank, 2))}</strong>, so you must continue the same rank or pass.` : "Choose the rank you want to claim."}</p>
    <label for="claimRank" class="player-meta">Claim as</label>
    <select id="claimRank" class="select" ${forcedRank ? "disabled" : ""}>${rankOptions}</select>
  `, `
    <button class="btn secondary" data-action="close-modal">Cancel</button>
    <button class="btn" data-action="confirm-play">Confirm Play</button>
  `);
}

async function playSelectedCards(claimedRank) {
  if (!currentRoomCode || !ensureReady() || isBusy) return;
  if (!selectedCards.length) {
    showToast("Select at least one card");
    return;
  }
  if (!RANKS.includes(claimedRank)) {
    showToast("Choose a valid rank");
    return;
  }

  setBusy(true);
  const uid = currentUser.uid;
  const cardsToPlay = [...selectedCards];
  const targetRef = db.ref(`rooms/${currentRoomCode}`);

  try {
    const snap = await targetRef.once("value");
    const room = snap.val();

    if (!room || room.status !== "playing") {
      showToast("Game is not active");
      return;
    }

    const turnOrder = room.turnOrder || [];
    const currentTurnIndex = Number(room.currentTurnIndex || 0);
    const currentTurnId = turnOrder[currentTurnIndex];

    if (currentTurnId !== uid) {
      showToast("It is not your turn");
      return;
    }

    const activeRank = room.roundRank || room.lastMove?.claimedRank || null;
    if (activeRank && claimedRank !== activeRank) {
      showToast(`Current set is ${getRankName(activeRank, 2)}. Play same rank or pass.`);
      return;
    }

    const hand = room.hands?.[uid] || [];
    const hasAllCards = cardsToPlay.every((card) => hand.includes(card));
    if (!hasAllCards) {
      showToast("Selected cards are no longer in your hand");
      return;
    }

    const newHand = sortHand(removeCardsFromHand(hand, cardsToPlay));
    const updatedRoom = {
      ...room,
      hands: { ...(room.hands || {}) },
      players: { ...(room.players || {}) },
      pile: [...(room.pile || []), ...cardsToPlay],
      roundRank: activeRank || claimedRank,
      passes: [],
      firstPassAfterLastMove: null,
      lastMove: {
        playerId: uid,
        playerName: room.players?.[uid]?.name || playerName,
        claimedRank,
        claimedCount: cardsToPlay.length,
        actualCards: cardsToPlay,
        timestamp: Date.now()
      },
      lastResult: null
    };

    updatedRoom.hands[uid] = newHand;
    updatedRoom.players[uid] = {
      ...(updatedRoom.players[uid] || {}),
      cardsCount: newHand.length
    };

    if (checkWinner(newHand)) {
      updatedRoom.status = "finished";
      updatedRoom.winner = {
        uid,
        name: updatedRoom.players?.[uid]?.name || playerName
      };
      updatedRoom.finishedAt = Date.now();
    } else {
      updatedRoom.currentTurnIndex = getNextPlayerIndex(turnOrder, currentTurnIndex);
    }

    // Direct set is used here because Realtime Database transactions were
    // causing some browsers/WebViews to get stuck after Confirm Play.
    await targetRef.set(updatedRoom);

    selectedCards = [];
    closeModal(false);
    currentRoom = updatedRoom;
    renderGame(updatedRoom);
    showToast("Cards played");
  } catch (error) {
    console.error("Play selected cards error", error);
    showToast(formatDatabaseError(error, "Could not play cards"));
  } finally {
    setBusy(false);
  }
}

async function passTurn() {
  if (!currentRoomCode || !ensureReady() || isBusy) return;
  setBusy(true);

  const uid = currentUser.uid;
  const targetRef = db.ref(`rooms/${currentRoomCode}`);

  try {
    const snap = await targetRef.once("value");
    const room = snap.val();

    if (!room || room.status !== "playing") {
      showToast("Game is not active");
      return;
    }

    const turnOrder = room.turnOrder || [];
    const currentTurnIndex = Number(room.currentTurnIndex || 0);
    const currentTurnId = turnOrder[currentTurnIndex];
    const lastMove = room.lastMove || null;

    if (currentTurnId !== uid) {
      showToast("It is not your turn");
      return;
    }

    if (!lastMove || lastMove.playerId === uid || !(room.pile || []).length) {
      showToast("You can pass only after someone has played cards");
      return;
    }

    const oldPasses = Array.isArray(room.passes) ? room.passes : [];
    const passes = oldPasses.includes(uid) ? oldPasses : [...oldPasses, uid];
    const firstPassAfterLastMove = room.firstPassAfterLastMove || uid;
    const nextIndex = getNextPlayerIndex(turnOrder, currentTurnIndex);
    const nextPlayerId = turnOrder[nextIndex];
    const roundShouldClear = nextPlayerId === lastMove.playerId || passes.filter((id) => id !== lastMove.playerId).length >= Math.max(0, turnOrder.length - 1);

    const updatedRoom = {
      ...room,
      passes,
      firstPassAfterLastMove,
      lastResult: null
    };

    selectedCards = [];

    if (roundShouldClear) {
      const firstPassIndex = Math.max(0, turnOrder.indexOf(firstPassAfterLastMove));
      updatedRoom.pile = [];
      updatedRoom.lastMove = null;
      updatedRoom.roundRank = null;
      updatedRoom.passes = [];
      updatedRoom.firstPassAfterLastMove = null;
      updatedRoom.currentTurnIndex = firstPassIndex >= 0 ? firstPassIndex : nextIndex;
      updatedRoom.roundMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: "Everyone passed. The center pile was cleared. Start a new set.",
        timestamp: Date.now()
      };
      showToast("Everyone passed. Pile cleared.");
    } else {
      updatedRoom.currentTurnIndex = nextIndex;
      updatedRoom.roundMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: `${room.players?.[uid]?.name || playerName} passed`,
        timestamp: Date.now()
      };
      showToast("Passed");
    }

    await targetRef.set(updatedRoom);
    currentRoom = updatedRoom;
    renderGame(updatedRoom);
  } catch (error) {
    console.error("Pass turn error", error);
    showToast(formatDatabaseError(error, "Could not pass"));
  } finally {
    setBusy(false);
  }
}

async function callBluff() {
  if (!currentRoomCode || !ensureReady() || isBusy) return;
  setBusy(true);

  const callerId = currentUser.uid;
  const targetRef = db.ref(`rooms/${currentRoomCode}`);

  try {
    const snap = await targetRef.once("value");
    const room = snap.val();

    if (!room || room.status !== "playing") {
      showToast("Game is not active");
      return;
    }

    const turnOrder = room.turnOrder || [];
    const currentTurnIndex = Number(room.currentTurnIndex || 0);
    const currentTurnId = turnOrder[currentTurnIndex];
    const lastMove = room.lastMove;
    const pile = room.pile || [];

    if (currentTurnId !== callerId) {
      showToast("You can call bluff only on your turn");
      return;
    }

    if (!lastMove || lastMove.playerId === callerId || pile.length === 0) {
      showToast("There is no valid move to challenge");
      return;
    }

    const wasBluff = isBluff(lastMove);
    const loserId = wasBluff ? lastMove.playerId : callerId;
    const loserName = room.players?.[loserId]?.name || "Player";
    const callerName = room.players?.[callerId]?.name || playerName;
    const playerNameWhoMoved = lastMove.playerName || room.players?.[lastMove.playerId]?.name || "Player";

    const updatedHands = { ...(room.hands || {}) };
    const updatedPlayers = { ...(room.players || {}) };
    updatedHands[loserId] = sortHand(pickUpPile(updatedHands[loserId] || [], pile));
    updatedPlayers[loserId] = {
      ...(updatedPlayers[loserId] || {}),
      cardsCount: updatedHands[loserId].length
    };

    const loserIndex = turnOrder.indexOf(loserId);
    let nextTurnIndex = loserIndex >= 0 ? loserIndex : turnOrder.indexOf(callerId);
    if (nextTurnIndex < 0) nextTurnIndex = 0;

    const updatedRoom = {
      ...room,
      hands: updatedHands,
      players: updatedPlayers,
      pile: [],
      lastMove: null,
      roundRank: null,
      passes: [],
      firstPassAfterLastMove: null,
      currentTurnIndex: nextTurnIndex,
      lastResult: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        callerId,
        callerName,
        playerId: lastMove.playerId,
        playerName: playerNameWhoMoved,
        claimedRank: lastMove.claimedRank,
        claimedCount: lastMove.claimedCount,
        wasBluff,
        loserId,
        loserName,
        revealedCards: lastMove.actualCards || [],
        message: wasBluff
          ? `${playerNameWhoMoved} was bluffing. ${loserName} picked up the pile.`
          : `${playerNameWhoMoved} was honest. ${loserName} picked up the pile.`,
        timestamp: Date.now()
      }
    };

    await targetRef.set(updatedRoom);

    selectedCards = [];
    currentRoom = updatedRoom;
    renderGame(updatedRoom);
  } catch (error) {
    console.error("Call bluff error", error);
    showToast(formatDatabaseError(error, "Could not call bluff"));
  } finally {
    setBusy(false);
  }
}

function showResultIfNeeded(room) {
  const result = room.lastResult;
  if (!result || !result.id || result.id === lastShownResultId) return;
  lastShownResultId = result.id;

  const cards = (result.revealedCards || []).map((card) => renderCard(card)).join("");
  const title = result.wasBluff ? "Bluff Caught" : "Honest Move";

  showModal(title, `
    <p><strong>${escapeHTML(result.callerName || "Player")}</strong> called Bluff on <strong>${escapeHTML(result.playerName || "Player")}</strong>.</p>
    <p>Claimed: <strong>${Number(result.claimedCount || 0)} ${escapeHTML(getRankName(result.claimedRank, result.claimedCount || 0))}</strong></p>
    <div class="revealed-cards">${cards}</div>
    <p style="margin-top: 12px;"><strong>${escapeHTML(result.message || "Pile resolved.")}</strong></p>
  `, `
    <button class="btn" data-action="close-modal">Continue</button>
  `);
}

function showRoundMessageIfNeeded(room) {
  const roundMessage = room.roundMessage;
  if (!roundMessage || !roundMessage.id || roundMessage.id === lastShownRoundMessageId) return;
  lastShownRoundMessageId = roundMessage.id;
  showToast(roundMessage.message || "Round updated");
}

function isBluff(lastMove) {
  if (!lastMove || !lastMove.claimedRank || !Array.isArray(lastMove.actualCards)) return false;
  return lastMove.actualCards.some((card) => getCardRank(card) !== lastMove.claimedRank);
}

function pickUpPile(hand, pile) {
  return [...(hand || []), ...(pile || [])];
}

function checkWinner(playerHand) {
  return Array.isArray(playerHand) && playerHand.length === 0;
}

function getNextPlayerIndex(turnOrder, currentIndex) {
  if (!turnOrder || turnOrder.length === 0) return 0;
  return (Number(currentIndex || 0) + 1) % turnOrder.length;
}

async function leaveRoom() {
  if (!currentRoomCode || !ensureReady()) {
    navigate("home");
    return;
  }

  const code = currentRoomCode;
  setBusy(true);

  try {
    await db.ref(`rooms/${code}`).transaction((room) => {
      if (!room) return room;
      const uid = currentUser.uid;
      room.players = room.players || {};
      room.hands = room.hands || {};

      if (room.status === "waiting") {
        delete room.players[uid];
        delete room.hands[uid];
        const remainingIds = Object.keys(room.players);

        if (remainingIds.length === 0) return null;

        if (room.hostId === uid) {
          const newHostId = remainingIds[0];
          room.hostId = newHostId;
          remainingIds.forEach((id) => {
            room.players[id].isHost = id === newHostId;
          });
        }
        return room;
      }

      if (room.status === "playing") {
        const oldOrder = room.turnOrder || [];
        const oldIndex = Number(room.currentTurnIndex || 0);
        const removedIndex = oldOrder.indexOf(uid);
        const newOrder = oldOrder.filter((id) => id !== uid);

        delete room.players[uid];
        delete room.hands[uid];

        if (room.lastMove?.playerId === uid) {
          room.lastMove = null;
        }

        if (newOrder.length <= 1) {
          const winnerId = newOrder[0];
          room.status = "finished";
          room.winner = winnerId ? {
            uid: winnerId,
            name: room.players?.[winnerId]?.name || "Player"
          } : null;
          room.finishedAt = Date.now();
          return room;
        }

        room.turnOrder = newOrder;
        if (removedIndex < oldIndex) room.currentTurnIndex = Math.max(0, oldIndex - 1);
        else if (removedIndex === oldIndex) room.currentTurnIndex = oldIndex % newOrder.length;
        else room.currentTurnIndex = oldIndex % newOrder.length;
        return room;
      }

      return room;
    });
  } catch (error) {
    showToast(error.message || "Could not leave room");
  } finally {
    clearRoomLocalState();
    setBusy(false);
    navigate("home", false);
  }
}

function clearRoomLocalState() {
  unsubscribeRoom();
  clearTimeout(dealAnimationTimer);
  dealAnimationRoomCode = "";
  currentRoomCode = "";
  currentRoom = null;
  selectedCards = [];
  localStorage.removeItem("bluffCurrentRoom");
}

function copyRoomCode() {
  if (!currentRoomCode) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(currentRoomCode)
      .then(() => showToast("Room code copied"))
      .catch(() => fallbackCopy(currentRoomCode));
  } else {
    fallbackCopy(currentRoomCode);
  }
}

function fallbackCopy(text) {
  const input = document.createElement("input");
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  showToast("Room code copied");
}

function selectCard(card) {
  if (!card) return;
  const index = selectedCards.indexOf(card);
  if (index >= 0) selectedCards.splice(index, 1);
  else selectedCards.push(card);
  renderCurrentScreen();
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[randomIndex]] = [copy[randomIndex], copy[i]];
  }
  return copy;
}

function dealCards(deck, playerIds) {
  const hands = {};
  playerIds.forEach((uid) => {
    hands[uid] = [];
  });

  deck.forEach((card, index) => {
    const uid = playerIds[index % playerIds.length];
    hands[uid].push(card);
  });

  Object.keys(hands).forEach((uid) => {
    hands[uid] = sortHand(hands[uid]);
  });

  return hands;
}

function getSortedPlayers(room) {
  return Object.entries(room.players || {})
    .map(([uid, player]) => ({ uid, player }))
    .sort((a, b) => (a.player.joinedAt || 0) - (b.player.joinedAt || 0));
}

function getCardRank(card) {
  return String(card).slice(0, -1);
}

function getCardSuit(card) {
  return String(card).slice(-1);
}

function getRankName(rank, count = 1) {
  const names = RANK_NAMES[rank];
  if (names) return count === 1 ? names[0] : names[1];
  return count === 1 ? rank : `${rank}s`;
}

function removeCardsFromHand(hand, cardsToRemove) {
  const remaining = [...hand];
  cardsToRemove.forEach((card) => {
    const index = remaining.indexOf(card);
    if (index >= 0) remaining.splice(index, 1);
  });
  return remaining;
}

function sortHand(cards) {
  const counts = {};
  (cards || []).forEach((card) => {
    const rank = getCardRank(card);
    counts[rank] = (counts[rank] || 0) + 1;
  });

  return [...(cards || [])].sort((a, b) => {
    const rankA = getCardRank(a);
    const rankB = getCardRank(b);
    const countDiff = (counts[rankB] || 0) - (counts[rankA] || 0);
    if (countDiff !== 0) return countDiff;
    const rankDiff = RANKS.indexOf(rankA) - RANKS.indexOf(rankB);
    if (rankDiff !== 0) return rankDiff;
    return (SUIT_ORDER[getCardSuit(a)] ?? 9) - (SUIT_ORDER[getCardSuit(b)] ?? 9);
  });
}

function groupCardsByRank(cards) {
  const groups = [];
  sortHand(cards).forEach((card) => {
    const rank = getCardRank(card);
    let group = groups.find((item) => item.rank === rank);
    if (!group) {
      group = { rank, cards: [] };
      groups.push(group);
    }
    group.cards.push(card);
  });
  return groups;
}

function showModal(title, bodyHTML, actionsHTML = "") {
  modalRoot.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <h2 id="modalTitle">${escapeHTML(title)}</h2>
      <div>${bodyHTML}</div>
      <div class="modal-actions">${actionsHTML || `<button class="btn" data-action="close-modal">OK</button>`}</div>
    </div>
  `;
  modalRoot.classList.add("open");
  modalRoot.setAttribute("aria-hidden", "false");
}

function closeModal(clear = true) {
  modalRoot.classList.remove("open");
  modalRoot.setAttribute("aria-hidden", "true");
  if (clear) modalRoot.innerHTML = "";
}

function formatDatabaseError(error, fallback) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "");
  if (code.includes("permission_denied") || message.toLowerCase().includes("permission")) {
    return "Firebase rules blocked this action";
  }
  if (message.toLowerCase().includes("network")) {
    return "Network issue. Try again";
  }
  return message || fallback;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function setBusy(value) {
  isBusy = value;
  document.querySelectorAll("button").forEach((button) => {
    if (value) button.dataset.wasDisabled = button.disabled ? "1" : "0";
    if (value) button.disabled = true;
    if (!value && button.dataset.wasDisabled === "0") button.disabled = false;
    if (!value) delete button.dataset.wasDisabled;
  });
}

function ensureReady() {
  if (!currentUser || !db) {
    showToast("Please login first");
    navigate("auth");
    return false;
  }
  if (!playerName) {
    navigate("name");
    return false;
  }
  return true;
}

function confirmLeaveGame() {
  showModal("Leave room?", `
    <p>If you leave during a game, you will be removed from this table. Continue?</p>
  `, `
    <button class="btn secondary" data-action="close-modal">Stay</button>
    <button class="btn danger" data-action="leave-room">Leave Room</button>
  `);
}

function renderWinner(room) {
  const winner = room.winner;
  const isMe = winner?.uid === currentUser?.uid;
  appEl.innerHTML = `
    <section class="screen center-screen">
      <div class="brand-card">
        <div class="logo-mark">🏆</div>
        <span class="badge">Game Finished</span>
        <h1>${isMe ? "You Won" : `${escapeHTML(winner?.name || "Player")} Won`}</h1>
        <p>${isMe ? "You finished all your cards first." : "The winner finished all cards first."}</p>
        <div class="btn-row">
          <button class="btn secondary" data-action="back-home-clear">Back to Home</button>
          <button class="btn" data-action="new-room">New Room</button>
        </div>
      </div>
    </section>
  `;
}

function getInitial(name) {
  return String(name || "P").trim().charAt(0).toUpperCase() || "P";
}

function shortName(name) {
  const value = String(name || "Player");
  return value.length > 13 ? `${value.slice(0, 12)}…` : value;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Event delegation keeps dynamic screens simple.
document.addEventListener("submit", (event) => {
  event.preventDefault();

  if (event.target.id === "signupForm") {
    signUpWithEmail(
      document.getElementById("signupUsername")?.value,
      document.getElementById("signupEmail")?.value,
      document.getElementById("signupPassword")?.value
    );
  }

  if (event.target.id === "loginForm") {
    loginWithEmail(
      document.getElementById("loginEmail")?.value,
      document.getElementById("loginPassword")?.value
    );
  }

  if (event.target.id === "nameForm") {
    const input = document.getElementById("nameInput");
    const value = String(input.value || "").trim().slice(0, 18);
    if (!value) {
      showToast("Enter your username");
      return;
    }
    saveUserProfile(value)
      .then(() => {
        showToast("Username saved");
        navigate("home");
      })
      .catch((error) => showToast(error.message || "Could not save username"));
  }

  if (event.target.id === "joinForm") {
    const input = document.getElementById("roomCodeInput");
    joinRoom(input.value);
  }
});

document.addEventListener("click", (event) => {
  const cardEl = event.target.closest("[data-card]");
  if (cardEl) {
    selectCard(cardEl.dataset.card);
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (!actionEl || actionEl.disabled) return;

  const action = actionEl.dataset.action;

  if (action === "show-login") {
    authMode = "login";
    navigate("auth", false);
  }
  if (action === "show-signup") {
    authMode = "signup";
    navigate("auth", false);
  }
  if (action === "logout") logout();
  if (action === "reset-password") resetPasswordPrompt();
  if (action === "send-reset-email") sendPasswordReset();
  if (action === "create-room") createRoom();
  if (action === "open-join") navigate("join");
  if (action === "how-to-play") navigate("how");
  if (action === "back-home") navigate("home");
  if (action === "change-name") navigate("name");
  if (action === "copy-room-code") copyRoomCode();
  if (action === "start-game") startGame();
  if (action === "leave-room") leaveRoom();
  if (action === "confirm-leave-game") confirmLeaveGame();
  if (action === "call-bluff") callBluff();
  if (action === "pass-turn") passTurn();
  if (action === "open-claim") openClaimPopup();
  if (action === "clear-selection") {
    selectedCards = [];
    renderCurrentScreen();
  }
  if (action === "close-modal") closeModal();
  if (action === "confirm-play") {
    const select = document.getElementById("claimRank");
    playSelectedCards(select?.value || "A");
  }
  if (action === "back-home-clear") {
    clearRoomLocalState();
    navigate("home", false);
  }
  if (action === "new-room") {
    clearRoomLocalState();
    createRoom();
  }
});

window.addEventListener("popstate", () => {
  if (currentRoomCode && currentRoom?.status === "playing") {
    window.history.pushState({ bluff: true, screen: currentScreen }, "", `#${currentScreen}`);
    confirmLeaveGame();
    return;
  }

  if (currentRoomCode && currentRoom?.status === "waiting") {
    leaveRoom();
    return;
  }

  if (currentUser && currentScreen !== "home" && playerName) {
    navigate("home", false);
  } else if (!currentUser && currentScreen !== "auth") {
    navigate("auth", false);
  }
});

window.addEventListener("beforeunload", () => {
  if (currentRoomCode && currentUser && db) {
    db.ref(`rooms/${currentRoomCode}/players/${currentUser.uid}/online`).set(false).catch(() => {});
  }
});

// Expose core functions for quick console testing if needed.
window.BluffGame = {
  signUpWithEmail,
  loginWithEmail,
  logout,
  saveUserProfile,
  createDeck,
  shuffleDeck,
  dealCards,
  generateRoomCode,
  createRoom,
  joinRoom,
  startGame,
  renderHome,
  renderWaitingRoom,
  renderGame,
  renderCards,
  selectCard,
  openClaimPopup,
  playSelectedCards,
  getNextPlayerIndex,
  callBluff,
  passTurn,
  isBluff,
  pickUpPile,
  checkWinner,
  leaveRoom,
  copyRoomCode,
  showToast,
  showModal,
  closeModal,
  sortHand
};
