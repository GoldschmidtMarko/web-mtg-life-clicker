import { getPlayerFrameHeightFromSnapshot } from "./util/playerFrameHeightFromSnapshot.js"
import { firebaseConfig } from './util/firebaseConfig.js';
import { CommanderDamage } from './util/models.js';
import {
    updateCommanderDamage,
    getPlayer,
    updateLobbyTimestamp,
    getServerTimestamp
} from './tempFunctions.js';


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
        const damageToApply = commanderDamage ? commanderDamage.damageToApply : 0;
        const damage = commanderDamage ? commanderDamage.damage : 0;
        const commanderName = commanderDamage ? commanderDamage.commanderName : otherPlayerName;

        
        // Create a button for each player in the snapshot
        const playerFrame = document.createElement('button'); // Change div to button
        // playerFrame.style.backgroundColor = playerData.backgroundColor; // Removed dynamic background color
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('commander-modal-button');
        playerFrame.style.height = `${playerFrameHeight}px`;

        // Create and append a div for each opponent's damage within the playerFrame
        if (damageToApply === 0) {
            playerFrame.textContent = `${commanderName}: ${damage}`;
        } else if (damageToApply > 0) {
            playerFrame.textContent = `${commanderName}: ${damage} (+${damageToApply})`;
        } else {
            playerFrame.textContent = `${commanderName}: ${damage} (${damageToApply})`;
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
}

const lobbyCollectionName = "lobbies"
const playerCollectionName = "players"

async function onClickCommanderDamageName(lobbyId, event, playerDocumentId, otherPlayerName, snapshot){
    const playerFrame = event.currentTarget; // Get the button element that was clicked
    const buttonWidth = playerFrame.offsetWidth;
    const clickX = event.clientX - playerFrame.getBoundingClientRect().left;

    try {
        const playerDocument = await getPlayer(lobbyId, playerDocumentId);
        const playerData = playerDocument.data();
        let commanderDamages = playerData.commanderDamages || [];
        const playerName = playerData.name;

        let commanderDamage = getCommanderDamageFromName(commanderDamages, otherPlayerName);

        if (clickX < buttonWidth / 2) {
            if (commanderDamage) {
                commanderDamage.damageToApply -= 1;
            } else {
                commanderDamage = new CommanderDamage(playerName, otherPlayerName, 0, -1);
                commanderDamages.push(commanderDamage.toFirestoreObject());
            }
        } else {
            if (commanderDamage) {
                commanderDamage.damageToApply += 1;
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
        await updateLobbyTimestamp(lobbyId);

    } catch (error) {
        console.error(`Error updating player attribute for ${playerDocumentId}:`, error);
    }
}

export function closeCommanderModal() {
    const commanderModal = document.getElementById('commanderModal');
    commanderModal.classList.add('hidden');
    commanderModal.classList.remove('flex');
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
