const { initializeApp } = require("firebase-admin/app");

const {setGlobalOptions} = require("firebase-functions");
setGlobalOptions({
  maxInstances: 10, 
  region: "europe-west4"
});

initializeApp();  // <- This must be called BEFORE getFirestore()

const {onCall} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

// Configure Firestore to use emulator when running locally
const db = getFirestore();
if (process.env.FUNCTIONS_EMULATOR === "true") {
  // Set environment variable for Firestore emulator
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
}

// Database operation tracking
let readCount = 0;
let writeCount = 0;

function trackRead(operation) {
  readCount++;
  return readCount;
}

function trackWrite(operation) {
  writeCount++;
  return writeCount;
}

// Helper to check auth in callable functions
function authenticateUser(auth) {
  if (!auth) {
    throw new Error("Unauthenticated. User must be signed in.");
  }
}

// Create a lobby, given player data (callable function)
exports.createLobby = onCall({
  cors: true,
  timeoutSeconds: 10
}, async (req) => {
  const player = req.data; // req.data IS the player object
  authenticateUser(req.auth);
  const userId = req.auth.uid;
  const playerName = player.name || "Player";

  // Generate simple lobby code
  const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // Create lobby object based on your Lobby class shape:
  const newLobby = {
    code: lobbyCode,
    ownerId: userId,
    ownerName: playerName,
    createdAt: FieldValue.serverTimestamp(),
    lastUpdated: FieldValue.serverTimestamp(),
  };

  try {
    const lobbyRef = db.collection("lobbies").doc(lobbyCode);
    await lobbyRef.set(newLobby);
    trackWrite("createLobby - lobby creation");

    // Add the player to the lobby's players subcollection
    await lobbyRef.collection("players").doc(userId).set(player);
    trackWrite("createLobby - player addition");

    return {lobbyCode};
  } catch (err) {
    console.error("Error creating lobby:", err);
    throw new Error("Failed to create lobby");
  }
});

// Join a lobby (callable)
exports.joinLobby = onCall({
  cors: true
}, async (req) => {
  const {player, lobbyCode} = req.data;
  authenticateUser(req.auth);

  const lobbyRef = db.collection("lobbies").doc(lobbyCode);
  await lobbyRef.collection("players").doc(player.id).set(player);
  trackWrite("joinLobby - player addition");

  return {success: true};
});

// Get all players in a lobby
exports.getPlayers = onCall({
  cors: true
}, async (req) => {
  const {lobbyId} = req.data;
  authenticateUser(req.auth);

  const playersSnapshot = await db.collection("lobbies")
      .doc(lobbyId).collection("players").get();
  trackRead(`getPlayers - ${playersSnapshot.docs.length} players`);

  const players = [];
  playersSnapshot.forEach((doc) => {
    const data = doc.data();
    // Remove the id field from data to avoid conflicts with doc.id
    const { id, ...dataWithoutId } = data;
    players.push({id: doc.id, ...dataWithoutId});
  });

  return {players};
});

// Update a player in a lobby
exports.updatePlayer = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId, updates} = req.data;
  authenticateUser(req.auth);

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new Error("Missing or invalid lobbyId parameter");
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new Error("Missing or invalid playerId parameter");
  }
  if (!updates || typeof updates !== 'object') {
    throw new Error("Missing or invalid updates parameter");
  }

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update(updates);
  trackWrite(`updatePlayer - ${playerId} fields: ${Object.keys(updates).join(', ')}`);

  return {success: true};
});

// Delete a player from a lobby
exports.deletePlayer = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId} = req.data;
  authenticateUser(req.auth);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.delete();
  trackWrite(`deletePlayer - ${playerId}`);

  return {success: true};
});

// Increment a player's field (e.g. life, score)
exports.incrementPlayerField = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId, field, value} = req.data;
  authenticateUser(req.auth);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update({[field]: FieldValue.increment(value)});
  trackWrite(`incrementPlayerField - ${playerId} ${field} by ${value}`);

  return {success: true};
});

// Update commander damages in a transaction
exports.updateCommanderDamage = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId, commanderDamages} = req.data;
  authenticateUser(req.auth);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(playerRef);
    trackRead(`updateCommanderDamage - get player ${playerId}`);
    if (!doc.exists) throw new Error("Player document does not exist");

    transaction.update(playerRef, {commanderDamages});
    trackWrite(`updateCommanderDamage - update player ${playerId}`);
  });

  return {success: true};
});

// Apply combat damage transaction
exports.applyCombatDamage = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId} = req.data;
  authenticateUser(req.auth);

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new Error("Missing or invalid lobbyId parameter");
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new Error("Missing or invalid playerId parameter");
  }

  try {
    const playerRef = db.collection("lobbies")
        .doc(lobbyId).collection("players").doc(playerId);

    const result = await db.runTransaction(async (transaction) => {
      try {
        const playerDoc = await transaction.get(playerRef);
        trackRead(`applyCombatDamage - get player ${playerId}`);
        
        if (!playerDoc.exists) {
          throw new Error(`Player document does not exist: ${playerId}`);
        }

        const playerData = playerDoc.data();

        // Validate player data structure
        if (typeof playerData.life !== 'number') {
          console.error(`Invalid life value for player ${playerId}:`, playerData.life);
          throw new Error(`Player ${playerId} has invalid life value: ${playerData.life}`);
        }

        let commanderDamages = playerData.commanderDamages || [];
        let totalCommanderDamageToApply = 0;

        // Validate commanderDamages structure
        if (!Array.isArray(commanderDamages)) {
          console.error(`Invalid commanderDamages for player ${playerId}:`, commanderDamages);
          commanderDamages = [];
        }

        commanderDamages = commanderDamages.map((cd) => {
          if (typeof cd.damageToApply !== 'number' || typeof cd.damage !== 'number') {
            console.error(`Invalid commander damage data for player ${playerId}:`, cd);
            return cd; // Return as-is to avoid breaking
          }
          totalCommanderDamageToApply += cd.damageToApply;
          return {
            ...cd,
            damage: cd.damage + cd.damageToApply,
            damageToApply: 0,
          };
        });

        const damageToApply = typeof playerData.damageToApply === 'number' ? playerData.damageToApply : 0;
        const infect = typeof playerData.infect === 'number' ? playerData.infect : 0;
        const infectToApply = typeof playerData.infectToApply === 'number' ? playerData.infectToApply : 0;

        const newLife = playerData.life - totalCommanderDamageToApply + damageToApply;
        const newInfect = infect + infectToApply;

        const updateData = {
          commanderDamages,
          life: newLife,
          infect: newInfect,
          damageToApply: 0,
          infectToApply: 0,
        };

        // Validate update data before applying
        if (typeof updateData.life !== 'number' || typeof updateData.infect !== 'number') {
          throw new Error(`Invalid update data for player ${playerId}: life=${updateData.life}, infect=${updateData.infect}`);
        }
        
        transaction.update(playerRef, updateData);
        trackWrite(`applyCombatDamage - update player ${playerId}`);

        return playerData;
      } catch (transactionError) {
        console.error(`Transaction error for player ${playerId}:`, transactionError);
        throw transactionError;
      }
    });

    return {success: true, data: result};
  } catch (error) {
    console.error(`applyCombatDamage error for ${playerId}:`, error);
    throw new Error(`Failed to apply combat damage for player ${playerId}: ${error.message}`);
  }
});

exports.addPlayer = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, player} = req.data;
  authenticateUser(req.auth);

  if (!lobbyId || !player) throw new Error("Missing lobbyId or player");

  const playersRef = db.collection('lobbies').doc(lobbyId).collection('players');

  // Extract the id from player data and use it as document ID
  const playerId = player.id;
  const playerData = { ...player };
  delete playerData.id; // Remove id from data since it will be the document ID

  if (playerId) {
    await playersRef.doc(playerId).set(playerData);
  } else {
    await playersRef.add(playerData); // Fallback to auto-generated ID
  }
  
  trackWrite(`addPlayer - add player to lobby ${lobbyId}`);
  return { success: true };
});

// Update lobby timestamp
exports.updateLobbyTimestamp = onCall({
  cors: true
}, async (req) => {
  const { lobbyId } = req.data;
  authenticateUser(req.auth);

  const lobbyRef = db.collection('lobbies').doc(lobbyId);
  await lobbyRef.update({
    lastUpdated: FieldValue.serverTimestamp()
  });
  trackWrite(`updateLobbyTimestamp - lobby ${lobbyId}`);
  
  return { success: true };
});

// Update player settings (name, colors, etc.)
exports.updatePlayerSettings = onCall({
  cors: true
}, async (req) => {
  const {lobbyId, playerId, settings} = req.data;
  authenticateUser(req.auth);

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new Error("Missing or invalid lobbyId parameter");
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new Error("Missing or invalid playerId parameter");
  }
  if (!settings || typeof settings !== 'object') {
    throw new Error("Missing or invalid settings parameter");
  }

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  // Validate that the player exists
  const playerDoc = await playerRef.get();
  trackRead(`updatePlayerSettings - get player ${playerId}`);
  
  if (!playerDoc.exists) {
    throw new Error(`Player document does not exist: ${playerId}`);
  }

  // Update the player settings
  await playerRef.update(settings);
  trackWrite(`updatePlayerSettings - update player ${playerId}`);
  
  return { success: true };
});
