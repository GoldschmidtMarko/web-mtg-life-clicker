import { Player } from './util/models.js';
import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Auth, Functions, and Firestore
const auth = firebase.auth();
const functions = firebase.app().functions('europe-west3');
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
const savePlayerData = functions.httpsCallable('savePlayerData');
const cleanupOldLobbies = functions.httpsCallable('cleanupOldLobbies');

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
// Get references to HTML elements *inside* this listener
const createLobbyBtn = document.getElementById('create-lobby-btn');
const lobbyCodeInput = document.getElementById('lobby-code-input');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const userIdDisplay = document.getElementById('user-id-display');
const userIdValue = document.getElementById('user-id-value');
const signInButton = document.getElementById('sign-in-button');
const logoutButton = document.getElementById('logout-button');
const joinLobbyUserName = document.getElementById('remote-player-name-input');

let currentUser = null;

// Function to save or update player data via backend function
async function callSavePlayerData(user) {
    try {
        const result = await savePlayerData();
    } catch (error) {
        console.error('Error saving player data:', error);
        // Don't show user-facing error for this background operation
        // The app will still function normally
    }
}

// Function to cleanup old lobbies in the background
async function performLobbyCleanup() {
    try {
        const result = await cleanupOldLobbies();
        const data = result.data;
        
        if (data.deleted > 0) {
            console.log(`Cleanup completed: ${data.deleted} old lobbies removed`);
        }
    } catch (error) {
        // Silently handle cleanup errors - don't disrupt user experience
        console.log('Background lobby cleanup skipped:', error.code || error.message);
    }
}

// Listen for authentication state changes *inside* this listener
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;

        // Save player data to Firestore via backend function
        await callSavePlayerData(user);

        if (userIdValue) userIdValue.textContent = currentUser.uid;
        if (userIdDisplay) userIdDisplay.classList.remove('hidden');

        // Enable buttons and hide sign-in button when authenticated
        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (signInButton) signInButton.style.display = 'none';
        if (logoutButton) logoutButton.classList.remove('hidden');
    } else {
        currentUser = null;

        if (userIdDisplay) userIdDisplay.classList.add('hidden');

        // Keep buttons enabled but they will show warning popup
        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (signInButton) signInButton.style.display = 'block';
        if (logoutButton) logoutButton.classList.add('hidden');
    }
});

// Function to display user-friendly error messages
function showErrorMessage(error) {
    let message = 'An unexpected error occurred. Please try again.';
    
    if (error.code) {
        // Firebase callable function error
        switch (error.code) {
            case 'functions/resource-exhausted':
                message = error.message || 'Rate limit exceeded. Please slow down.';
                break;
            case 'functions/invalid-argument':
                message = error.message || 'Invalid input provided.';
                break;
            case 'functions/unauthenticated':
                message = 'Please sign in to continue.';
                break;
            case 'functions/internal':
                message = 'Server error. Please try again later.';
                break;
            default:
                message = error.message || message;
        }
    } else if (error.message) {
        message = error.message;
    }
    
    // Create or update error display
    let errorDiv = document.getElementById('error-message');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'error-message';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #ff4444;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            z-index: 10000;
            font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            max-width: 80%;
            text-align: center;
        `;
        document.body.appendChild(errorDiv);
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Hide error after 5 seconds
    setTimeout(() => {
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    }, 5000);
}

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

// Function to sign out
function signOut() {
    // Clear any pending Firestore operations before signing out
    try {
        auth.signOut()
            .then(() => {
                console.log("User signed out successfully");
                // Force reload to clear any cached connections
                window.location.reload();
            })
            .catch((error) => {
                console.error("Sign out error:", error);
                // Still reload even if there's an error
                window.location.reload();
            });
    } catch (error) {
        console.error("Sign out error:", error);
        // Force reload as fallback
        window.location.reload();
    }
}

// Function to show sign-in warning popup
function showSignInWarning() {
    alert("⚠️ Please sign in with Google first to create or join a lobby!");
}

// Event listener for Create New Lobby button *inside* this listener
if (createLobbyBtn) {
    createLobbyBtn.addEventListener('click', async () => {
        // Check if user is signed in
        if (!currentUser) {
            showSignInWarning();
            return;
        }
        
        // Cleanup old lobbies in the background (non-blocking)
        performLobbyCleanup();
        
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
            const result = await createLobby(playerClass.toFirestoreObject());
            const lobbyCode = result.data.lobbyCode;
            window.location.href = 'lobby.html?lobbyId=' + lobbyCode;
        } catch (error) {
            console.error('Error creating lobby:', error);
            showErrorMessage(error);
        }
    });
}


// Event listener for Join Lobby button *inside* this listener
if (joinLobbyBtn) {
    joinLobbyBtn.addEventListener('click', async () => {
        // Check if user is signed in
        if (!currentUser) {
            showSignInWarning();
            return;
        }
        
        // Cleanup old lobbies in the background (non-blocking)
        performLobbyCleanup();
        
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
            await joinLobby({player: player.toFirestoreObject(), lobbyCode});
            // Redirect to the lobby page, passing the lobby code
            window.location.href = `/lobby.html?lobbyId=${lobbyCode}`;

        } catch (error) {
            console.error('Error joining lobby:', error);
            showErrorMessage(error);
        }
    });
} 

// Event listener for the Sign In button *inside* this listener
if (signInButton) {
    signInButton.addEventListener('click', signIn);
}

// Event listener for the Logout button *inside* this listener
if (logoutButton) {
    logoutButton.addEventListener('click', signOut);
}

// Initial state: buttons are enabled but will show warning if not authenticated
if (createLobbyBtn) createLobbyBtn.disabled = false;
if (joinLobbyBtn) joinLobbyBtn.disabled = false;

});
