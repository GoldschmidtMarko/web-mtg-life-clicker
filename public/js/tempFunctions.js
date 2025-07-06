import { firebaseConfig } from './firebaseConfig.js';
import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";
import { Player, Lobby } from './models.js';

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth(); // Although not strictly needed for this debug, keep for context
const functions = firebase.functions(); // Although not strictly needed for this debug, keep for context


export async function createLobbyClientSide(player) {

  // 1. Get the authenticated user
  const user = firebase.auth().currentUser;
  if (!user) {
    console.error("User not authenticated.");
    throw new Error("User not authenticated."); // Throw an error if user is not logged in
  }

  const userId = user.uid;
  const playerName = player.name || 'Player'; // Get player name from data

  // 2. Generate a unique lobby code (simple 6-character code)
  const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  console.log("Generating lobby code:", lobbyCode);

  // 3. Create the lobby in Cloud Firestore
  const db = firebase.firestore(); // Use client-side firestore
  const lobbyRef = db.collection('lobbies').doc(lobbyCode);

  const newLobby = new Lobby(
    lobbyCode, // You'll need to generate a unique lobby code
    userId,
    playerName,
    firebase.firestore.FieldValue.serverTimestamp(),
    firebase.firestore.FieldValue.serverTimestamp() // Initial lastUpdated timestamp
  );
  try {
    await lobbyRef.set(newLobby.toFirestoreObject());
    console.log("Lobby created in Firestore for code:", lobbyCode);
    await lobbyRef.collection('players').doc(userId).set(player.toFirestoreObject());
    console.log("Player added to players subcollection.");


    // 4. Return the lobby code to the client
    return { "lobbyCode": lobbyCode };

  } catch (error) {
    console.error("Error creating lobby in Firestore:", error);
    throw error; // Re-throw the error after logging
  }
}

export async function joinLobbyClientSide(player, lobbyCode) {
  // 1. Get the authenticated user
  const user = firebase.auth().currentUser;
  if (!user) {
    console.error("User not authenticated.");
    throw new Error("User not authenticated."); // Throw an error if user is not logged in
  }
  const db = firebase.firestore(); // Use client-side firestore
  const lobbyRef = db.collection('lobbies').doc(lobbyCode);
  console.log(player)
  lobbyRef.collection('players').doc(player.id).set(player.toFirestoreObject());
}
