import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";
import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Functions
const functions = firebase.app().functions('europe-west3');

// Connect to emulators when running locally
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    functions.useEmulator('localhost', 5001);
}

// Firebase callable function
const updatePlayerSettings = functions.httpsCallable('updatePlayerSettings');

// Get references to the modal and the settings button
const settingsModal = document.getElementById('settingsModal');
const modalContent = settingsModal?.querySelector('.settings-modal-content');

// Variable to store the current user ID
let currentUserId = null;

// Function to display the modal (using Tailwind classes)
export function openSettingsModal(userId, playerName) {
    if (settingsModal) {
        settingsModal.classList.remove('hidden');
        settingsModal.classList.add('flex');
        document.body.classList.add('modal-open'); // Prevent body scroll
        
        // Populate username input if available
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            usernameInput.value = playerName;
        }
        
        currentUserId = userId; // Store the user ID
    }
}

// Function to hide the modal
export function closeSettingsModal() {
    if (settingsModal) {
        settingsModal.classList.add('hidden');
        settingsModal.classList.remove('flex');
        document.body.classList.remove('modal-open'); // Restore body scroll
    }
}

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    // Check if the clicked element is the modal container itself,
    // or if it's outside the modal content
    if (settingsModal && modalContent && 
        (event.target === settingsModal || 
         (settingsModal.contains(event.target) && !modalContent.contains(event.target)))) {
        closeSettingsModal();
    }
});

// Close modal when pressing escape key
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
    }
});

// Event listener for the save button
const saveSettingsButton = document.getElementById('saveSettings');
if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', async () => {
        // Store original button state
        const originalText = saveSettingsButton.textContent;
        const originalDisabled = saveSettingsButton.disabled;
        
        try {
            // Set loading state
            saveSettingsButton.disabled = true;
            saveSettingsButton.textContent = 'Saving...';
            saveSettingsButton.style.opacity = '0.6';
            saveSettingsButton.style.cursor = 'not-allowed';
            
            const newUsername = document.getElementById('username').value; // Get the new username
            const backgroundColor = document.getElementById('bgColor').value;
            const fontColor = document.getElementById('fontColor').value;

            // Use currentUserId to update the user's settings in Firestore
            if (currentUserId) {
                // Assuming you have a way to get the current lobby ID
                // For example, you might pass it when opening the modal, or retrieve it from the URL
                const urlParams = new URLSearchParams(window.location.search);
                const lobbyId = urlParams.get('lobbyId');

                if (lobbyId) {
                    await updatePlayerSettings({
                        lobbyId: lobbyId,
                        playerId: currentUserId,
                        settings: {
                            name: newUsername,
                            backgroundColor: backgroundColor,
                            fontColor: fontColor,
                        }
                    });
                    
                    // Restore original button state on success
                    saveSettingsButton.disabled = originalDisabled;
                    saveSettingsButton.textContent = originalText;
                    saveSettingsButton.style.opacity = '';
                    saveSettingsButton.style.cursor = '';
                } else { 
                    console.error("Lobby ID not found. Cannot save settings."); 
                    
                    // Restore original button state on error
                    saveSettingsButton.disabled = originalDisabled;
                    saveSettingsButton.textContent = originalText;
                    saveSettingsButton.style.opacity = '';
                    saveSettingsButton.style.cursor = '';
                }
            } else { 
                console.warn("No user ID available. Cannot save settings."); 
                
                // Restore original button state on error
                saveSettingsButton.disabled = originalDisabled;
                saveSettingsButton.textContent = originalText;
                saveSettingsButton.style.opacity = '';
                saveSettingsButton.style.cursor = '';
            }
        } catch (error) {
            console.error("Error updating player settings:", error);
            
            // Restore original button state on error
            saveSettingsButton.disabled = originalDisabled;
            saveSettingsButton.textContent = originalText;
            saveSettingsButton.style.opacity = '';
            saveSettingsButton.style.cursor = '';
        }

        closeSettingsModal();
    });
}
