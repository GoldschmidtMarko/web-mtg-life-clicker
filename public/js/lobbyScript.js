import { openSettingsModal } from './settingsModalScript.js';
import { Player } from './util/models.js';
import { openCommanderModal } from "./commanderModalScript.js"
import { getPlayerFrameHeightFromSnapshot } from "./util/playerFrameHeightFromSnapshot.js"
import { firebaseConfig } from './util/firebaseConfig.js';

// Initialize Firebase (only once per app)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Initialize Firebase Auth and Functions
const auth = firebase.auth();
const functions = firebase.app().functions('europe-west4');

const getPlayers = functions.httpsCallable('getPlayers');
const updatePlayer = functions.httpsCallable('updatePlayer');
const deletePlayer = functions.httpsCallable('deletePlayer');
const applyCombatDamage = functions.httpsCallable('applyCombatDamage');


// Get lobby ID from URL or wherever it's stored
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobbyId'); // Assuming you pass lobbyId in the URL

// Page state
let currentPage = 0; // Start with the first page (index 0)
const totalPages = 3; // Based on the 3 dots in the HTML
let playerSnapshot = null;

function updatePageDots() {
    const dots = document.querySelectorAll('#page-dots .dot');
    dots.forEach((dot, index) => {
        if (index === currentPage) {
            dot.classList.add('filled');
        } else {
            dot.classList.remove('filled');
        }
    });
}

function listenToPlayers(lobbyId, callback) {
    return firebase.firestore()
      .collection('lobbies')
      .doc(lobbyId)
      .collection('players')
      .onSnapshot(snapshot => {
        readCount += snapshot.docs.length;
        callback(snapshot);
      });
  }

function changePage(direction) {
    currentPage += direction;

    // Wrap around if at the beginning or end
    if (currentPage < 0) {
        currentPage = totalPages - 1;
    } else if (currentPage >= totalPages) {
        currentPage = 0;
    }

    updatePageDots();
    renderCurrentPage(); // Use stored snapshot instead of re-listening
}

function setupPageControls() {
    const prevButton = document.getElementById('prev-page');
    const nextButton = document.getElementById('next-page');

    if (prevButton) {
        prevButton.addEventListener('click', () => {
            changePage(-1);
        });
    }

    if (nextButton) {
        nextButton.addEventListener('click', () => {
            changePage(1);
        });
    }

    // Initialize dots
    updatePageDots();
}


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

function initializeLobbyUI(lobbyId) {
    const lobbyNumberElement = document.getElementById('lobby-number');
    if (lobbyNumberElement) {
        lobbyNumberElement.textContent = `Lobby: ${lobbyId}`;
    }
    // Get other necessary element references here
}

function populatePlayerGridCommander(snapshot) {
    const pageLabel = document.getElementById('page-label');
    pageLabel.textContent = "Commander";

    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)
    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const commanderDamages = playerData.commanderDamages;

        const playerFrame = document.createElement('button'); // Change div to button
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;

        
        const nameElement = document.createElement('div');
        nameElement.textContent = `${playerName}`;
        playerFrame.appendChild(nameElement);

        if (commanderDamages) {
            for (const commanderDamage of commanderDamages) {
                const commanderName = commanderDamage.commanderName;
                const damage = commanderDamage.damage
                const damageToApply = commanderDamage.damageToApply
                
                const lifeElement = document.createElement('div');
                if (damageToApply === 0) {
                    lifeElement.textContent = `${commanderName}: ${damage}`;
                } else if (damageToApply > 0) {
                    lifeElement.textContent = `${commanderName}: ${damage} (+${damageToApply})`;
                } else {
                    lifeElement.textContent = `${commanderName}: ${damage} (${damageToApply})`;
                }
                playerFrame.appendChild(lifeElement);
            }
        }

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame)

        playerFrame.addEventListener('click', async () => {
            openCommanderModal(lobbyId, playerDocument, snapshot);
        });

        playerGrid.appendChild(playerFrame);

    });
}


function populatePlayerGridInfect(snapshot) {
    const pageLabel = document.getElementById('page-label');
    pageLabel.textContent = "Infect";

    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)
    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const infectToApply = playerData.infectToApply;
        const infect = playerData.infect;

        const playerFrame = document.createElement('button'); // Change div to button
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;

        const nameElement = document.createElement('div');
        nameElement.textContent = `${playerName}`;
        playerFrame.appendChild(nameElement);

        const lifeElement = document.createElement('div');
        if (infectToApply === 0) {
            lifeElement.textContent = `Infect: ${infect}`;
        } else if (infectToApply > 0) {
            lifeElement.textContent = `Infect: ${infect} (+${infectToApply})`;
        } else {
            lifeElement.textContent = `Infect: ${infect} (${infectToApply})`;
        }
        playerFrame.appendChild(lifeElement);

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "infectToApply");
        });
    });
}

function addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame) {
    // Add the "X" button
    const removeButton = document.createElement('button');
    const playerName = playerDocument.data().name;
    removeButton.textContent = '✖️'
    removeButton.classList.add('remove-player-button');
    removeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showConfirmationModal(`Are you sure you want to remove ${playerName}?`, async () => {
            await deletePlayer(lobbyId, playerDocument.id);
        });
    });

    const settingsButton = document.createElement('button');
    settingsButton.textContent = '⚙️';
    settingsButton.classList.add('settings-button');
    settingsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openSettingsModal(playerDocument.id, playerName);
    });
    playerFrame.appendChild(removeButton);
    playerFrame.appendChild(settingsButton);
}

function populatePlayerGridDefault(snapshot) {
    const pageLabel = document.getElementById('page-label');
    pageLabel.textContent = "Life";

    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)

    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const playerLife = playerData.life;
        const damageToApply = playerData.damageToApply;

        const playerFrame = document.createElement('button'); // Change div to button
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;


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

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "damageToApply");
        });
    });
}

function setupPlayerListener(lobbyId) {
    listenToPlayers(lobbyId, (snapshot) => {
        console.log("Players subcollection updated!");
        console.log("Stats: ", getFirestoreUsageStats())
        playerSnapshot = snapshot; // Save the snapshot globally
        renderCurrentPage(); // Render the current page using the snapshot
    });
}

function renderCurrentPage() {
    if (!playerSnapshot) return; // Wait until snapshot is available
    if (currentPage === 0) {
        populatePlayerGridDefault(playerSnapshot);
    } else if (currentPage === 1) {
        populatePlayerGridInfect(playerSnapshot);
    } else {
        populatePlayerGridCommander(playerSnapshot);
    }
}

// Function to handle player frame clicks and update life
async function handlePlayerFrameClick(event, lobbyId, playerDocument, attributeKey) {
    const playerFrame = event.currentTarget; // Get the button element that was clicked
    const buttonWidth = playerFrame.offsetWidth;
    const clickX = event.clientX - playerFrame.getBoundingClientRect().left;

     try {
        const currentPlayer = playerSnapshot?.docs.find(doc => doc.id === playerDocument.id);
        if (!currentPlayer) return;
        const currentValue = currentPlayer.data()[attributeKey];

        if (clickX < buttonWidth / 2) {
            await updatePlayer(lobbyId, playerDocument.id, { [attributeKey]: currentValue - 1 });
        } else {
            await updatePlayer(lobbyId, playerDocument.id, { [attributeKey]: currentValue + 1 });
        }

            // Update lobby last updated timestamp (optional)
        await updateLobbyTimestamp(lobbyId);
     } catch (error) {
         console.error(`Error updating player attribute for ${playerDocument.id}:`, error);;
     }
}

function addClickHandler(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', handler);
}

// Function for the Apply button handler
function setupApplyButton(lobbyId) {
    const applyButton = document.getElementById('apply-button');
    if (applyButton) {
        applyButton.addEventListener('click', async () => {
            const playersSnapshot = await getPlayers(lobbyId);
            playersSnapshot.forEach(async (playerDocument) => {
                await applyCombatDamage(lobbyId, playerDocument.id); // Call the new function
            });
            await updateLobbyTimestamp(lobbyId); // Update lobby timestamp after applying damage to all players
        });
    }
}

// Function for the Abort button handler
function setupAbortButton(lobbyId) {
    const abortButton = document.getElementById('abort-button');

    if (abortButton) {
        abortButton.addEventListener('click', async () => {
            const players = await getPlayers(lobbyId);
            players.forEach(async (playerDocument) => {
                await updatePlayer(lobbyId, playerDocument.id, { damageToApply: 0, infectToApply: 0 });
            });
        });
    }
}

// Function for the Add Dummy Player button handler
function setupAddDummyPlayerButton(lobbyId) {
    const dummyButton = document.getElementById('add-dummy-player-button');
    const randomNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack"];

    if (dummyButton) {
        dummyButton.addEventListener('click', async () => {
            const player = new Player(
                0,
                randomNames[Math.floor(Math.random() * randomNames.length)],
                Math.floor(Math.random() * 40),
                0,
                0,
                0,
                "#FFFFFF",
                "#000000",
            );
            await addPlayer(lobbyId, player);
        });
    }
}


// --- Initialize Lobby ---
if (lobbyId) {
    initializeLobbyUI(lobbyId);
    initializeControls(lobbyId);
    setupPlayerListener(lobbyId);
} else {
    console.error("Lobby ID not found!");
}

function initializeControls(lobbyId) {
    setupPageControls();
    setupExitLobbyButton();
    setupSettingsButton();
    setupResetLifeButton(lobbyId);
    setupApplyButton(lobbyId);
    setupAbortButton(lobbyId);
    setupAddDummyPlayerButton(lobbyId);
}

function setupExitLobbyButton() {
    addClickHandler('exit-lobby-button', () => window.location.href = '../index.html');
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

    if (resetLifeButton && resetLifeInput) {
        resetLifeButton.addEventListener('click', async () => {
            const lifeToSet = parseInt(resetLifeInput.value, 10); // Parse the input value as an integer

            // Basic validation: ensure lifeToSet is a valid number
            if (isNaN(lifeToSet)) {
                console.error("Invalid life value entered for reset.");
                return; // Stop if the input is not a number
            }

            const players = await getPlayers(lobbyId);
            players.forEach(async (playerDocument) => {
                await updatePlayer(lobbyId, playerDocument.id, {
                    life: lifeToSet,
                    damageToApply: 0,
                    infect: 0,
                    infectToApply: 0,
                    commanderDamages: []
                });
            });
        });
    }
}

