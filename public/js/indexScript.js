import { Player } from './util/models.js';
import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Auth, Functions, and Firestore
const auth = firebase.auth();
const functions = firebase.app().functions('europe-west4');
const firestore = firebase.firestore();

// Connect to emulators when running locally
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    functions.useEmulator('localhost', 5001);
    auth.useEmulator('http://localhost:9099');
    firestore.useEmulator('localhost', 8080);
}

// Initialize Firebase Functions
const createLobby = functions.httpsCallable('createLobby');
const joinLobby = functions.httpsCallable('joinLobby');

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
// Get references to HTML elements *inside* this listener
const createLobbyBtn = document.getElementById('create-lobby-btn');
const lobbyCodeInput = document.getElementById('lobby-code-input');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const userIdDisplay = document.getElementById('user-id-display');
const userIdValue = document.getElementById('user-id-value');
const signInButton = document.getElementById('sign-in-button');
const joinLobbyUserName = document.getElementById('remote-player-name-input');

let currentUser = null;

// Listen for authentication state changes *inside* this listener
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;

        if (userIdValue) userIdValue.textContent = currentUser.uid;
        if (userIdDisplay) userIdDisplay.classList.remove('hidden');

        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (signInButton) signInButton.style.display = 'none';
    } else {
        currentUser = null;

        if (userIdDisplay) userIdDisplay.classList.add('hidden');

        if (createLobbyBtn) createLobbyBtn.disabled = true;
        if (joinLobbyBtn) joinLobbyBtn.disabled = true;
        if (signInButton) signInButton.style.display = 'block';
    }
});

// Function to sign in with Google (can be defined inside or outside DOMContentLoaded)
function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            // User signed in successfully
        })
        .catch((error) => {
            console.error("Sign in error:", error);
            alert("Failed to sign in. See console for details.");
        });
}

// Event listener for Create New Lobby button *inside* this listener
if (createLobbyBtn) {
    createLobbyBtn.addEventListener('click', async () => {
        const playerName = currentUser.displayName.split(" ")[0] || "Player"
        const playerClass = new Player(
            currentUser.uid,
            playerName,
            40,
            0,
            0,
            0,
            "#FFFFFF",
            "#000000"
        )
        try {
            const result = await createLobby({ hostPlayer: playerClass.toFirestoreObject() });
            const lobbyCode = result.data.lobbyCode;
            window.location.href = 'public/lobby.html?lobbyId=' + lobbyCode;
        } catch (error) {
            console.error('Error creating lobby:', error);
        }
    });
}


// Event listener for Join Lobby button *inside* this listener
if (joinLobbyBtn) {
    joinLobbyBtn.addEventListener('click', async () => {
        const playerName = joinLobbyUserName.value || "Player"
        const lobbyCode = lobbyCodeInput.value;
        try {
            const player = new Player(
                currentUser.uid,
                playerName,
                40,
                0,
                0,
                0,
                "#FFFFFF",
                "#000000"
            );
            await joinLobby(player, lobbyCode);
            // Redirect to the lobby page, passing the lobby code
            window.location.href = `/lobby.html?lobbyId=${lobbyCode}`;

        } catch (error) {
            console.error('Error joining lobby:', error);
            alert('Failed to join lobby. Please try again.');
        }
    });
} 

// Event listener for the Sign In button *inside* this listener
if (signInButton) {
    signInButton.addEventListener('click', signIn);
}

// Initial state: disable buttons until user is authenticated *inside* this listener
if (createLobbyBtn) createLobbyBtn.disabled = true;
if (joinLobbyBtn) joinLobbyBtn.disabled = true;

});
