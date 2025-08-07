const { initializeApp } = require("firebase-admin/app");

const {setGlobalOptions} = require("firebase-functions");
setGlobalOptions({cors: true, maxInstances: 10, region: "europe-west4"});

initializeApp();  // <- This must be called BEFORE getFirestore()

const {onCall} = require("firebase-functions/v2/https");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const db = getFirestore();

// Helper to check auth in callable functions
function authenticateUser(context) {
  if (!context.auth) {
    throw new Error("Unauthenticated. User must be signed in.");
  }
}

// Create a lobby, given player data (callable function)
exports.createLobby = onCall(async (req) => {
  const {player} = req.data;
  const context = req.context;
  authenticateUser(context);

  const userId = context.auth.uid;
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

    // Add the player to the lobby's players subcollection
    await lobbyRef.collection("players").doc(userId).set(player);

    return {lobbyCode};
  } catch (err) {
    console.error("Error creating lobby:", err);
    throw new Error("Failed to create lobby");
  }
});

// Join a lobby (callable)
exports.joinLobby = onCall(async (req) => {
  const {player, lobbyCode} = req.data;
  const context = req.context;
  authenticateUser(context);

  const lobbyRef = db.collection("lobbies").doc(lobbyCode);
  await lobbyRef.collection("players").doc(player.id).set(player);

  return {success: true};
});

// Get all players in a lobby
exports.getPlayers = onCall(async (req) => {
  const {lobbyId} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playersSnapshot = await db.collection("lobbies")
      .doc(lobbyId).collection("players").get();

  const players = [];
  playersSnapshot.forEach((doc) => players.push({id: doc.id, ...doc.data()}));

  return {players};
});

// Update a player in a lobby
exports.updatePlayer = onCall(async (req) => {
  const {lobbyId, playerId, updates} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update(updates);

  return {success: true};
});

// Delete a player from a lobby
exports.deletePlayer = onCall(async (req) => {
  const {lobbyId, playerId} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.delete();

  return {success: true};
});

// Increment a player's field (e.g. life, score)
exports.incrementPlayerField = onCall(async (req) => {
  const {lobbyId, playerId, field, value} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update({[field]: FieldValue.increment(value)});

  return {success: true};
});

// Update commander damages in a transaction
exports.updateCommanderDamage = onCall(async (req) => {
  const {lobbyId, playerId, commanderDamages} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(playerRef);
    if (!doc.exists) throw new Error("Player document does not exist");

    transaction.update(playerRef, {commanderDamages});
  });

  return {success: true};
});

// Apply combat damage transaction
exports.applyCombatDamage = onCall(async (req) => {
  const {lobbyId, playerId} = req.data;
  const context = req.context;
  authenticateUser(context);

  const playerRef = db.collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  const result = await db.runTransaction(async (transaction) => {
    const playerDoc = await transaction.get(playerRef);
    if (!playerDoc.exists) throw new Error("Player document does not exist");

    const playerData = playerDoc.data();

    let commanderDamages = playerData.commanderDamages || [];
    let totalCommanderDamageToApply = 0;

    commanderDamages = commanderDamages.map((cd) => {
      totalCommanderDamageToApply += cd.damageToApply;
      return {
        ...cd,
        damage: cd.damage + cd.damageToApply,
        damageToApply: 0,
      };
    });

    const newLife = playerData.life - totalCommanderDamageToApply +
        (playerData.damageToApply || 0);
    const newInfect = (playerData.infect || 0) +
        (playerData.infectToApply || 0);

    transaction.update(playerRef, {
      commanderDamages,
      life: newLife,
      infect: newInfect,
      damageToApply: 0,
      infectToApply: 0,
    });

    return playerData;
  });

  return {success: true, data: result};
});

exports.addPlayer = onCall(async (req) => {
  const {lobbyId, player} = req.data;
  const context = req.context;
  authenticateUser(context);

  if (!lobbyId || !player) throw new Error("Missing lobbyId or player");

  const playersRef = db.collection('lobbies').doc(lobbyId).collection('players');

  await playersRef.add(player); // assumes `player` is a plain object ready for Firestore
  return { success: true };
});
