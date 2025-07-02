import { firebaseConfig } from './firebaseConfig.js'; // Keep this import

    // Initialize Firebase
    const app = firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const functions = firebase.functions();


    // Wait for the DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', () => {
        // Get references to HTML elements *inside* this listener
        const createLobbyBtn = document.getElementById('create-lobby-btn');
        const remotePlayerNameInput = document.getElementById('remote-player-name-input');
        const lobbyCodeInput = document.getElementById('lobby-code-input');
        const joinLobbyBtn = document.getElementById('join-lobby-btn');
        const userIdDisplay = document.getElementById('user-id-display');
        const userIdValue = document.getElementById('user-id-value');
        const signInButton = document.getElementById('sign-in-button');


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
        const createLobbyCallable = functions.httpsCallable('createLobby');
        const joinLobbyCallable = functions.httpsCallable('joinLobby');


        // Event listener for Create New Lobby button *inside* this listener
        if (createLobbyBtn) {
            createLobbyBtn.addEventListener('click', async () => {
                const playerName = remotePlayerNameInput.value || currentUser.displayName || 'Player'; // Use input value or display name
                try {
                    const result = await createLobbyCallable({ playerName: playerName });
                    const lobbyCode = result.data.lobbyCode;
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
                // ... (rest of your join lobby logic) ...
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
