import { Player } from './util/models.js';
import { firebaseConfig } from './util/firebaseConfig.js';
import { showUsageExamplePopup } from './infoPopup.js';

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
const getUserLobbies = functions.httpsCallable('getUserLobbies');
const savePlayerData = functions.httpsCallable('savePlayerData');
const cleanupOldLobbies = functions.httpsCallable('cleanupOldLobbies');

// Admin-only shortcut to the usage dashboard. Visibility is a client-side
// convenience only — getUsageStats enforces the admin allow-list server-side.
// On localhost any signed-in account may see it (mirrors the emulator bypass);
// in production only the admin email does.
const USAGE_ADMIN_EMAILS = ['mgoldschmidt01@gmail.com', 'ma.goldschmidt@web.de'];
const USAGE_IS_DEV_HOST = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
function updateUsageLink(user) {
    const link = document.getElementById('usage-link');
    const allowed = !!user && (USAGE_IS_DEV_HOST || USAGE_ADMIN_EMAILS.includes((user.email || '').toLowerCase()));
    if (link) link.classList.toggle('hidden', !allowed);
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
// Get references to HTML elements *inside* this listener
const createLobbyBtn = document.getElementById('create-lobby-btn');
const lobbyCodeInput = document.getElementById('lobby-code-input');
const joinLobbyBtn = document.getElementById('join-lobby-btn');
const signInButton = document.getElementById('sign-in-button');
const logoutButton = document.getElementById('logout-button');
const playerNameInput = document.getElementById('player-name-input');
const myLobbiesButton = document.getElementById('my-lobbies-button');
const myLobbiesButtonLabel = document.getElementById('my-lobbies-button-label');
const myLobbiesSpinner = document.getElementById('my-lobbies-spinner');
const myLobbiesModal = document.getElementById('my-lobbies-modal');
const myLobbiesList = document.getElementById('my-lobbies-list');
const closeMyLobbiesModalButton = document.getElementById('close-my-lobbies-modal');

let currentUser = null;

// Read by lobby.html right after a Create Lobby redirect to show a one-time
// "how long is this kept" toast. sessionStorage (not localStorage) so it
// only ever fires for the tab that just created the lobby, once.
const RULES_TOAST_STORAGE_KEY = 'mtg-life-clicker-show-rules-toast';

// The player-name field is shared by Create and Join. Remembered locally so
// an anonymous player (no Google profile to draw a name from) doesn't have
// to retype it every visit.
const PLAYER_NAME_STORAGE_KEY = 'mtg-life-clicker-player-name';
if (playerNameInput) {
    try {
        const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
        if (savedName) playerNameInput.value = savedName;
    } catch (error) {
        // Storage can be unavailable (private browsing, disabled). Non-fatal.
    }
    playerNameInput.addEventListener('input', () => {
        try {
            localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerNameInput.value.trim());
        } catch (error) {
            // Ignore - the field still works for this session.
        }
    });
}

// Resolves the name to use for a new player: whatever's typed, else the
// signed-in Google account's first name, else a generic fallback.
function resolvePlayerName() {
    const typed = playerNameInput ? playerNameInput.value.trim() : '';
    if (typed) return typed;
    if (currentUser && currentUser.displayName) return currentUser.displayName.split(' ')[0];
    return 'Player';
}

// Function to save or update player data via backend function. Only called
// for a real Google-linked account - an anonymous session has no profile
// worth persisting, and skipping it keeps the usage dashboard's user list
// meaningful.
async function callSavePlayerData(user) {
    try {
        const result = await savePlayerData();
        if (result.data && result.data.showPopup) {
            showUsageExamplePopup();
        }
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

// Function to join a lobby and redirect to it, shared by the manual join form
// and the "Your Lobbies" quick-join rows.
async function joinLobbyAndRedirect(lobbyCode, playerName) {
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
    await joinLobby({ player: player.toFirestoreObject(), lobbyCode });
    window.location.href = `/lobby.html?lobbyId=${lobbyCode}`;
}

// Turn an ISO timestamp into a short relative label like "5m ago"
function formatRelativeTime(isoString) {
    if (!isoString) return '';
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays}d ago`;
}

// Open/close the "Your Lobbies" popup
function openMyLobbiesModal() {
    if (!myLobbiesModal) return;
    myLobbiesModal.classList.remove('hidden');
    myLobbiesModal.classList.add('flex');
    document.body.classList.add('modal-open');
}

function closeMyLobbiesModal() {
    if (!myLobbiesModal) return;
    myLobbiesModal.classList.add('hidden');
    myLobbiesModal.classList.remove('flex');
    document.body.classList.remove('modal-open');
}

// Shows/hides the button's fetch spinner and toggles its clickability while loading.
function setMyLobbiesLoading(isLoading) {
    if (!myLobbiesButton || !myLobbiesSpinner) return;
    myLobbiesSpinner.classList.toggle('hidden', !isLoading);
    myLobbiesButton.disabled = isLoading;
}

// Render the list of lobbies the signed-in player created or joined
function renderMyLobbies(lobbies) {
    if (!myLobbiesButton || !myLobbiesList) return;

    myLobbiesList.innerHTML = '';

    if (myLobbiesButtonLabel) {
        myLobbiesButtonLabel.textContent = lobbies.length ? `Your Lobbies (${lobbies.length})` : 'Your Lobbies';
    }

    if (!lobbies.length) {
        const empty = document.createElement('p');
        empty.className = 'text-sm text-center';
        empty.style.color = 'var(--ink-faint)';
        empty.textContent = "You haven't created or joined any lobbies yet.";
        myLobbiesList.appendChild(empty);
        return;
    }

    lobbies.forEach((lobby) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'chip w-full flex items-center justify-between gap-3 px-4 py-3 text-left';
        row.innerHTML = `
            <span class="min-w-0">
                <span class="font-semibold block truncate lobby-row-code" style="color: var(--ink);"></span>
                <span class="text-xs block truncate lobby-row-meta" style="color: var(--ink-dim);"></span>
            </span>
            <svg class="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--ink-faint);">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
            </svg>
        `;

        const hostLabel = lobby.isOwner ? 'Hosted by you' : `Hosted by ${lobby.ownerName || 'a player'}`;
        const timeLabel = formatRelativeTime(lobby.lastUpdated);
        row.querySelector('.lobby-row-code').textContent = lobby.code;
        row.querySelector('.lobby-row-meta').textContent = timeLabel ? `${hostLabel} · updated ${timeLabel}` : hostLabel;

        row.addEventListener('click', async () => {
            if (!currentUser) {
                showSignInWarning();
                return;
            }
            row.disabled = true;
            row.querySelector('.lobby-row-code').textContent = 'Joining...';
            try {
                await joinLobbyAndRedirect(lobby.code, resolvePlayerName());
            } catch (error) {
                console.error('Error joining lobby:', error);
                showErrorMessage(error);
                loadMyLobbies();
            }
        });

        myLobbiesList.appendChild(row);
    });
}

// Fetch and render the lobbies the signed-in player created or joined.
// The button is shown (with a spinner) before this resolves, so the player
// always sees it right away instead of it popping in once data arrives.
async function loadMyLobbies() {
    if (!myLobbiesButton || !myLobbiesList) return;
    myLobbiesButton.classList.remove('hidden');
    setMyLobbiesLoading(true);
    try {
        const result = await getUserLobbies();
        renderMyLobbies(result.data.lobbies || []);
    } catch (error) {
        console.error('Error loading your lobbies:', error);
        if (myLobbiesButtonLabel) myLobbiesButtonLabel.textContent = 'Your Lobbies';
        myLobbiesList.innerHTML = '';
        const errEl = document.createElement('p');
        errEl.className = 'text-sm text-center';
        errEl.style.color = 'var(--ink-faint)';
        errEl.textContent = 'Failed to load your lobbies. Try again later.';
        myLobbiesList.appendChild(errEl);
    } finally {
        setMyLobbiesLoading(false);
    }
}

// Event listeners for the "Your Lobbies" button and popup
if (myLobbiesButton) {
    myLobbiesButton.addEventListener('click', openMyLobbiesModal);
}
if (closeMyLobbiesModalButton) {
    closeMyLobbiesModalButton.addEventListener('click', closeMyLobbiesModal);
}
if (myLobbiesModal) {
    myLobbiesModal.addEventListener('click', (event) => {
        if (event.target === myLobbiesModal) closeMyLobbiesModal();
    });
}
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && myLobbiesModal && !myLobbiesModal.classList.contains('hidden')) {
        closeMyLobbiesModal();
    }
});

// Listen for authentication state changes *inside* this listener
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        updateUsageLink(user);

        // A real Google account gets its profile persisted (name/email,
        // powers the usage dashboard's user list) and prefills the name
        // field. A bare anonymous session has neither.
        if (!user.isAnonymous) {
            await callSavePlayerData(user);
            if (playerNameInput && !playerNameInput.value.trim() && user.displayName) {
                playerNameInput.value = user.displayName.split(' ')[0];
            }
        }

        // Load the lobbies this player created or joined
        loadMyLobbies();

        // Every visitor (anonymous or not) can use the app immediately.
        if (createLobbyBtn) createLobbyBtn.disabled = false;
        if (joinLobbyBtn) joinLobbyBtn.disabled = false;

        // "Sign in with Google" is an upgrade offered only while anonymous;
        // once linked to a real account, show Logout instead.
        if (signInButton) {
            signInButton.disabled = false;
            signInButton.classList.toggle('hidden', !user.isAnonymous);
        }
        if (logoutButton) logoutButton.classList.toggle('hidden', user.isAnonymous);
    } else {
        currentUser = null;
        updateUsageLink(null);

        // No session at all yet (first visit, or a previous one expired) -
        // bootstrap one anonymously so the app works without requiring a
        // Google account. This handler fires again once it's ready.
        try {
            await firebase.auth().signInAnonymously();
        } catch (error) {
            console.error('Anonymous sign-in failed:', error);
            if (createLobbyBtn) createLobbyBtn.disabled = true;
            if (joinLobbyBtn) joinLobbyBtn.disabled = true;
            if (signInButton) signInButton.classList.remove('hidden');
            if (logoutButton) logoutButton.classList.add('hidden');
            if (myLobbiesButton) myLobbiesButton.classList.add('hidden');
            closeMyLobbiesModal();
        }
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
    }
    
    const provider = new firebase.auth.GoogleAuthProvider();
    // Linking (rather than a fresh sign-in) keeps the current anonymous uid -
    // and everything already created under it - once Google is attached.
    const current = auth.currentUser;
    const signInPromise = (current && current.isAnonymous)
        ? current.linkWithPopup(provider).catch((error) => {
            if (error.code === 'auth/credential-already-in-use') {
                // This Google account is already tied to a different
                // (older) uid - fall back to signing into that one instead.
                // Any lobbies created under the anonymous session stay put,
                // just no longer linked to this account.
                const credential = firebase.auth.GoogleAuthProvider.credentialFromError(error);
                return auth.signInWithCredential(credential);
            }
            throw error;
        })
        : auth.signInWithPopup(provider);

    signInPromise
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

// Shown only in the rare case the background anonymous sign-in hasn't
// finished (or failed) by the time a disabled button somehow still got
// clicked - not a "you must use Google" gate anymore.
function showSignInWarning() {
    alert("⚠️ Still connecting - please wait a moment and try again.");
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

            // Cleanup old lobbies in the background (non-blocking)
            performLobbyCleanup();
            
            const playerName = resolvePlayerName();
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
            // Read by lobby.html on arrival to show a one-time "how long is
            // this kept" toast matching how this lobby was created.
            try {
                sessionStorage.setItem(RULES_TOAST_STORAGE_KEY, currentUser.isAnonymous ? 'anonymous' : 'google');
            } catch (storageError) {
                // Non-fatal - the toast just won't show.
            }
            window.location.href = 'lobby.html?lobbyId=' + lobbyCode;
        } catch (error) {
            console.error('Error creating lobby:', error);
        } finally {
            // Restore original button state
            createLobbyBtn.disabled = originalDisabled;
            createLobbyBtn.textContent = originalText;
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

            // Cleanup old lobbies in the background (non-blocking)
            performLobbyCleanup();
            
            const playerName = resolvePlayerName();
            const lobbyCode = lobbyCodeInput.value;

            await joinLobbyAndRedirect(lobbyCode, playerName);

        } catch (error) {
            console.error('Error joining lobby:', error);
            showErrorMessage(error);
            
            // Restore original button state on error
            joinLobbyBtn.disabled = originalDisabled;
            joinLobbyBtn.textContent = originalText;
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

// Initial state: buttons are disabled until auth state is known
if (createLobbyBtn) createLobbyBtn.disabled = true;
if (joinLobbyBtn) joinLobbyBtn.disabled = true;
});

