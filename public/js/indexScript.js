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
    // Suppress Firebase emulator warnings
    const originalWarn = console.warn;
    console.warn = function(...args) {
        if (args[0] && args[0].includes && args[0].includes('emulator')) {
            return; // Suppress emulator warnings
        }
        return originalWarn.apply(console, args);
    };
    
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

        // Enable buttons and hide sign-in button when authenticated
        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;
        if (signInButton) {
            // Restore original sign-in button state before hiding it
            signInButton.disabled = false;
            signInButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" fill="currentColor" viewBox="0 0 24 24" style="display: inline-block; vertical-align: text-bottom;">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <span style="display: inline-block; vertical-align: text-bottom;">Sign In with Google</span>
            `;
            signInButton.style.opacity = '';
            signInButton.style.cursor = '';
            signInButton.style.display = 'none';
        }
        if (logoutButton) logoutButton.classList.remove('hidden');
    } else {
        currentUser = null;

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
function signIn(button = null) {
    // Store original button state if button is provided
    let originalText, originalDisabled;
    if (button) {
        originalText = button.innerHTML;
        originalDisabled = button.disabled;
        
        // Set loading state
        button.disabled = true;
        button.innerHTML = `
            <svg class="animate-spin h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span style="display: inline-block; vertical-align: text-bottom;">Signing In...</span>
        `;
        button.style.opacity = '0.8';
        button.style.cursor = 'not-allowed';
    }
    
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            // User signed in successfully - auth state change will handle UI updates
        })
        .catch((error) => {
            console.error("Sign in error:", error);
            
            // Show user-friendly error message
            let errorMessage = "Failed to sign in. Please try again.";
            if (error.code === 'auth/popup-closed-by-user') {
                errorMessage = "Sign-in was cancelled. Please try again.";
            } else if (error.code === 'auth/popup-blocked') {
                errorMessage = "Sign-in popup was blocked. Please allow popups and try again.";
            }
            showErrorMessage({ message: errorMessage });
            
            // Restore original button state on error
            if (button) {
                button.disabled = originalDisabled;
                button.innerHTML = originalText;
                button.style.opacity = '';
                button.style.cursor = '';
            }
        });
}

// Function to sign out
function signOut(button = null) {
    // Store original button state if button is provided
    let originalText, originalDisabled;
    if (button) {
        originalText = button.innerHTML;
        originalDisabled = button.disabled;
        
        // Set loading state
        button.disabled = true;
        button.innerHTML = `
            <svg class="animate-spin h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span style="display: inline-block; vertical-align: text-bottom;">Signing Out...</span>
        `;
        button.style.opacity = '0.8';
        button.style.cursor = 'not-allowed';
    }
    
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
        
        // Store original button state
        const originalText = createLobbyBtn.textContent;
        const originalDisabled = createLobbyBtn.disabled;
        
        try {
            // Set loading state
            createLobbyBtn.disabled = true;
            createLobbyBtn.textContent = 'Creating Lobby...';
            createLobbyBtn.style.opacity = '0.6';
            createLobbyBtn.style.cursor = 'not-allowed';
            
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
            
            const result = await createLobby(playerClass.toFirestoreObject());
            const lobbyCode = result.data.lobbyCode;
            window.location.href = 'lobby.html?lobbyId=' + lobbyCode;
        } catch (error) {
            console.error('Error creating lobby:', error);
            showErrorMessage(error);
            
            // Restore original button state on error
            createLobbyBtn.disabled = originalDisabled;
            createLobbyBtn.textContent = originalText;
            createLobbyBtn.style.opacity = '';
            createLobbyBtn.style.cursor = '';
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
        
        // Store original button state
        const originalText = joinLobbyBtn.textContent;
        const originalDisabled = joinLobbyBtn.disabled;
        
        try {
            // Set loading state
            joinLobbyBtn.disabled = true;
            joinLobbyBtn.textContent = 'Joining Lobby...';
            joinLobbyBtn.style.opacity = '0.6';
            joinLobbyBtn.style.cursor = 'not-allowed';
            
            // Cleanup old lobbies in the background (non-blocking)
            performLobbyCleanup();
            
            const playerName = joinLobbyUserName.value || "Player"
            const lobbyCode = lobbyCodeInput.value;
            
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
            
            // Restore original button state on error
            joinLobbyBtn.disabled = originalDisabled;
            joinLobbyBtn.textContent = originalText;
            joinLobbyBtn.style.opacity = '';
            joinLobbyBtn.style.cursor = '';
        }
    });
} 

// Event listener for the Sign In button *inside* this listener
if (signInButton) {
    signInButton.addEventListener('click', () => signIn(signInButton));
}

// Event listener for the Logout button *inside* this listener
if (logoutButton) {
    logoutButton.addEventListener('click', () => signOut(logoutButton));
}

// Initial state: buttons are enabled but will show warning if not authenticated
if (createLobbyBtn) createLobbyBtn.disabled = false;
if (joinLobbyBtn) joinLobbyBtn.disabled = false;

});
