import { firebaseConfig } from './firebaseConfig.js';
import { openSettingsModal } from './settingsModalScript.js';
import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";

// Initialize Firebases
// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); // Although not strictly needed for this debug, keep for context
const functions = firebase.functions(); // Although not strictly needed for this debug, keep for context

const lobbyCollectionName = "lobbies"
const playerCollectionName = "players"

// Get lobby ID from URL or wherever it's stored
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobbyId'); // Assuming you pass lobbyId in the URL

function showConfirmationModal(message, onConfirm) {
    const confirmationModal = document.getElementById('confirmation-modal');
    const modalMessage = document.getElementById('modal-Message');
    const confirmRemoveButton = document.getElementById('confirm-remove-button');
    const cancelRemoveButton = document.getElementById('cancel-remove-button');

    if (!confirmationModal || !modalMessage || !confirmRemoveButton || !cancelRemoveButton) {
        console.error("Confirmation modal elements not found!");
        return;
    }

    modalMessage.textContent = message;
    confirmationModal.classList.remove('hidden');
    confirmationModal.classList.add('flex'); // Use flex to show and center

    // Remove previous event listeners to avoid multiple calls
    confirmRemoveButton.replaceWith(confirmRemoveButton.cloneNode(true));
    cancelRemoveButton.replaceWith(cancelRemoveButton.cloneNode(true));

    const newConfirmRemoveButton = document.getElementById('confirm-remove-button');
    const newCancelRemoveButton = document.getElementById('cancel-remove-button');


    newConfirmRemoveButton.addEventListener('click', async () => {
        await onConfirm();
        confirmationModal.classList.add('hidden');
        confirmationModal.classList.remove('flex');
    });

    newCancelRemoveButton.addEventListener('click', () => {
        confirmationModal.classList.add('hidden');
        confirmationModal.classList.remove('flex');
    });
}

async function openPlayerSettingsModal(playerDocument, playerName) {
    const settingsModal = document.getElementById('settingsModal');
    const usernameInput = document.getElementById('username');
    const bgColorInput = document.getElementById('bgColor');
    const fontColorInput = document.getElementById('fontColor');
    const saveSettingsButton = document.getElementById('saveSettings');

     if (!settingsModal || !usernameInput || !bgColorInput || !fontColorInput || !saveSettingsButton) {
        console.error("Settings modal elements not found!");
        return;
    }

    // Assuming you fetch player settings here based on playerId
    // For demonstration, let's set some dummy values
    usernameInput.value = playerName;
     // Fetch actual settings from Firestore if needed
    const playerData = playerDocument.data();
    bgColorInput.value = playerData.backgroundColor || "#FFFFFF";
    fontColorInput.value = playerData.fontColor || "#000000";



    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex'); // Use flex to show and center

    // Remove previous event listeners to avoid multiple calls
     saveSettingsButton.replaceWith(saveSettingsButton.cloneNode(true));
     const newSaveSettingsButton = document.getElementById('saveSettings');
     const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

    newSaveSettingsButton.addEventListener('click', async () => {
        // Save settings to Firestore
        try {
            await playersSubcollectionRef.doc(playerDocument.id).update({
                name: usernameInput.value,
                backgroundColor: bgColorInput.value,
                fontColor: fontColorInput.value,
            });
             settingsModal.classList.add('hidden');
             settingsModal.classList.remove('flex');
        } catch (error) {
             console.error("Error saving settings:", error);
        }
    });

    // Close modal when clicking outside or on a close button (you might need to add a close button)
     settingsModal.addEventListener('click', (event) => {
         if (event.target === settingsModal) {
             settingsModal.classList.add('hidden');
             settingsModal.classList.remove('flex');
         }
     });
}

function initializeLobbyUI(lobbyId) {
    const lobbyNumberElement = document.getElementById('lobby-number');
    if (lobbyNumberElement) {
        lobbyNumberElement.textContent = `Lobby: ${lobbyId}`;
    }
    // Get other necessary element references here
}

function setupPlayerListener(lobbyId) {
    const playerGrid = document.getElementById('player-grid');
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

    playersSubcollectionRef.onSnapshot(async (snapshot) => {
        console.log("Players subcollection updated!");
        playerGrid.innerHTML = ''; // Clear the current player grid

        snapshot.forEach((playerDocument) => {
            const playerData = playerDocument.data();
            const playerName = playerData.name;
            const playerLife = playerData.life;
            const damageToApply = playerData.damageToApply;

            const playerFrame = document.createElement('button'); // Change div to button
            playerFrame.style.backgroundColor = playerData.backgroundColor;
            playerFrame.style.color = playerData.fontColor;
            playerFrame.classList.add('player-frame');

            const nameElement = document.createElement('div');
            nameElement.textContent = `${playerName}`;
            playerFrame.appendChild(nameElement);
            const lifeElement = document.createElement('div');
            if (damageToApply === 0) {
                lifeElement.textContent = `Life: ${playerLife}`;
            } else if (damageToApply > 0) {
                lifeElement.textContent = `Life: ${playerLife} (+${damageToApply})`;
            } else {
                lifeElement.textContent = `Life: ${playerLife} (${damageToApply})`;
            }
            playerFrame.appendChild(lifeElement);

            // Add the "X" button
            const removeButton = document.createElement('button');
            removeButton.textContent = '✖️'
            removeButton.classList.add('remove-player-button');
            removeButton.addEventListener('click', (event) => {
                event.stopPropagation();
                showConfirmationModal(`Are you sure you want to remove ${playerName}?`, async () => {
                    await playersSubcollectionRef.doc(playerDocument.id).delete();
                });
            });

            // add settings button top right
            const settingsButton = document.createElement('button');
            settingsButton.textContent = '⚙️';
            settingsButton.classList.add('settings-button');
            settingsButton.addEventListener('click', (event) => {
                event.stopPropagation();
                openSettingsModal(playerDocument.id, playerName);
            });

            playerFrame.prepend(removeButton);
            playerFrame.prepend(settingsButton);
            playerGrid.appendChild(playerFrame);

             // Add event listener to the player frame for life updates
            playerFrame.addEventListener('click', async (event) => {
                handlePlayerFrameClick(event, lobbyId, playerDocument);
            });
        });
    });
}

// Function to handle player frame clicks and update life
async function handlePlayerFrameClick(event, lobbyId, playerDocument) {
    const playerFrame = event.currentTarget; // Get the button element that was clicked
    const buttonWidth = playerFrame.offsetWidth;
    const clickX = event.clientX - playerFrame.getBoundingClientRect().left;
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

     try {
        const latestDamageToApply = (await playersSubcollectionRef.doc(playerDocument.id).get()).data().damageToApply;

            if (clickX < buttonWidth / 2) {
                console.log(`Player: ${playerDocument.id} | Life decreased`);
                await playersSubcollectionRef.doc(playerDocument.id).update({ damageToApply: latestDamageToApply - 1 });
            } else {
                console.log(`Player: ${playerDocument.id} | Life increased`);
                await playersSubcollectionRef.doc(playerDocument.id).update({ damageToApply: latestDamageToApply + 1 });
            }

            // Update lobby last updated timestamp (optional)
        const lobbyDocRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId)
        await lobbyDocRef.update({ lastUpdated: firebase.firestore.FieldValue.serverTimestamp() });
     } catch (error) {
         console.error(`Error updating player life for ${playerDocument.id}:`, error);
     }
}

// Function for the Apply button handler
function setupApplyButton(lobbyId) {
    const applyButton = document.getElementById('apply-button');
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

    if (applyButton) {
        applyButton.addEventListener('click', async () => {
            const players = await playersSubcollectionRef.get();
            players.forEach(async (playerDocument) => {
                await playersSubcollectionRef.doc(playerDocument.id).update({
                    life: firebase.firestore.FieldValue.increment(playerDocument.data().damageToApply),
                    damageToApply: 0
                });
            });
        });
    }
}

// Function for the Abort button handler
function setupAbortButton(lobbyId) {
    const abortButton = document.getElementById('abort-button');
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

    if (abortButton) {
        abortButton.addEventListener('click', async () => {
            const players = await playersSubcollectionRef.get();
            players.forEach(async (playerDocument) => {
                await playersSubcollectionRef.doc(playerDocument.id).update({ damageToApply: 0 });
            });
        });
    }
}

// Function for the Add Dummy Player button handler
function setupAddDummyPlayerButton(lobbyId) {
    const dummyButton = document.getElementById('add-dummy-player-button');
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);
    const randomNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"];

    if (dummyButton) {
        dummyButton.addEventListener('click', async () => {
            console.log("test")
            await playersSubcollectionRef.add({
                name: randomNames[Math.floor(Math.random() * randomNames.length)],
                life: Math.floor(Math.random() * 100),
                damageToApply: 0,
                backgroundColor: "#FFFFFF",
                fontColor: "#000000",
            });
        });
    }
}


// --- Initialize Lobby ---
if (lobbyId) {
    initializeLobbyUI(lobbyId);
    setupPlayerListener(lobbyId);
    setupExitLobbyButton(); // Call the new function
    setupSettingsButton(); // Call the new function
    setupResetLifeButton(lobbyId); // Call the new function and pass lobbyId
    setupApplyButton(lobbyId);
    setupAbortButton(lobbyId);
    setupAddDummyPlayerButton(lobbyId);
} else {
    console.error("Lobby ID not found!");
    // Optionally redirect the user or display an error message
}

function setupExitLobbyButton() {
    const exitButton = document.getElementById('exit-lobby-button');
    if (exitButton) {
        exitButton.addEventListener('click', () => {
            // go back to index.html
            window.location.href = '../index.html';
        });
    }
}

// Function for the Settings button handler
function setupSettingsButton() {
    const settingsButton = document.getElementById('settings-button');
    const settingsFrame = document.getElementById('settings-frame');
    if (settingsButton && settingsFrame) {
        settingsButton.addEventListener('click', () => {
            settingsFrame.classList.toggle('hidden');
        });
    }
}

// Function for the Reset Life button handler
function setupResetLifeButton(lobbyId) {
    const resetLifeButton = document.getElementById('reset-life-button');
    const resetLifeInput = document.getElementById('reset-life-input');
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName); // Use the modular Firestore API

    if (resetLifeButton && resetLifeInput) {
        resetLifeButton.addEventListener('click', async () => {
            const lifeToSet = parseInt(resetLifeInput.value, 10); // Parse the input value as an integer

            // Basic validation: ensure lifeToSet is a valid number
            if (isNaN(lifeToSet)) {
                console.error("Invalid life value entered for reset.");
                return; // Stop if the input is not a number
            }

            const players = await playersSubcollectionRef.get(); // Use getDocs for a one-time fetch
            players.forEach(async (playerDocument) => {
                await  playersSubcollectionRef.doc(playerDocument.id).update({
                    life: lifeToSet,
                    damageToApply: 0,
                    infect: 0 // Assuming 'infect' is a field you want to reset
                });
            });
        });
    }
}

