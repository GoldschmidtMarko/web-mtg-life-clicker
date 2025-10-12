import { getPlayerFrameHeightFromSnapshot } from "./util/playerFrameHeightFromSnapshot.js"
import { CommanderDamage } from './util/models.js';
import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Functions and Firestore
const functions = firebase.app().functions('europe-west3');
const firestore = firebase.firestore();

// Connect to emulators when running locally
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    functions.useEmulator('localhost', 5001);
    firestore.useEmulator('localhost', 8080);
}

// Firebase callable functions
const updatePlayer = functions.httpsCallable('updatePlayer');
const updateLobbyTimestamp = functions.httpsCallable('updateLobbyTimestamp');

// Helper function to get a player document
async function getPlayer(lobbyId, playerId) {
    const playerRef = firestore.collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
    return await playerRef.get();
}

// Helper function to update commander damage
async function updateCommanderDamage(lobbyId, playerId, commanderDamages) {
    await updatePlayer({ 
        lobbyId, 
        playerId, 
        updates: { commanderDamages } 
    });
}


function getCommanderDamageFromName(commanderDamageList, playerName) {
    if (!commanderDamageList) return null;
    for (const commanderDamage of commanderDamageList) {
        if (commanderDamage.commanderName === playerName) {
            return commanderDamage;
        }
    }
    return null;
}

export function openCommanderModal(lobbyId, playerDocument, snapshot) {
    const commanderDamageList = document.getElementById('commanderDamageList');
    commanderDamageList.innerHTML = ''; // Clear previous entries

    const playerData = playerDocument.data();
    const commanderDamages = playerData.commanderDamages || []; // Handle cases with no commander damage yet
    
    // Add the current player's name at the top
    const currentPlayerNameElement = document.createElement('div');
    currentPlayerNameElement.textContent = playerData.name;
    currentPlayerNameElement.classList.add('commander-modal-player-name'); 
    commanderDamageList.appendChild(currentPlayerNameElement);

    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 1) - 50;

    snapshot.forEach((doc) => {
        const otherPlayerData = doc.data();
        const otherPlayerName = otherPlayerData.name;
        if(otherPlayerName === playerData.name) {
            return;
        }
        const commanderDamage = getCommanderDamageFromName(commanderDamages, otherPlayerName);
        const lifeToApply = commanderDamage ? commanderDamage.lifeToApply : 0;
        const damage = commanderDamage ? commanderDamage.damage : 0;
        const commanderName = commanderDamage ? commanderDamage.commanderName : otherPlayerName;

        
        // Create a button for each player in the snapshot
        const playerFrame = document.createElement('button'); // Change div to button
        // playerFrame.style.backgroundColor = playerData.backgroundColor; // Removed dynamic background color
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('commander-modal-button');
        playerFrame.style.height = `${playerFrameHeight}px`;

        // Create and append a div for each opponent's damage within the playerFrame
        if (lifeToApply === 0) {
            playerFrame.textContent = `${commanderName}: ${damage}`;
        } else if (lifeToApply > 0) {
            playerFrame.textContent = `${commanderName}: ${damage} (+${lifeToApply})`;
        } else {
            playerFrame.textContent = `${commanderName}: ${damage} (${lifeToApply})`;
        }
        // Add event listeners for left and right clicks
        playerFrame.addEventListener('click', (event) => {
            onClickCommanderDamageName(lobbyId, event, playerDocument.id, otherPlayerName, snapshot);
        });
        commanderDamageList.appendChild(playerFrame);
    });
    // Show the modal
    const commanderModal = document.getElementById('commanderModal');
    commanderModal.classList.remove('hidden');
    commanderModal.classList.add('flex'); // Use flex to show and center
    document.body.classList.add('modal-open'); // Prevent body scroll
}

const lobbyCollectionName = "lobbies"
const playerCollectionName = "players"

async function onClickCommanderDamageName(lobbyId, event, playerDocumentId, otherPlayerName, snapshot){
    const playerFrame = event.currentTarget; // Get the button element that was clicked
    const buttonWidth = playerFrame.offsetWidth;
    const clickX = event.clientX - playerFrame.getBoundingClientRect().left;

    // Store original button state for loading feedback
    const originalText = playerFrame.textContent;
    const originalDisabled = playerFrame.disabled;
    
    try {
        // Set loading state
        playerFrame.disabled = true;
        playerFrame.style.opacity = '0.6';
        playerFrame.style.cursor = 'not-allowed';
        
        const playerDocument = await getPlayer(lobbyId, playerDocumentId);
        const playerData = playerDocument.data();
        let commanderDamages = playerData.commanderDamages || [];
        const playerName = playerData.name;

        let commanderDamage = getCommanderDamageFromName(commanderDamages, otherPlayerName);

        if (clickX < buttonWidth / 2) {
            if (commanderDamage) {
                commanderDamage.lifeToApply -= 1;
            } else {
                commanderDamage = new CommanderDamage(playerName, otherPlayerName, 0, -1);
                commanderDamages.push(commanderDamage.toFirestoreObject());
            }
        } else {
            if (commanderDamage) {
                commanderDamage.lifeToApply += 1;
            } else {
                commanderDamage = new CommanderDamage(playerName, otherPlayerName, 0, 1);
                commanderDamages.push(commanderDamage.toFirestoreObject());
            }
        }

        await updateCommanderDamage(lobbyId, playerDocumentId, commanderDamages);

        // After successful transaction, re-render the modal with the updated data
        const updatedPlayerDocument = await getPlayer(lobbyId, playerDocumentId);
        openCommanderModal(lobbyId, updatedPlayerDocument, snapshot);

        // Update lobby last updated timestamp (optional)
        await updateLobbyTimestamp({ lobbyId });

    } catch (error) {
        console.error(`Error updating player attribute for ${playerDocumentId}:`, error);
        
        // Restore original state on error
        playerFrame.disabled = originalDisabled;
        playerFrame.textContent = originalText;
        playerFrame.style.opacity = '';
        playerFrame.style.cursor = '';
    }
}

export function closeCommanderModal() {
    const commanderModal = document.getElementById('commanderModal');
    commanderModal.classList.add('hidden');
    commanderModal.classList.remove('flex');
    document.body.classList.remove('modal-open'); // Restore body scroll
}

// Add event listener to the close button
const closeCommanderModalButton = document.getElementById('closeCommanderModal');
if (closeCommanderModalButton) {
    closeCommanderModalButton.addEventListener('click', closeCommanderModal);
}

const commanderModal = document.getElementById('commanderModal');
if (commanderModal) {
    commanderModal.addEventListener('click', (event) => {
        // Check if the click occurred directly on the modal background
        if (event.target === commanderModal) {
            closeCommanderModal();
        }
    });
}

// Close commander modal when pressing escape key
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && commanderModal && !commanderModal.classList.contains('hidden')) {
        closeCommanderModal();
    }
});
