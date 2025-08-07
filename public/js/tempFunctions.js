import { firebaseConfig } from './util/firebaseConfig.js';
import "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js";
import { Lobby } from './util/models.js';

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const functions = firebase.functions();

let readCount = 0;
let writeCount = 0;

function trackRead(promise) {
  readCount++;
  return promise;
}

function trackWrite(promise) {
  writeCount++;
  return promise;
}


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
    await trackWrite(lobbyRef.set(newLobby.toFirestoreObject()));
    console.log("Lobby created in Firestore for code:", lobbyCode);
    await trackWrite(lobbyRef.collection('players').doc(userId).set(player.toFirestoreObject()));
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
  await trackWrite(lobbyRef.collection('players').doc(player.id).set(player.toFirestoreObject()));

}


export function listenToPlayers(lobbyId, callback) {
  return firebase.firestore()
    .collection('lobbies')
    .doc(lobbyId)
    .collection('players')
    .onSnapshot(snapshot => {
      readCount += snapshot.docs.length;
      callback(snapshot);
    });
}

export async function getPlayers(lobbyId) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players');
  return await trackRead(ref.get());
}

export async function updatePlayer(lobbyId, playerId, updates) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
  return await trackWrite(ref.update(updates));
}

export async function deletePlayer(lobbyId, playerId) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
  return await trackWrite(ref.delete());
}

export async function addPlayer(lobbyId, player) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players');
  return await trackWrite(ref.add(player.toFirestoreObject()));
}

export async function updateLobbyTimestamp(lobbyId) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId);
  return await trackWrite(ref.update({ lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }));
}

export async function incrementPlayerField(lobbyId, playerId, field, value) {
  const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
  return await trackWrite(ref.update({ [field]: firebase.firestore.FieldValue.increment(value) }));
}

export function getServerTimestamp() {
    return firebase.firestore.FieldValue.serverTimestamp();
}

export async function updatePlayerSettings(lobbyId, playerId, settings) {
    const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
    return await trackWrite(ref.update(settings));
}

export async function updateCommanderDamage(lobbyId, playerId, commanderDamages) {
    const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
    return await firebase.firestore().runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        readCount++;
        if (!doc.exists) {
            throw "Document does not exist!";
        }
        writeCount++;
        transaction.update(ref, { commanderDamages: commanderDamages });
    });
}

export async function getPlayer(lobbyId, playerId) {
    const ref = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);
    return await trackRead(ref.get());
}

export async function applyCombatDamage(lobbyId, playerId) {
    const playerRef = firebase.firestore().collection('lobbies').doc(lobbyId).collection('players').doc(playerId);

    return await firebase.firestore().runTransaction(async (transaction) => {
        const playerDoc = await transaction.get(playerRef);
        readCount++;
        if (!playerDoc.exists) {
            throw "Player document does not exist!";
        }

        const playerData = playerDoc.data();
        let commanderDamages = playerData.commanderDamages || [];
        let totalCommanderDamageToApply = 0;

        // Update commander damages and calculate total damage to apply
        commanderDamages = commanderDamages.map(cd => {
            totalCommanderDamageToApply += cd.damageToApply;
            return {
                ...cd,
                damage: cd.damage + cd.damageToApply,
                damageToApply: 0
            };
        });

        // Calculate new life and infect
        const newLife = playerData.life - totalCommanderDamageToApply + playerData.damageToApply; // Subtract commander damage, add regular damage
        const newInfect = playerData.infect + playerData.infectToApply;

        // Update the player document
        transaction.update(playerRef, {
            commanderDamages: commanderDamages,
            life: newLife,
            infect: newInfect,
            damageToApply: 0,
            infectToApply: 0
        });
        writeCount++;

        // Return updated data for potential UI refresh (optional)
        return playerDoc.data();
    });
}

export function getFirestoreUsageStats() {
  return { reads: readCount, writes: writeCount };
}
