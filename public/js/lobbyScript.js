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

const getPlayers = functions.httpsCallable('getPlayers');
const updatePlayer = functions.httpsCallable('updatePlayer');
const deletePlayer = functions.httpsCallable('deletePlayer');
const applyCombatDamage = functions.httpsCallable('applyCombatDamage');
const addPlayer = functions.httpsCallable('addPlayer');
const updateLobbyTimestamp = functions.httpsCallable('updateLobbyTimestamp');
const startTimer = functions.httpsCallable('startTimer');

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

// Redirect to index.html if no lobbyId is provided
if (!lobbyId) {
    window.location.href = 'index.html';
}

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
    document.body.classList.add('modal-open'); // Prevent body scroll

    // Remove previous event listeners to avoid multiple calls
    confirmRemoveButton.replaceWith(confirmRemoveButton.cloneNode(true));
    cancelRemoveButton.replaceWith(cancelRemoveButton.cloneNode(true));

    const newConfirmRemoveButton = document.getElementById('confirm-remove-button');
    const newCancelRemoveButton = document.getElementById('cancel-remove-button');

    function hideModal() {
        confirmationModal.classList.add('hidden');
        confirmationModal.classList.remove('flex');
        document.body.classList.remove('modal-open'); // Restore body scroll
    }

    newConfirmRemoveButton.addEventListener('click', async () => {
        await onConfirm();
        hideModal();
    });

    newCancelRemoveButton.addEventListener('click', () => {
        hideModal();
    });

    // Add click outside to close functionality
    confirmationModal.addEventListener('click', (event) => {
        // Check if the click was on the modal backdrop (not the modal content)
        if (event.target === confirmationModal) {
            hideModal();
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

function populatePlayerGridCommander(snapshot) {
    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)
    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const commanderDamages = playerData.commanderDamages;

        // Create modern player frame
        const playerFrame = document.createElement('button');
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;
        
        const fontSize = playerFrameHeight * 0.15;
        playerFrame.style.fontSize = `${fontSize}px`;

        // Modern name element
        const nameElement = document.createElement('div');
        nameElement.textContent = `${playerName}`;
        nameElement.style.fontWeight = 'bold';
        nameElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
        nameElement.style.marginBottom = '8px';
        playerFrame.appendChild(nameElement);

        if (commanderDamages && commanderDamages.length > 0) {
            for (const commanderDamage of commanderDamages) {
                const commanderName = commanderDamage.commanderName;
                const damage = commanderDamage.damage
                const lifeToApply = commanderDamage.lifeToApply
                
                const lifeElement = document.createElement('div');
                lifeElement.style.marginBottom = '4px';
                lifeElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
                lifeElement.style.fontSize = `${fontSize * 0.8}px`;
                
                if (lifeToApply === 0) {
                    lifeElement.innerHTML = `<span style="font-weight: bold;">${commanderName}:</span> <span style="font-weight: bold;">${damage}</span>`;
                } else if (lifeToApply > 0) {
                    lifeElement.innerHTML = `<span style="font-weight: bold;">${commanderName}:</span> <span style="font-weight: bold;">${damage}</span> <span style="color: #10b981; font-weight: bold;">(+${lifeToApply})</span>`;
                } else {
                    lifeElement.innerHTML = `<span style="font-weight: bold;">${commanderName}:</span> <span style="font-weight: bold;">${damage}</span> <span style="color: #ef4444; font-weight: bold;">(${lifeToApply})</span>`;
                }
                playerFrame.appendChild(lifeElement);
            }
        } else {
            // Show message when no commander damage
            const noCommanderElement = document.createElement('div');
            noCommanderElement.innerHTML = '<span style="opacity: 0.6; font-style: italic;">No Damage</span>';
            noCommanderElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
            playerFrame.appendChild(noCommanderElement);
        }

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)

        createPlayerFrameOverlayWithoutButtons(playerFrame)

        playerFrame.addEventListener('click', async () => {
            openCommanderModal(lobbyId, playerDocument, snapshot);
        });

        playerGrid.appendChild(playerFrame);

    });
}


function populatePlayerGridInfect(snapshot) {
    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)
    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const infectToApply = playerData.infectToApply;
        const infect = playerData.infect;

        // Create modern player frame
        const playerFrame = document.createElement('button');
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;
        
        const fontSize = playerFrameHeight * 0.15;
        playerFrame.style.fontSize = `${fontSize}px`;

        // Modern name element
        const nameElement = document.createElement('div');
        nameElement.textContent = `${playerName}`;
        nameElement.style.fontWeight = 'bold';
        nameElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
        playerFrame.appendChild(nameElement);

        // Modern infect display with enhanced styling
        const lifeElement = document.createElement('div');
        lifeElement.style.marginTop = '8px';
        lifeElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
        
        if (infectToApply === 0) {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Infect:</span><br><span style="font-size: 1.2em; font-weight: bold; color: #8b5cf6;">${infect}</span>`;
        } else if (infectToApply > 0) {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Infect:</span><br><span style="font-size: 1.2em; font-weight: bold; color: #8b5cf6;">${infect}</span> <span style="color: #10b981; font-weight: bold;">(+${infectToApply})</span>`;
        } else {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Infect:</span><br><span style="font-size: 1.2em; font-weight: bold; color: #8b5cf6;">${infect}</span> <span style="color: #ef4444; font-weight: bold;">(${infectToApply})</span>`;
        }
        playerFrame.appendChild(lifeElement);

        createPlayerFrameOverlay(playerFrame);

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "infectToApply");
        });

    });
}

function addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, frameHeight) {
    // Calculate button size based on frame height with better scaling
    const buttonSize = Math.max(16, Math.min(28, frameHeight * 0.1)); // Min 16px, max 28px, 10% of frame height
    const fontSize = Math.max(10, Math.min(18, frameHeight * 0.07)); // Min 10px, max 18px, 7% of frame height
    
    // Add the modern "X" button
    const removeButton = document.createElement('button');
    const playerName = playerDocument.data().name;
    removeButton.innerHTML = '<i class="fas fa-times"></i>'; // Modern X icon
    removeButton.classList.add('remove-player-button');
    
    // Set dynamic sizing with modern styling
    removeButton.style.width = `${buttonSize}px`;
    removeButton.style.height = `${buttonSize}px`;
    removeButton.style.fontSize = `${fontSize}px`;
    removeButton.style.color = '#ef4444'; // Red color for delete
    
    removeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        showConfirmationModal(`Are you sure you want to remove ${playerName}?`, async () => {
            // Get confirmation button to show loading state
            const confirmButton = document.getElementById('confirm-remove-button');
            if (confirmButton) {
                const originalText = confirmButton.textContent;
                const originalDisabled = confirmButton.disabled;
                
                try {
                    // Set loading state with modern styling
                    confirmButton.disabled = true;
                    confirmButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';
                    confirmButton.style.opacity = '0.8';
                    
                    await deletePlayer({ lobbyId, playerId: playerDocument.id });
                    
                    // Restore original state on success (modal will close anyway)
                    confirmButton.disabled = originalDisabled;
                    confirmButton.textContent = originalText;
                    confirmButton.style.opacity = '';
                } catch (error) {
                    console.error('Error deleting player:', error);
                    
                    // Restore original state on error
                    confirmButton.disabled = originalDisabled;
                    confirmButton.textContent = originalText;
                    confirmButton.style.opacity = '';
                }
            } else {
                // Fallback if button not found
                await deletePlayer({ lobbyId, playerId: playerDocument.id });
            }
        });
    });

    // Modern settings button
    const settingsButton = document.createElement('button');
    settingsButton.innerHTML = '<i class="fas fa-cog"></i>'; // Modern cog icon
    settingsButton.classList.add('settings-button');
    
    // Set dynamic sizing with modern styling
    settingsButton.style.width = `${buttonSize}px`;
    settingsButton.style.height = `${buttonSize}px`;
    settingsButton.style.fontSize = `${fontSize}px`;
    settingsButton.style.color = '#6366f1'; // Purple color for settings
    
    settingsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openSettingsModal(playerDocument.id, playerName);
    });
    
    playerFrame.appendChild(removeButton);
    playerFrame.appendChild(settingsButton);
}

function populatePlayerGridDefault(snapshot) {
    const playerGrid = document.getElementById('player-grid');
    playerGrid.innerHTML = ''; // Clear the current player grid
    const fixedButtons =  document.getElementById('bottom-controls');
    let playerFrameHeight = getPlayerFrameHeightFromSnapshot(snapshot, fixedButtons, 2)

    snapshot.forEach((playerDocument) => {
        const playerData = playerDocument.data();
        const playerName = playerData.name;
        const playerLife = playerData.life;
        const lifeToApply = playerData.lifeToApply;

        // Create modern player frame
        const playerFrame = document.createElement('button');
        playerFrame.style.backgroundColor = playerData.backgroundColor;
        playerFrame.style.color = playerData.fontColor;
        playerFrame.classList.add('player-frame');
        playerFrame.style.height = `${playerFrameHeight}px`;
        
        const fontSize = playerFrameHeight * 0.15;
        playerFrame.style.fontSize = `${fontSize}px`;

        // Modern name element with gradient text for better readability
        const nameElement = document.createElement('div');
        nameElement.textContent = `${playerName}`;
        nameElement.style.fontWeight = 'bold';
        nameElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
        playerFrame.appendChild(nameElement);
        
        // Modern life display with enhanced styling
        const lifeElement = document.createElement('div');
        lifeElement.style.marginTop = '8px';
        lifeElement.style.textShadow = '0 2px 4px rgba(0,0,0,0.3)';
        
        if (lifeToApply === 0) {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Life:</span><br><span style="font-size: 1.2em; font-weight: bold;">${playerLife}</span>`;
        } else if (lifeToApply > 0) {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Life:</span><br><span style="font-size: 1.2em; font-weight: bold;">${playerLife}</span> <span style="color: #10b981; font-weight: bold;">(+${lifeToApply})</span>`;
        } else {
            lifeElement.innerHTML = `<span style="font-size: 0.8em; opacity: 0.8;">Life:</span><br><span style="font-size: 1.2em; font-weight: bold;">${playerLife}</span> <span style="color: #ef4444; font-weight: bold;">(${lifeToApply})</span>`;
        }
        playerFrame.appendChild(lifeElement);

        addDeleteAndSettingIconToPlayerFrame(playerDocument, playerFrame, playerFrameHeight)
        playerGrid.appendChild(playerFrame);

        playerFrame.addEventListener('click', async (event) => {
            handlePlayerFrameClick(event, lobbyId, playerDocument, "lifeToApply");
        });

        createPlayerFrameOverlay(playerFrame);
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
    const buttonHeight = playerFrame.offsetHeight;
    const clickX = event.clientX - playerFrame.getBoundingClientRect().left;
    const clickY = event.clientY - playerFrame.getBoundingClientRect().top;
    let delta = 0;
    // Top half
    if (clickY < buttonHeight / 2) {
        // Left = -1, Right = +1
        if (clickX < buttonWidth / 2) {
            delta = -1;
        } else {
            delta = 1;
        }
    } else {
        // Bottom half
        // Left = -5, Right = +5
        if (clickX < buttonWidth / 2) {
            delta = -5;
        } else {
            delta = 5;
        }
    }

    try {
        // Add visual feedback for the click
        const originalOpacity = playerFrame.style.opacity;
        playerFrame.style.opacity = '0.7';
        playerFrame.style.transition = 'opacity 0.1s ease';
        
        const currentPlayer = playerSnapshot?.docs.find(doc => doc.id === playerDocument.id);
        if (!currentPlayer) return;
        const currentValue = currentPlayer.data()[attributeKey];

        await updatePlayer({ lobbyId, playerId: playerDocument.id, updates: { [attributeKey]: currentValue + delta } });
        // Update lobby last updated timestamp (optional)
        await updateLobbyTimestamp({ lobbyId });
        
        // Restore visual state
        setTimeout(() => {
            playerFrame.style.opacity = originalOpacity;
        }, 100);
    } catch (error) {
        console.error(`Error updating player attribute for ${playerDocument.id}:`, error);
        
        // Restore visual state on error
        playerFrame.style.opacity = '';
        
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
            // Store original button state
            const originalText = applyButton.textContent;
            const originalDisabled = applyButton.disabled;
            
            try {
                // Set loading state
                applyButton.disabled = true;
                applyButton.textContent = 'Applying...';
                applyButton.style.opacity = '0.6';
                applyButton.style.cursor = 'not-allowed';
                
                const playersResult = await getPlayers({ lobbyId });
                
                // Firebase callable functions return result.data
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result in apply:', playersData);
                    return;
                }
                
                const players = playersData.players;
                for (const playerDocument of players) {
                    // playerDocument here is the raw data object, not a Firestore document
                    const playerData = playerDocument.data || playerDocument; // Handle both formats
                    const currentLife = playerData.life || 0;
                    const lifeToApply = playerData.lifeToApply || 0;
                    const currentInfect = playerData.infect || 0;
                    const infectToApply = playerData.infectToApply || 0;
                    const commanderDamages = playerData.commanderDamages || [];
                    
                    var newLife = currentLife + lifeToApply;
                    var newInfect = currentInfect + infectToApply;
                    
                    for (const commanderDamage of commanderDamages) {
                        commanderDamage.damage += commanderDamage.lifeToApply;
                        newLife -= commanderDamage.lifeToApply;
                        commanderDamage.lifeToApply = 0;
                    }
                    
                    await updatePlayer({ 
                        lobbyId, 
                        playerId: playerDocument.id, 
                        updates: { 
                            life: newLife, 
                            lifeToApply: 0, 
                            infect: newInfect, 
                            infectToApply: 0, 
                            commanderDamages 
                        } 
                    });
                }
                
                // Restore original button state on success
                applyButton.disabled = originalDisabled;
                applyButton.textContent = originalText;
                applyButton.style.opacity = '';
                applyButton.style.cursor = '';
            } catch (error) {
                console.error('Error in apply button handler:', error);
                
                // Restore original button state on error
                applyButton.disabled = originalDisabled;
                applyButton.textContent = originalText;
                applyButton.style.opacity = '';
                applyButton.style.cursor = '';
            }
        });
    }
}

// Function for the Abort button handler
function setupAbortButton(lobbyId) {
    const abortButton = document.getElementById('abort-button');

    if (abortButton) {
        abortButton.addEventListener('click', async () => {
            // Store original button state
            const originalText = abortButton.textContent;
            const originalDisabled = abortButton.disabled;
            
            try {
                // Set loading state
                abortButton.disabled = true;
                abortButton.textContent = 'Aborting...';
                abortButton.style.opacity = '0.6';
                abortButton.style.cursor = 'not-allowed';
                
                const playersResult = await getPlayers({ lobbyId });
                
                // Firebase callable functions return result.data
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result in abort:', playersData);
                    return;
                }
                
                const players = playersData.players;
                for (const playerDocument of players) {
                    await updatePlayer({ lobbyId, playerId: playerDocument.id, updates: { lifeToApply: 0, infectToApply: 0 } });
                }
                
                // Restore original button state on success
                abortButton.disabled = originalDisabled;
                abortButton.textContent = originalText;
                abortButton.style.opacity = '';
                abortButton.style.cursor = '';
            } catch (error) {
                console.error('Error in abort button handler:', error);
                
                // Restore original button state on error
                abortButton.disabled = originalDisabled;
                abortButton.textContent = originalText;
                abortButton.style.opacity = '';
                abortButton.style.cursor = '';
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
            // Store original button state
            const originalText = dummyButton.textContent;
            const originalDisabled = dummyButton.disabled;
            
            try {
                // Set loading state
                dummyButton.disabled = true;
                dummyButton.textContent = 'Adding Player...';
                dummyButton.style.opacity = '0.6';
                dummyButton.style.cursor = 'not-allowed';
                
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
                
                await addPlayer({ lobbyId, player: player.toFirestoreObject() });
                
                // Restore original button state on success
                dummyButton.disabled = originalDisabled;
                dummyButton.textContent = originalText;
                dummyButton.style.opacity = '';
                dummyButton.style.cursor = '';
            } catch (error) {
                console.error('Error adding dummy player:', error);
                
                // Restore original button state on error
                dummyButton.disabled = originalDisabled;
                dummyButton.textContent = originalText;
                dummyButton.style.opacity = '';
                dummyButton.style.cursor = '';
            }
        });
    }
}


// Timer functionality
function setupTimerButton(lobbyId) {
    const timerButton = document.getElementById('timer');
    const timerInput = document.getElementById('timer-duration');
    if (timerButton && timerInput) {
        timerButton.addEventListener('click', async () => {
            // Store original button state
            const originalText = timerButton.textContent;
            const originalDisabled = timerButton.disabled;
            
            try {
                // Set loading state
                timerButton.disabled = true;
                timerButton.textContent = 'Starting Timer...';
                timerButton.style.opacity = '0.6';
                timerButton.style.cursor = 'not-allowed';
                
                const duration = parseInt(timerInput.value) || 5;
                await startTimer({ lobbyId, duration });
                
                // Restore original button state on success
                timerButton.disabled = originalDisabled;
                timerButton.textContent = originalText;
                timerButton.style.opacity = '';
                timerButton.style.cursor = '';
            } catch (error) {
                console.error('Error starting timer:', error);
                
                // Restore original button state on error
                timerButton.disabled = originalDisabled;
                timerButton.textContent = originalText;
                timerButton.style.opacity = '';
                timerButton.style.cursor = '';
            }
        });
    }
}

function listenToLobbyTimer(lobbyId) {
    const lobbyRef = firebase.firestore().collection('lobbies').doc(lobbyId);
    lobbyRef.onSnapshot(doc => {
        const data = doc.data();
        if (data && data.timerEnd) {
            showLobbyTimer(data.timerEnd);
        } else {
            hideLobbyTimer();
        }
    });
}

function showLobbyTimer(timerEnd) {
    // If timerEnd is not valid or already expired, remove timer display and return
    const now = Date.now();
    if (!timerEnd || isNaN(timerEnd) || timerEnd <= 0 || timerEnd < now) {
        hideLobbyTimer();
        return;
    }
    let timerDisplay = document.getElementById('lobby-timer-display');
    if (!timerDisplay) {
        timerDisplay = document.createElement('div');
        timerDisplay.id = 'lobby-timer-display';
        timerDisplay.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff;
            padding: 16px 32px;
            border-radius: 16px;
            font-size: 1.8em;
            font-weight: bold;
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            z-index: 10001;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(102, 126, 234, 0.2);
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            animation: timerSlideIn 0.5s ease-out;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        timerDisplay.title = 'Click to hide timer';
        timerDisplay.addEventListener('click', hideLobbyTimer);
        
        // Add hover effects
        timerDisplay.addEventListener('mouseenter', () => {
            timerDisplay.style.transform = 'translateX(-50%) scale(1.05)';
            timerDisplay.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.4), 0 6px 20px rgba(102, 126, 234, 0.3)';
        });
        
        timerDisplay.addEventListener('mouseleave', () => {
            timerDisplay.style.transform = 'translateX(-50%) scale(1)';
            timerDisplay.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(102, 126, 234, 0.2)';
        });
        
        // Add animation keyframes to document head
        if (!document.getElementById('timer-animations')) {
            const style = document.createElement('style');
            style.id = 'timer-animations';
            style.textContent = `
                @keyframes timerSlideIn {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                
                @keyframes timerPulse {
                    0%, 100% { transform: translateX(-50%) scale(1); }
                    50% { transform: translateX(-50%) scale(1.08); }
                }
                
                @keyframes timerUrgent {
                    0%, 100% { 
                        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                        box-shadow: 0 8px 32px rgba(239, 68, 68, 0.4), 0 4px 16px rgba(220, 38, 38, 0.3);
                    }
                    50% { 
                        background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
                        box-shadow: 0 12px 40px rgba(239, 68, 68, 0.6), 0 6px 20px rgba(220, 38, 38, 0.4);
                    }
                }
                
                /* Mobile responsive adjustments */
                @media (max-width: 768px) {
                    #lobby-timer-display {
                        font-size: 1.4em !important;
                        padding: 12px 24px !important;
                        top: 10px !important;
                        max-width: calc(100vw - 40px) !important;
                        box-sizing: border-box !important;
                    }
                }
                
                @media (max-width: 480px) {
                    #lobby-timer-display {
                        font-size: 1.2em !important;
                        padding: 10px 20px !important;
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(timerDisplay);
    }
    // Add audio element for last 10 seconds sound
    let timerAudio = document.getElementById('timer-audio');
    if (!timerAudio) {
        timerAudio = document.createElement('audio');
        timerAudio.id = 'timer-audio';
        timerAudio.src = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'; // royalty-free beep
        timerAudio.preload = 'auto';
        timerAudio.controls = false; // Hide controls now that audio works
        timerAudio.volume = 1.0; // Ensure volume is max
        timerAudio.style.position = 'fixed';
        timerAudio.style.bottom = '10px';
        timerAudio.style.left = '10px';
        timerAudio.style.zIndex = '10002';
        document.body.appendChild(timerAudio);
    }

    let lastBeepSecond = null;

    function updateTimer() {
        const now = Date.now();
        const msLeft = timerEnd - now;
        if (msLeft > 0) {
            const min = Math.floor(msLeft / 60000);
            const sec = Math.floor((msLeft % 60000) / 1000);
            const totalSeconds = Math.floor(msLeft / 1000);
            
            // Create timer icon with fallback
            const timerIcon = '<i class="fas fa-clock" style="font-size: 0.9em; opacity: 0.9;"></i>';
            const timerIconFallback = '⏱️';
            const timeText = `${min}:${sec.toString().padStart(2, '0')}`;
            
            // Check if Font Awesome is loaded, otherwise use emoji fallback
            const iconToUse = document.querySelector('.fas') ? timerIcon : timerIconFallback;
            
            // Update visual state based on time remaining
            if (totalSeconds <= 10) {
                // Critical state - red and pulsing
                timerDisplay.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                timerDisplay.style.animation = 'timerUrgent 1s infinite';
                timerDisplay.innerHTML = `${iconToUse} <span style="font-size: 1.1em;"> ${timeText}</span>`;
                
                // Play sound every second in last 10 seconds
                if (lastBeepSecond !== sec) {
                    lastBeepSecond = sec;
                    timerAudio.currentTime = 0;
                    timerAudio.volume = 1.0;
                    timerAudio.play().catch((err) => {
                        console.error('Timer audio play failed:', err);
                    });
                }
            } else if (totalSeconds <= 30) {
                // Warning state - orange and subtle pulse
                timerDisplay.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
                timerDisplay.style.animation = 'timerPulse 2s infinite';
                timerDisplay.innerHTML = `${iconToUse} <span>${timeText}</span>`;
            } else if (totalSeconds <= 60) {
                // Caution state - yellow
                timerDisplay.style.background = 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)';
                timerDisplay.style.animation = 'none';
                timerDisplay.innerHTML = `${iconToUse} <span>${timeText}</span>`;
            } else {
                // Normal state - blue/purple gradient
                timerDisplay.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                timerDisplay.style.animation = 'none';
                timerDisplay.innerHTML = `${iconToUse} <span>${timeText}</span>`;
            }
        } else {
            // Timer finished state
            timerDisplay.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            timerDisplay.style.animation = 'none';
            timerDisplay.innerHTML = '<span>Timer Finished!</span>';
            clearInterval(timerDisplay._interval);
            setTimeout(hideLobbyTimer, 5000);
        }
    }
    if (timerDisplay._interval) clearInterval(timerDisplay._interval);
    updateTimer();
    timerDisplay._interval = setInterval(updateTimer, 1000);
}

function hideLobbyTimer() {
    const timerDisplay = document.getElementById('lobby-timer-display');
    if (timerDisplay) {
        if (timerDisplay._interval) clearInterval(timerDisplay._interval);
        
        // Add smooth fade-out animation
        timerDisplay.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        timerDisplay.style.opacity = '0';
        timerDisplay.style.transform = 'translateX(-50%) translateY(-20px) scale(0.95)';
        
        // Remove element after animation completes
        setTimeout(() => {
            if (timerDisplay && timerDisplay.parentNode) {
                timerDisplay.remove();
            }
        }, 300);
    }
}

// --- Initialize Lobby ---
if (lobbyId) {
    initializeLobbyUI(lobbyId);
    initializeControls(lobbyId);
    setupPlayerListener(lobbyId);
    listenToLobbyTimer(lobbyId);
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
    setupTimerButton(lobbyId);
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
            // Store original button state
            const originalText = resetLifeButton.textContent;
            const originalDisabled = resetLifeButton.disabled;
            
            try {
                // Set loading state
                resetLifeButton.disabled = true;
                resetLifeButton.textContent = 'Resetting...';
                resetLifeButton.style.opacity = '0.6';
                resetLifeButton.style.cursor = 'not-allowed';
                
                const newLifeValue = parseInt(resetLifeInput.value);
                
                if (isNaN(newLifeValue) || newLifeValue <= 0) {
                    alert('Please enter a valid positive number for life.');
                    return;
                }
                
                const playersResult = await getPlayers({ lobbyId });
                const playersData = playersResult.data || playersResult;
                
                if (!playersData || !playersData.players) {
                    console.error('Invalid players result in reset life:', playersData);
                    return;
                }
                
                const players = playersData.players;
                for (const playerDocument of players) {
                    await updatePlayer({
                        lobbyId,
                        playerId: playerDocument.id,
                        updates: {
                            life: newLifeValue,
                            lifeToApply: 0,
                            infect: 0,
                            infectToApply: 0,
                            commanderDamages: []
                        }
                    });
                }
                
                // Restore original button state on success
                resetLifeButton.disabled = originalDisabled;
                resetLifeButton.textContent = originalText;
                resetLifeButton.style.opacity = '';
                resetLifeButton.style.cursor = '';
            } catch (error) {
                console.error('Error resetting life:', error);
                
                // Restore original button state on error
                resetLifeButton.disabled = originalDisabled;
                resetLifeButton.textContent = originalText;
                resetLifeButton.style.opacity = '';
                resetLifeButton.style.cursor = '';
            }
        });
    }
}

function createPlayerFrameOverlayWithoutButtons(playerFrame) {
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.className = 'player-frame-overlay';
    // Create 4 regions as squares
    for (let i = 0; i < 4; i++) {
        const div = document.createElement('div');
        div.className = 'overlay-square';
        overlay.appendChild(div);
    };
    
    playerFrame.appendChild(overlay);
}

export function createPlayerFrameOverlay(playerFrame) {
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.className = 'player-frame-overlay';

    // Create 4 regions as squares
    const regions = [
        { label: '-1', style: 'grid-row: 1; grid-column: 1;' },
        { label: '+1', style: 'grid-row: 1; grid-column: 2;' },
        { label: '-5', style: 'grid-row: 2; grid-column: 1;' },
        { label: '+5', style: 'grid-row: 2; grid-column: 2;' }
    ];
    regions.forEach((region) => {
        const div = document.createElement('div');
        div.className = 'overlay-square';
        div.textContent = region.label;
        div.style.cssText += region.style;
        overlay.appendChild(div);
    });
    playerFrame.appendChild(overlay);
}

