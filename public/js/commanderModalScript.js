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

        // Create a container for each player
        const playerContainer = document.createElement('div');
        playerContainer.classList.add('commander-player-container');
        playerContainer.style.height = `${playerFrameHeight}px`;
        playerContainer.style.position = 'relative';

        // Create display area for commander name and damage
        const displayArea = document.createElement('div');
        displayArea.classList.add('commander-display-area');
        displayArea.style.color = playerData.fontColor;
        
        if (lifeToApply === 0) {
            displayArea.textContent = `${commanderName}: ${damage}`;
        } else if (lifeToApply > 0) {
            displayArea.textContent = `${commanderName}: ${damage} (+${lifeToApply})`;
        } else {
            displayArea.textContent = `${commanderName}: ${damage} (${lifeToApply})`;
        }

        // Create overlay using the same function as createPlayerFrameOverlay
        const overlay = document.createElement('div');
        overlay.className = 'player-frame-overlay';

        // Create 4 regions with labels and click handlers
        const regions = [
            { label: '-1', changeAmount: -1, style: 'grid-row: 1; grid-column: 1;' },
            { label: '+1', changeAmount: 1, style: 'grid-row: 1; grid-column: 2;' },
            { label: '-5', changeAmount: -5, style: 'grid-row: 2; grid-column: 1;' },
            { label: '+5', changeAmount: 5, style: 'grid-row: 2; grid-column: 2;' }
        ];
        regions.forEach((region) => {
            const div = document.createElement('div');
            div.className = 'overlay-square';
            div.textContent = region.label;
            div.style.cssText += region.style;
            div.addEventListener('click', (event) => {
                event.stopPropagation();
                onClickCommanderDamageControl(lobbyId, playerDocument.id, otherPlayerName, snapshot, region.changeAmount);
            });
            overlay.appendChild(div);
        });

        // Append display and overlay to container
        playerContainer.appendChild(displayArea);
        playerContainer.appendChild(overlay);
        commanderDamageList.appendChild(playerContainer);
    });
    // Show the modal
    const commanderModal = document.getElementById('commanderModal');
    commanderModal.classList.remove('hidden');
    commanderModal.classList.add('flex'); // Use flex to show and center
    document.body.classList.add('modal-open'); // Prevent body scroll
}

const lobbyCollectionName = "lobbies"
const playerCollectionName = "players"

async function onClickCommanderDamageControl(lobbyId, playerDocumentId, otherPlayerName, snapshot, changeAmount){
    try {
        const playerDocument = await getPlayer(lobbyId, playerDocumentId);
        const playerData = playerDocument.data();
        let commanderDamages = playerData.commanderDamages || [];
        const playerName = playerData.name;

        let commanderDamage = getCommanderDamageFromName(commanderDamages, otherPlayerName);

        if (commanderDamage) {
            commanderDamage.lifeToApply += changeAmount;
        } else {
            commanderDamage = new CommanderDamage(playerName, otherPlayerName, 0, changeAmount);
            commanderDamages.push(commanderDamage.toFirestoreObject());
        }

        await updateCommanderDamage(lobbyId, playerDocumentId, commanderDamages);

        // After successful transaction, re-render the modal with the updated data
        const updatedPlayerDocument = await getPlayer(lobbyId, playerDocumentId);
        openCommanderModal(lobbyId, updatedPlayerDocument, snapshot);

        // Update lobby last updated timestamp (optional)
        await updateLobbyTimestamp({ lobbyId });

    } catch (error) {
        console.error(`Error updating commander damage for ${playerDocumentId}:`, error);
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
