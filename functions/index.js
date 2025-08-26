const { initializeApp } = require("firebase-admin/app");

const {setGlobalOptions} = require("firebase-functions");
setGlobalOptions({
  maxInstances: 10, 
  region: "europe-west4"
});

initializeApp();  // <- This must be called BEFORE getFirestore()

const {onCall, HttpsError} = require("firebase-functions/v2/https");
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

// Rate limiting storage (in production, use Redis or Firestore)
const rateLimitStore = new Map();

// Rate limiting function
function checkRateLimit(userId, action, maxRequests = 10, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  const userData = rateLimitStore.get(key);
  
  // Reset if window has passed
  if (now > userData.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  // Check if under limit
  if (userData.count < maxRequests) {
    userData.count++;
    return true;
  }
  
  return false; // Rate limit exceeded
}

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

// Advanced debouncing using Firestore for persistence
async function checkFirestoreRateLimit(userId, action, maxRequests = 10, windowMs = 60000) {
  const rateLimitRef = db.collection('rateLimits').doc(`${userId}_${action}`);
  const now = Date.now();
  
  try {
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        // First request - create document
        transaction.set(rateLimitRef, {
          count: 1,
          resetTime: now + windowMs,
          lastRequest: now
        });
        return true;
      }
      
      const data = doc.data();
      
      // Reset if window has passed
      if (now > data.resetTime) {
        transaction.update(rateLimitRef, {
          count: 1,
          resetTime: now + windowMs,
          lastRequest: now
        });
        return true;
      }
      
      // Check if under limit
      if (data.count < maxRequests) {
        transaction.update(rateLimitRef, {
          count: data.count + 1,
          lastRequest: now
        });
        return true;
      }
      
      return false; // Rate limit exceeded
    });
    
    return result;
  } catch (error) {
    console.error('Firestore rate limit check failed:', error);
    // Fall back to memory-based rate limiting
    return checkRateLimit(userId, action, maxRequests, windowMs);
  }
}

// Debouncing for frequent updates - only allow if enough time has passed
async function shouldDebounceUpdate(userId, playerId, field, minIntervalMs = 100) {
  const debounceKey = `debounce_${userId}_${playerId}_${field}`;
  const rateLimitRef = db.collection('rateLimits').doc(debounceKey);
  const now = Date.now();
  
  try {
    const result = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        // First update - allow it
        transaction.set(rateLimitRef, {
          lastUpdate: now,
          expiresAt: now + (24 * 60 * 60 * 1000) // 24 hours TTL
        });
        return false; // Don't debounce
      }
      
      const data = doc.data();
      const timeSinceLastUpdate = now - data.lastUpdate;
      
      if (timeSinceLastUpdate >= minIntervalMs) {
        // Enough time has passed - allow update
        transaction.update(rateLimitRef, {
          lastUpdate: now,
          expiresAt: now + (24 * 60 * 60 * 1000)
        });
        return false; // Don't debounce
      }
      
      return true; // Should debounce (too soon)
    });
    
    return result;
  } catch (error) {
    console.error('Debounce check failed:', error);
    return false; // Default to allowing the update
  }
}

// Helper to check auth in callable functions
function authenticateUser(auth) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be signed in.');
  }
}

// Save or update player data when user signs in
exports.savePlayerData = onCall({
  cors: true,
  timeoutSeconds: 10
}, async (req) => {
  authenticateUser(req.auth);
  const userId = req.auth.uid;
  
  // Get user info from Firebase Auth token
  const userRecord = req.auth;
  
  const playerData = {
    name: userRecord.token.name || 'Unknown',
    email: userRecord.token.email || '',
    lastLogin: FieldValue.serverTimestamp(),
    uid: userId
  };

  try {
    // Use set with merge option to create or update the document
    await db.collection('players').doc(userId).set(playerData, { merge: true });
    trackWrite("savePlayerData - player data save");
    
    return { success: true, message: 'Player data saved successfully' };
  } catch (error) {
    console.error('Error saving player data:', error);
    throw new HttpsError('internal', 'Failed to save player data. Please try again.');
  }
});

// Create a lobby, given player data (callable function)
exports.createLobby = onCall({
  cors: true,
  timeoutSeconds: 10
}, async (req) => {
  const player = req.data; // req.data IS the player object
  authenticateUser(req.auth);
  const userId = req.auth.uid;
  const playerName = player.name || "Player";

  // Rate limiting: max 3 lobbies per 5 minutes per user
  if (!checkRateLimit(userId, 'createLobby', 3, 300000)) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. You can only create 3 lobbies per 5 minutes.');
  }

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
    throw new HttpsError('internal', 'Failed to create lobby. Please try again.');
  }
});

// Join a lobby (callable)
exports.joinLobby = onCall({
  cors: true
}, async (req) => {
  const {player, lobbyCode} = req.data;
  authenticateUser(req.auth);
  const userId = req.auth.uid;

  // Validate required parameters
  if (!lobbyCode || typeof lobbyCode !== 'string' || lobbyCode.trim() === '') {
    throw new HttpsError('invalid-argument', 'Missing or invalid lobby code');
  }
  if (!player || typeof player !== 'object') {
    throw new HttpsError('invalid-argument', 'Missing or invalid player data');
  }

  // Validate that the player has an ID (should be the user's UID)
  const playerId = player.id || userId;
  if (!playerId || typeof playerId !== 'string') {
    throw new HttpsError('invalid-argument', 'Invalid player ID');
  }

  try {
    // Check if lobby exists
    const lobbyRef = db.collection("lobbies").doc(lobbyCode);
    const lobbyDoc = await lobbyRef.get();
    
    if (!lobbyDoc.exists) {
      throw new HttpsError('not-found', 'Lobby not found. Please check the lobby code.');
    }

    // Add player to the lobby
    const playerData = {...player, id: playerId}; // Ensure ID is set
    await lobbyRef.collection("players").doc(playerId).set(playerData);
    trackWrite("joinLobby - player addition");

    return {success: true, lobbyCode};
  } catch (error) {
    console.error("Error joining lobby:", error);
    
    // Re-throw HttpsError instances
    if (error.code && error.code.startsWith('functions/')) {
      throw error;
    }
    
    // Wrap other errors
    throw new HttpsError('internal', 'Failed to join lobby. Please try again.');
  }
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
  const userId = req.auth.uid;

  // Use Firestore-based rate limiting for persistent tracking
  if (!(await checkFirestoreRateLimit(userId, 'updatePlayer', 50, 60000))) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please slow down your requests.');
  }

  // Additional rate limiting per player being updated to prevent targeting
  const playerUpdateKey = `updatePlayer_${playerId}`;
  if (!(await checkFirestoreRateLimit(userId, playerUpdateKey, 30, 60000))) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded for this player. Please slow down.');
  }

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new HttpsError('invalid-argument', 'Missing or invalid lobbyId parameter');
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new HttpsError('invalid-argument', 'Missing or invalid playerId parameter');
  }
  if (!updates || typeof updates !== 'object') {
    throw new HttpsError('invalid-argument', 'Missing or invalid updates parameter');
  }

  // Validate update values to prevent abuse
  for (const [key, value] of Object.entries(updates)) {
    if (typeof value === 'number' && Math.abs(value) > 10000) {
      throw new HttpsError('invalid-argument', `Update value too large for field ${key}. Maximum allowed: ±10000`);
    }
    if (typeof value === 'string' && value.length > 500) {
      throw new HttpsError('invalid-argument', `String value too long for field ${key}. Maximum 500 characters.`);
    }
  }

  // Check for debouncing on frequently updated fields
  const frequentFields = ['damageToApply', 'infectToApply', 'life'];
  for (const field of Object.keys(updates)) {
    if (frequentFields.includes(field)) {
      const shouldDebounce = await shouldDebounceUpdate(userId, playerId, field, 50); // 50ms minimum interval
      if (shouldDebounce) {
        throw new HttpsError('resource-exhausted', `Update too frequent for field ${field}. Please slow down.`);
      }
    }
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
  const userId = req.auth.uid;

  // Rate limiting: max 30 increments per minute per user
  if (!checkRateLimit(userId, 'incrementPlayerField', 30, 60000)) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please slow down your requests.');
  }

  // Validate input
  if (Math.abs(value) > 1000) {
    throw new HttpsError('invalid-argument', 'Value change too large. Maximum allowed: ±1000');
  }

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

// Cleanup function for expired rate limit documents
exports.cleanupRateLimits = onCall({
  cors: true
}, async (req) => {
  authenticateUser(req.auth);
  
  const now = Date.now();
  const rateLimitsRef = db.collection('rateLimits');
  
  // Get expired documents
  const expiredDocs = await rateLimitsRef
    .where('expiresAt', '<', now)
    .limit(100) // Process in batches
    .get();
  
  if (expiredDocs.empty) {
    return { message: 'No expired rate limit documents found', deleted: 0 };
  }
  
  // Delete expired documents in batch
  const batch = db.batch();
  expiredDocs.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  
  return { 
    message: 'Cleanup completed', 
    deleted: expiredDocs.docs.length 
  };
});
