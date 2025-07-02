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
            const playerFrame = document.createElement('button'); // Change div to button
            playerFrame.classList.add('player-frame'); // Add a class for styling
            const nameElement = document.createElement('div');
            nameElement.textContent = `Name: ${playerName}`;
            playerFrame.appendChild(nameElement);
            const lifeElement = document.createElement('div');
            lifeElement.textContent = `Life: ${playerLife}`;
            playerFrame.appendChild(lifeElement);

            // Add event listener to the button
            playerFrame.addEventListener('click', async (event) => {
                const buttonWidth = playerFrame.offsetWidth;
                const clickX = event.clientX - playerFrame.getBoundingClientRect().left;
                try {
                    const latestPlayerLife = (await playersSubcollectionRef.doc(playerDocument.id).get()).data().life;
                    if (clickX < buttonWidth / 2) {
                        console.log(`Player: ${playerName}, id: ${playerDocument.id} | Life decreased`);
                        await playersSubcollectionRef.doc(playerDocument.id).update({ life: latestPlayerLife - 1 });
                    } else {
                        console.log(`Player: ${playerName}, id: ${playerDocument.id} | Life increased`);
                        await playersSubcollectionRef.doc(playerDocument.id).update({ life: latestPlayerLife + 1 });
                    }
                } catch (error) {
                    console.error(`Error updating player life for ${playerName}:`, error);
                }
            });
            playerGrid.appendChild(playerFrame);
        })
    })


    const dummyButton = document.getElementById('add-dummy-player-button');
    const randomNames = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"]
    dummyButton.addEventListener('click', async () => {
        playersSubcollectionRef.add({
            name: randomNames[Math.floor(Math.random() * randomNames.length)],
            life: Math.floor(Math.random() * 100)
        })
    })

    const removeDummyButton = document.getElementById('remove-dummy-player-button');
    removeDummyButton.addEventListener('click', async () => {
        const querySnapshot = await playersSubcollectionRef.get();
        if (!querySnapshot.empty) {
            // Get a random document from the snapshot
            const randomIndex = Math.floor(Math.random() * querySnapshot.docs.length);
            const docToDelete = querySnapshot.docs[randomIndex];
            await playersSubcollectionRef.doc(docToDelete.id).delete();
        }
    })


} else {
    console.error("Lobby ID not found!");
    // Optionally redirect the user or display an error message
}

// Add event listener for the exit button (assuming an element with id="exit-lobby-button" exists)
document.getElementById('exit-lobby-button').addEventListener('click', () => {
    // Implement logic to remove player from lobby and redirect
    console.log("Exit button clicked");
    // Example: signOut(auth).then(() => { window.location.href = 'index.html'; });
});

