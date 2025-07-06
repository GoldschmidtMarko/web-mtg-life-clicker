import { firebaseConfig } from './firebaseConfig.js';
import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";

// Initialize Firebase
// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); // Although not strictly needed for this debug, keep for context
const functions = firebase.functions(); // Although not strictly needed for this debug, keep for context


// Get references to the modal and the settings button
const settingsModal = document.getElementById('settingsModal');
const modalContent = settingsModal.querySelector('.modal-content');
const db = firebase.firestore(); // Get Firestore instance

// Variable to store the current user ID
let currentUserId = null;

// Function to display the modal (assuming you have a CSS class like 'modal-container' for styling)
export function openSettingsModal(userId, playerName) {
    settingsModal.style.display = 'block';
    document.getElementById('username').value = playerName; // Populate username input
    currentUserId = userId; // Store the user ID
}
// Function to hide the modal
export function closeSettingsModal() {
    settingsModal.style.display = 'none';
}

// Close modal when clicking outside
// We now target the modal container itself
window.addEventListener('click', (event) => {
 // Assuming your inner modal content has this class

    // Check if the clicked element is the modal container itself,
    // or if it's outside the modal content
    if (event.target === settingsModal || (settingsModal.contains(event.target) && !modalContent.contains(event.target))) {
        closeSettingsModal();
    }
});

// Close modal when pressing escape key
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsModal && settingsModal.style.display === 'block') {
        closeSettingsModal();
    }
});

// Event listener for the save button
const saveSettingsButton = document.getElementById('saveSettings');
if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', () => {
        const newUsername = document.getElementById('username').value; // Get the new username
        const backgroundColor = document.getElementById('bgColor').value;
        const fontColor = document.getElementById('fontColor').value;

        // Use currentUserId to update the user's settings in Firestore
        // console.log("Attempting to save settings for user:", currentUserId, { newUsername, backgroundColor, fontColor });

        if (currentUserId) {
            // Assuming you have a way to get the current lobby ID
            // For example, you might pass it when opening the modal, or retrieve it from the URL
            const urlParams = new URLSearchParams(window.location.search);
            const lobbyId = urlParams.get('lobbyId');

            if (lobbyId) {
                db.collection('lobbies').doc(lobbyId).collection('players').doc(currentUserId).update({
                    name: newUsername,
                    backgroundColor: backgroundColor,
                    fontColor: fontColor,
                    // You can add updates for background and font color here later if you store them per player
                })
                .catch(error => console.error("Error updating username:", error));
            } else { console.error("Lobby ID not found. Cannot save settings."); }
        } else { console.warn("No user ID available. Cannot save settings."); }

        closeSettingsModal();
    });
}
