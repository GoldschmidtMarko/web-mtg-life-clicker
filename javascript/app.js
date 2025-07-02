// app.js

// Constants for Firebase configuration (provided by the environment)
const firebaseConfig = typeof __firebase_config !== 'undefined'
    ? JSON.parse(__firebase_config)
    : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

let currentUserId = null;
let currentLobbyCode = '';
let lobbyPlayers = {};
let remotePlayerInputName = '';
let unsubscribeLobbyListener = null; // To store the Firestore unsubscribe function

// --- DOM Element References ---
const homeView = document.getElementById('home-view');
const hostView = document.getElementById('host-view');
const remoteView = document.getElementById('remote-view');

const createLobbyBtn = document.getElementById('create-lobby-btn');
const remotePlayerNameInput = document.getElementById('remote-player-name-input');
const lobbyCodeInput = document.getElementById('lobby-code-input');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const userIdDisplay = document.getElementById('user-id-display');
const userIdValue = document.getElementById('user-id-value');

const hostLobbyCode = document.getElementById('host-lobby-code');
const playersList = document.getElementById('players-list');
const noPlayersMessage = document.getElementById('no-players-message');
const closeLobbyBtn = document.getElementById('close-lobby-btn');

const remoteLobbyCodeDisplay = document.getElementById('remote-lobby-code');
const remotePlayerNameDisplay = document.getElementById('remote-player-name-display');
const decreaseLpBtn = document.getElementById('decrease-lp-btn');
const currentLpDisplay = document.getElementById('current-lp-display');
const increaseLpBtn = document.getElementById('increase-lp-btn');
const leaveLobbyBtn = document.getElementById('leave-lobby-btn');

const messageBoxOverlay = document.getElementById('message-box-overlay');
const messageBoxText = document.getElementById('message-box-text');
const messageBoxOkBtn = document.getElementById('message-box-ok-btn');

// --- Helper Functions ---

// Function to display custom message box
function showMessageBox(message) {
    messageBoxText.textContent = message;
    messageBoxOverlay.classList.remove('hidden');
}

// Function to hide custom message box
messageBoxOkBtn.addEventListener('click', () => {
    messageBoxOverlay.classList.add('hidden');
});

// Function to switch between views
function showView(viewId) {
    homeView.classList.add('hidden');
    hostView.classList.add('hidden');
    remoteView.classList.add('hidden');

    document.getElementById(viewId).classList.remove('hidden');

    // Hide user ID display on other views, show on home
    if (viewId === 'home-view' && currentUserId) {
        userIdDisplay.classList.remove('hidden');
        userIdValue.textContent = currentUserId;
    } else {
        userIdDisplay.classList.add('hidden');
    }
}

// Function to generate a random 6-character alphanumeric lobby code
function generateLobbyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Function to render players in the host view
function renderPlayers() {
    playersList.innerHTML = ''; // Clear existing players

    const playerEntries = Object.entries(lobbyPlayers);

    if (playerEntries.length === 0) {
        noPlayersMessage.classList.remove('hidden');
        playersList.appendChild(noPlayersMessage);
    } else {
        noPlayersMessage.classList.add('hidden');
        playerEntries.forEach(([id, data]) => {
            const playerCard = document.createElement('div');
            playerCard.className = "bg-gray-100 p-6 rounded-xl shadow-md flex items-center justify-between transition-all duration-200 hover:shadow-lg hover:scale-[1.02] border border-gray-200";
            playerCard.innerHTML = `
                <div>
                    <p class="text-xl font-bold text-gray-800">${data.name || `Player ${id.substring(0, 5)}`}</p>
                    <p class="text-sm text-gray-500 break-all mt-1">ID: ${id}</p>
                </div>
                <div class="text-5xl font-extrabold text-teal-600">
                    ${data.lp !== undefined ? data.lp : 'N/A'}
                </div>
            `;
            playersList.appendChild(playerCard);
        });
    }
}

// --- Firebase Authentication Listener ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        currentUserId = user.uid;
        userIdValue.textContent = currentUserId;
        userIdDisplay.classList.remove('hidden');
        console.log('User signed in:', currentUserId);
        showView('home-view'); // Ensure home view is shown after auth
    } else {
        console.log('No user signed in, attempting anonymous sign-in...');
        try {
            if (typeof __initial_auth_token !== 'undefined') {
                await auth.signInWithCustomToken(__initial_auth_token);
                console.log('Signed in with custom token.');
            } else {
                await auth.signInAnonymously();
                console.log('Signed in anonymously.');
            }
        } catch (error) {
            console.error('Error during anonymous sign-in:', error);
            showMessageBox('Failed to authenticate. Please refresh the page.');
        }
    }
});

// --- Lobby Creation Functionality ---
createLobbyBtn.addEventListener('click', async () => {
    if (!currentUserId) {
        showMessageBox("Authentication not ready. Please wait a moment.");
        return;
    }

    const newCode = generateLobbyCode();
    currentLobbyCode = newCode;
    const lobbyRef = db.collection(`artifacts/${appId}/public/data/lobbies`).doc(newCode);

    try {
        await lobbyRef.set({
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            players: {}, // Initialize with no players
        });
        console.log("Lobby created with code:", newCode);
        hostLobbyCode.textContent = newCode;
        showView('host-view');
        listenToLobbyUpdates(newCode); // Start listening to updates
    } catch (e) {
        console.error("Error creating lobby:", e);
        showMessageBox("Failed to create lobby. Please try again.");
    }
});

// --- Lobby Joining Functionality ---
joinLobbyBtn.addEventListener('click', async () => {
    remotePlayerInputName = remotePlayerNameInput.value.trim();
    const codeToJoin = lobbyCodeInput.value.trim().toUpperCase();

    if (!currentUserId) {
        showMessageBox("Authentication not ready. Please wait a moment.");
        return;
    }
    if (!remotePlayerInputName) {
        showMessageBox("Please enter your player name.");
        return;
    }
    if (!codeToJoin) {
        showMessageBox("Please enter a lobby code.");
        return;
    }

    currentLobbyCode = codeToJoin;
    const lobbyRef = db.collection(`artifacts/${appId}/public/data/lobbies`).doc(codeToJoin);

    try {
        const docSnap = await lobbyRef.get();

        if (docSnap.exists) {
            // Add the current user to the lobby if not already present
            const currentPlayersData = docSnap.data().players || {};
            if (!currentPlayersData[currentUserId]) {
                currentPlayersData[currentUserId] = { name: remotePlayerInputName, lp: 20 }; // Default life points
                await lobbyRef.update({ players: currentPlayersData });
            }
            remoteLobbyCodeDisplay.textContent = codeToJoin;
            remotePlayerNameDisplay.textContent = `You are: ${remotePlayerInputName}`; // Update local display immediately
            showView('remote-view');
            listenToLobbyUpdates(codeToJoin); // Start listening to updates
            console.log("Joined lobby:", codeToJoin);
        } else {
            showMessageBox("Lobby not found. Please check the code.");
            console.log("No such lobby document!");
        }
    } catch (e) {
        console.error("Error joining lobby:", e);
        showMessageBox("Failed to join lobby. Please try again.");
    }
});

// --- Firestore Listener for Lobby Updates ---
function listenToLobbyUpdates(lobbyCode) {
    if (unsubscribeLobbyListener) {
        unsubscribeLobbyListener(); // Detach previous listener if any
    }

    const lobbyRef = db.collection(`artifacts/${appId}/public/data/lobbies`).doc(lobbyCode);

    unsubscribeLobbyListener = lobbyRef.onSnapshot((docSnap) => {
        if (docSnap.exists) {
            lobbyPlayers = docSnap.data().players || {};
            // Update UI based on the current view
            if (document.getElementById('host-view').classList.contains('hidden') === false) { // If host view is active
                renderPlayers();
            } else if (document.getElementById('remote-view').classList.contains('hidden') === false) { // If remote view is active
                // Update current player's LP display
                if (lobbyPlayers[currentUserId]) {
                    currentLpDisplay.textContent = lobbyPlayers[currentUserId].lp;
                    remotePlayerNameDisplay.textContent = `You are: ${lobbyPlayers[currentUserId].name || `Player ${currentUserId.substring(0, 5)}`}`;
                } else {
                    // Player might have been removed from the lobby
                    showMessageBox("You have been removed from the lobby or the lobby was closed.");
                    leaveLobby(); // Go back to home
                }
            }
        } else {
            // Lobby no longer exists, reset state
            console.log("Lobby no longer exists.");
            currentLobbyCode = '';
            lobbyPlayers = {};
            showMessageBox("The lobby you were in has been closed.");
            showView('home-view');
            remotePlayerNameInput.value = '';
            lobbyCodeInput.value = '';
        }
    }, (error) => {
        console.error("Error listening to lobby updates:", error);
        showMessageBox("Lost connection to lobby. Please try again.");
    });
}

// --- Life Point Update Functionality ---
function updateLifePoints(delta) {
    if (!currentUserId || !currentLobbyCode) {
        console.log("Not connected to a lobby or no user ID.");
        return;
    }

    const lobbyRef = db.collection(`artifacts/${appId}/public/data/lobbies`).doc(currentLobbyCode);
    const currentLp = lobbyPlayers[currentUserId] ? (lobbyPlayers[currentUserId].lp || 0) : 0;
    const newLp = currentLp + delta;

    // Use a transaction to safely update nested field
    db.runTransaction(async (transaction) => {
        const sfDoc = await transaction.get(lobbyRef);
        if (!sfDoc.exists) {
            throw "Lobby does not exist!";
        }

        const playersData = sfDoc.data().players || {};
        if (playersData[currentUserId]) {
            playersData[currentUserId].lp = newLp;
            transaction.update(lobbyRef, { players: playersData });
        }
    }).catch((error) => {
        console.error("Transaction failed: ", error);
        showMessageBox("Failed to update life points. Please try again.");
    });
}

// Attach event listeners for life point buttons
decreaseLpBtn.addEventListener('click', () => updateLifePoints(-1));
increaseLpBtn.addEventListener('click', () => updateLifePoints(1));

// --- Leave Lobby Functionality ---
function leaveLobby() {
    if (unsubscribeLobbyListener) {
        unsubscribeLobbyListener(); // Detach listener
        unsubscribeLobbyListener = null;
    }
    currentLobbyCode = '';
    lobbyPlayers = {};
    remotePlayerInputName = '';
    remotePlayerNameInput.value = '';
    lobbyCodeInput.value = '';
    showView('home-view');
}

closeLobbyBtn.addEventListener('click', leaveLobby);
leaveLobbyBtn.addEventListener('click', leaveLobby);


// Initialize view on page load
document.addEventListener('DOMContentLoaded', () => {
    showView('home-view');
});
