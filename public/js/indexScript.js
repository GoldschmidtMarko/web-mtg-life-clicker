import { firebaseConfig } from './firebaseConfig.js'; // Keep this import
import { createLobbyClientSide, joinLobbyClientSide } from './tempFunctions.js';
import { Player } from './models.js';

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const functions = firebase.functions();

// Connect to the Functions emulator if running locally
if (location.hostname === "localhost" || location.hostname === "5000-firebase-web-mtg-life-clicker-1750604024651.cluster-axf5tvtfjjfekvhwxwkkkzsk2y.cloudworkstations.dev") {
    functions.useEmulator("5001-firebase-web-mtg-life-clicker-1750604024651.cluster-axf5tvtfjjfekvhwxwkkkzsk2y.cloudworkstations.dev"); // Using external hostname and port 443
}

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
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        console.log("User signed in:", currentUser.uid);

        if (userIdValue) userIdValue.textContent = currentUser.uid;
        if (userIdDisplay) userIdDisplay.classList.remove('hidden');

        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (signInButton) signInButton.style.display = 'none';
    } else {
        currentUser = null;
        console.log("User signed out");

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
            console.log("Signed in user:", result.user.uid);
        })
        .catch((error) => {
            console.error("Sign in error:", error);
            alert("Failed to sign in. See console for details.");
        });
}

// Get callable functions (can be defined inside or outside DOMContentLoaded)
// TODO const createLobbyCallable = functions.httpsCallable('createLobby');
// TODO const joinLobbyCallable = functions.httpsCallable('joinLobby');


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
            "#FFFFFF",
            "#000000"
        )
        try {
            const result = await createLobbyClientSide(playerClass);
            const lobbyCode = result.lobbyCode;
            console.log('Lobby created with code:', lobbyCode);
            // Redirect to the lobby page, passing the lobby code
            window.location.href = `/lobby.html?lobbyId=${lobbyCode}`;
        } catch (error) {
            console.error('Error creating lobby:', error);
            alert('Failed to create lobby. Please try again.');
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
                "#FFFFFF",
                "#000000"
            );
            const result = await joinLobbyClientSide(
                player, lobbyCode
            );
            console.log('Joined lobby with code:', lobbyCode);
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
