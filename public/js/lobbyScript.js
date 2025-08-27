import { openSettingsModal } from './settingsModalScript.js';
import { Player } from './util/models.js';
import { openCommanderModal } from "./commanderModalScript.js"
import { getPlayerFrameHeightFromSnapshot } from "./util/playerFrameHeightFromSnapshot.js"
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
    functions.useEmulator('localhost', 5001);
    auth.useEmulator('http://localhost:9099');
    firestore.useEmulator('localhost', 8080);
}

const getPlayers = functions.httpsCallable('getPlayers');
const updatePlayer = functions.httpsCallable('updatePlayer');
const deletePlayer = functions.httpsCallable('deletePlayer');
const applyCombatDamage = functions.httpsCallable('applyCombatDamage');
const addPlayer = functions.httpsCallable('addPlayer');
const updateLobbyTimestamp = functions.httpsCallable('updateLobbyTimestamp');

// Function to show spam/error warnings
function showSpamWarning(message = 'Please slow down! Too many requests.') {
    let warning = document.getElementById('spam-warning');
    if (!warning) {
        warning = document.createElement('div');
        warning.id = 'spam-warning';
        warning.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 15px;
            border-radius: 5px;
            z-index: 10000;
            font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            max-width: 300px;
        `;
        document.body.appendChild(warning);
    }
    
    warning.textContent = message;
    warning.style.display = 'block';

    // Hide warning after 4 seconds
    setTimeout(() => {
        if (warning) {
            warning.style.display = 'none';
        }
    }, 4000);
}


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

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)

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

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "infectToApply");
        });
    });
}

function addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, frameHeight) {
    // Calculate button size based on frame height
    const buttonSize = Math.max(12, Math.min(24, frameHeight * 0.08)); // Min 12px, max 24px, 8% of frame height
    const fontSize = Math.max(8, Math.min(16, frameHeight * 0.06)); // Min 8px, max 16px, 6% of frame height
    
    // Add the "X" button
    const removeButton = document.createElement('button');
    const playerName = playerDocument.data().name;
    removeButton.textContent = '✖️'
    removeButton.classList.add('remove-player-button');
    
    // Set dynamic sizing
    removeButton.style.width = `${buttonSize}px`;
    removeButton.style.height = `${buttonSize}px`;
    removeButton.style.fontSize = `${fontSize}px`;
    
    removeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showConfirmationModal(`Are you sure you want to remove ${playerName}?`, async () => {
            await deletePlayer({ lobbyId, playerId: playerDocument.id });
        });
    });

    const settingsButton = document.createElement('button');
    settingsButton.textContent = '⚙️';
    settingsButton.classList.add('settings-button');
    
    // Set dynamic sizing
    settingsButton.style.width = `${buttonSize}px`;
    settingsButton.style.height = `${buttonSize}px`;
    settingsButton.style.fontSize = `${fontSize}px`;
    
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

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "damageToApply");
        });
    });
}

function setupPlayerListener(lobbyId) {
    listenToPlayers(lobbyId, (snapshot) => {
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
            await updatePlayer({ lobbyId, playerId: playerDocument.id, updates: { [attributeKey]: currentValue - 1 } });
        } else {
            await updatePlayer({ lobbyId, playerId: playerDocument.id, updates: { [attributeKey]: currentValue + 1 } });
        }

            // Update lobby last updated timestamp (optional)
        await updateLobbyTimestamp({ lobbyId });
     } catch (error) {
         console.error(`Error updating player attribute for ${playerDocument.id}:`, error);
         
         // Show user-friendly error message
         if (error.code === 'functions/resource-exhausted') {
             showSpamWarning(error.message || 'Rate limit exceeded. Please slow down.');
         } else {
             console.error('Update failed:', error.message);
         }
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
            try {
                const playersResult = await getPlayers({ lobbyId });
                
                // Firebase callable functions return result.data
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result:', playersData);
                    return;
                }
                
                const playersSnapshot = playersData.players;
                
                for (const playerDocument of playersSnapshot) {
                    try {
                        
                        if (!playerDocument.id) {
                            console.error('Player document has no ID:', playerDocument);
                            continue;
                        }
                        
                        const result = await applyCombatDamage({ lobbyId, playerId: playerDocument.id });
                    } catch (playerError) {
                        console.error(`Error processing player ${playerDocument.id}:`, playerError);
                        console.error('Full error details:', playerError);
                    }
                }
                
                await updateLobbyTimestamp({ lobbyId }); // Update lobby timestamp after applying damage to all players
            } catch (error) {
                console.error('Error in apply button handler:', error);
            }
        });
    }
}

// Function for the Abort button handler
function setupAbortButton(lobbyId) {
    const abortButton = document.getElementById('abort-button');

    if (abortButton) {
        abortButton.addEventListener('click', async () => {
            try {
                const playersResult = await getPlayers({ lobbyId });
                
                // Firebase callable functions return result.data
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result in abort:', playersData);
                    return;
                }
                
                const players = playersData.players;
                players.forEach(async (playerDocument) => {
                    await updatePlayer({ lobbyId, playerId: playerDocument.id, updates: { damageToApply: 0, infectToApply: 0 } });
                });
            } catch (error) {
                console.error('Error in abort button handler:', error);
            }
        });
    }
}

// Function for the Add Dummy Player button handler
function setupAddDummyPlayerButton(lobbyId) {
    const dummyButton = document.getElementById('add-dummy-player-button');
    const randomNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Hank", "Ivy", "Jack", "Liam", "Mia", "Noah", "Olivia", "Sophia"];

    if (dummyButton) {
        dummyButton.addEventListener('click', async () => {
            // Generate a unique ID for the dummy player
            const uniqueId = `dummy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            const player = new Player(
                uniqueId,  // Use unique ID instead of hardcoded 0
                randomNames[Math.floor(Math.random() * randomNames.length)],
                40, // Random life between 1-40
                0,
                0,
                0,
                "#FFFFFF",
                "#000000",
            );
            
            try {
                await addPlayer({ lobbyId, player: player.toFirestoreObject() });
            } catch (error) {
                console.error('Error adding dummy player:', error);
            }
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
    addClickHandler('exit-lobby-button', () => window.location.href = 'index.html');
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

            try {
                const playersResult = await getPlayers({ lobbyId });
                
                // Firebase callable functions return result.data
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result in reset:', playersData);
                    return;
                }
                
                const players = playersData.players;
                players.forEach(async (playerDocument) => {
                await updatePlayer({ 
                    lobbyId, 
                    playerId: playerDocument.id, 
                    updates: {
                        life: lifeToSet,
                        damageToApply: 0,
                        infect: 0,
                        infectToApply: 0,
                        commanderDamages: []
                    }
                });
            });
            } catch (error) {
                console.error('Error in reset life button handler:', error);
            }
        });
    }
}

