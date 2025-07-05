import { firebaseConfig } from './firebaseConfig.js';
import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";

// Initialize Firebase
// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); // Although not strictly needed for this debug, keep for context
const functions = firebase.functions(); // Although not strictly needed for this debug, keep for context

const lobbyCollectionName = "lobbies"
const playerCollectionName = "players"

// Get lobby ID from URL or wherever it's stored
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobbyId'); // Assuming you pass lobbyId in the URL







if (lobbyId) {
    const playerGrid = document.getElementById('player-grid');
    const lobbyNumberElement = document.getElementById('lobby-number');
    // Display lobby number
    if (lobbyNumberElement) {
        lobbyNumberElement.textContent = `Lobby: ${lobbyId}`;
    }



    // Debug test: Read "gero" collection and log
    const playersSubcollectionRef = firebase.firestore().collection(lobbyCollectionName).doc(lobbyId).collection(playerCollectionName);

    // Set up a real-time listener for changes in the 'players' subcollection
    playersSubcollectionRef.onSnapshot(async (snapshot) => {
        console.log("Players subcollection updated!");
        // Clear the current player grid to avoid duplicates
        playerGrid.innerHTML = '';
        snapshot.forEach((playerDocument) => {
            const playerName = playerDocument.data().name;
            const playerLife = playerDocument.data().life;
            const damageToAppy = playerDocument.data().damageToAppy;
            const playerFrame = document.createElement('button'); // Change div to button
            playerFrame.classList.add('player-frame'); // Add a class for styling
            const nameElement = document.createElement('div');
            nameElement.textContent = `Name: ${playerName}`;
            playerFrame.appendChild(nameElement);
            const lifeElement = document.createElement('div');
            if (damageToAppy == 0) {
                lifeElement.textContent = `Life: ${playerLife}`;
            }else if (damageToAppy > 0) {
                lifeElement.textContent = `Life: ${playerLife} (+${damageToAppy})`;
            } else {
                lifeElement.textContent = `Life: ${playerLife} (${damageToAppy})`;
            }
            playerFrame.appendChild(lifeElement);

            // Add the "X" button
            const removeButton = document.createElement('button');
            removeButton.textContent = 'X';
            removeButton.classList.add('remove-player-button'); // Add a class for styling
            removeButton.addEventListener('click', async (event) => {
                event.stopPropagation(); // Prevent the click from triggering the playerFrame's life update
                showConfirmationModal(`Are you sure you want to remove ${playerName}?`, async () => {
                    await playersSubcollectionRef.doc(playerDocument.id).delete();
                });
            });

            // Store the playerDocument.id on the remove button for later use in the modal confirmation
            removeButton.dataset.playerId = playerDocument.id;

            // Add event listener to the button
            playerFrame.addEventListener('click', async (event) => {
                const buttonWidth = playerFrame.offsetWidth;
                const clickX = event.clientX - playerFrame.getBoundingClientRect().left;
                try {
                    const latestDamageToApplay = (await playersSubcollectionRef.doc(playerDocument.id).get()).data().damageToAppy;
                    if (clickX < buttonWidth / 2) {
                        console.log(`Player: ${playerName}, id: ${playerDocument.id} | Life decreased`);
                        await playersSubcollectionRef.doc(playerDocument.id).update({ damageToAppy: latestDamageToApplay - 1 });
                    } else {
                        console.log(`Player: ${playerName}, id: ${playerDocument.id} | Life increased`);
                        await playersSubcollectionRef.doc(playerDocument.id).update({ damageToAppy: latestDamageToApplay + 1 });
                    }
                } catch (error) {
                    console.error(`Error updating player life for ${playerName}:`, error);
                }
            });

            playerFrame.prepend(removeButton); // Add the remove button before other elements
            playerGrid.appendChild(playerFrame);
        })
    })

    const applyButton = document.getElementById('apply-button');
    applyButton.addEventListener('click', async () => {
        // Get all players from the subcollection
        const players = await playersSubcollectionRef.get();
        players.forEach(async (playerDocument) => {
            await playersSubcollectionRef.doc(playerDocument.id).update({
                life: firebase.firestore.FieldValue.increment(playerDocument.data().damageToAppy),
                damageToAppy: 0
            });
        });
    });

    const abortButton = document.getElementById('abort-button');
    abortButton.addEventListener('click', async () => {
        // Reset all players' damageToAppy to 0
        const players = await playersSubcollectionRef.get();
        players.forEach(async (playerDocument) => {
            await playersSubcollectionRef.doc(playerDocument.id).update({ damageToAppy: 0 });
        });
    });


    const dummyButton = document.getElementById('add-dummy-player-button');
    const randomNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"]
    dummyButton.addEventListener('click', async () => {
        playersSubcollectionRef.add({
            name: randomNames[Math.floor(Math.random() * randomNames.length)],
            life: Math.floor(Math.random() * 100),
            damageToAppy: 0
        })
    })

} else {
    console.error("Lobby ID not found!");
    // Optionally redirect the user or display an error message
}



// Modal functionality
const modal = document.getElementById('confirmation-modal');
const confirmButton = document.getElementById('confirm-remove-button');
const cancelButton = document.getElementById('cancel-remove-button');
let currentConfirmAction = null; // Variable to hold the function to execute on confirmation
const modalMessage = document.getElementById('modal-Message');
function showConfirmationModal(message, confirmAction) {
    modalMessage.textContent = message;
    modal.style.display = 'block';
    currentConfirmAction = confirmAction;
}

function hideConfirmationModal() {
    modal.style.display = 'none';
    currentConfirmAction = null; // Clear the action
}

confirmButton.addEventListener('click', () => {
    if (currentConfirmAction) {
        currentConfirmAction();
    }
    hideConfirmationModal();
});

cancelButton.addEventListener('click', hideConfirmationModal);


// Add event listener for the exit button (assuming an element with id="exit-lobby-button" exists)
document.getElementById('exit-lobby-button').addEventListener('click', () => {
    // go back to index.html
    window.location.href = '../index.html';
    
});

