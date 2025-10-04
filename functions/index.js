const { initializeApp } = require("firebase-admin/app");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

// Set global options for all functions
setGlobalOptions({
  cors: true,
  maxInstances: 10, 
  region: 'europe-west3'
});

// Initialize Firebase Admin
const app = initializeApp();

// Pre-initialize database connection immediately
let db = getFirestore();

// Warm up database connection immediately on startup
(async () => {
  try {
    console.log('Pre-warming database connection...');
    
    // Multiple warmup operations to ensure everything is ready
    const startupWarmup = [
      db.collection('_warmup').doc('startup').get(),
      db.collection('lobbies').limit(1).get(),
      db.collection('players').limit(1).get()
    ];
    
    await Promise.allSettled(startupWarmup);
    console.log('Database connection pre-warmed successfully');
    
    // Pre-warm authentication and common operations
    console.log('Container startup completed - ready for requests');
  } catch (error) {
    console.log('Database pre-warming attempted (some operations may have failed)');
  }
})();

// Function warming system
let lastWarmupTime = 0;
let functionCallCount = 0;
const WARMUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WARMUP_FUNCTIONS = [
  'savePlayerData',
  'createLobby', 
  'joinLobby',
  'getPlayers',
  'updatePlayer',
  'deletePlayer',
  'incrementPlayerField',
  'updateCommanderDamage',
  'applyCombatDamage',
  'addPlayer',
  'updateLobbyTimestamp',
  'updatePlayerSettings',
  'cleanupRateLimits',
  'cleanupOldLobbies',
  'startTimer',
  'recordPayInterest',
  'warmUpFunctions',
  'heartbeat'
];

// Track function activity
function trackFunctionCall(functionName) {
  functionCallCount++;
  console.log(`Function call #${functionCallCount}: ${functionName} at ${new Date().toISOString()}`);
}

// Warm up all functions by making lightweight calls
async function warmUpFunctions() {
  const now = Date.now();
  
  // Only warm up if enough time has passed since last warmup
  if (now - lastWarmupTime < WARMUP_INTERVAL) {
    console.log(`Skipping warmup - last warmup was ${Math.round((now - lastWarmupTime) / 1000)}s ago`);
    return;
  }
  
  lastWarmupTime = now;
  console.log('Starting function warmup...');
  
  try {
    // Simple warmup by just logging - this keeps the container warm
    console.log(`Functions container warmed up at ${new Date().toISOString()}`);
    console.log(`Keeping warm: ${WARMUP_FUNCTIONS.join(', ')}`);
    
    // Keep database connection alive with multiple lightweight operations
    if (db) {
      try {
        // Multiple lightweight database operations to ensure connection is fully warmed
        const warmupPromises = [
          db.collection('_warmup').doc('ping').get(),
          db.collection('_warmup').doc('connection-test').get(),
          // Test a typical operation pattern
          db.collection('lobbies').limit(1).get()
        ];
        
        await Promise.allSettled(warmupPromises);
        console.log('Database connection and query patterns warmed up');
      } catch (error) {
        console.log('Database warmup attempted (some operations may have failed)');
      }
    }
    
    console.log(`Function warmup completed successfully. Total calls since startup: ${functionCallCount}`);
  } catch (error) {
    console.warn('Function warmup encountered an error:', error);
  }
}

// Call warmup on first load and set up periodic warming
async function triggerWarmup() {
  try {
    await warmUpFunctions();
  } catch (error) {
    console.warn('Function warmup failed:', error);
  }
}

// Initialize database connection lazily
function getDb() {
  if (!db) {
    db = getFirestore();
  }
  return db;
}

// Database operation tracking
let readCount = 0;
let writeCount = 0;

function trackRead(operation) {
  readCount++;
  console.log(`DB Read ${readCount}: ${operation}`);
  return readCount;
}

function trackWrite(operation) {
  writeCount++;
  console.log(`DB Write ${writeCount}: ${operation}`);
  return writeCount;
}

// Simple rate limiting storage
const rateLimitStore = new Map();

// Basic rate limiting function
function checkRateLimit(userId, action, maxRequests = 10, windowMs = 60000) {
  const key = `${userId}:${action}`;
  const now = Date.now();
  
  if (!rateLimitStore.has(key)) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  const userData = rateLimitStore.get(key);
  
  if (now > userData.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  
  if (userData.count < maxRequests) {
    userData.count++;
    return true;
  }
  
  return false;
}

// Advanced debouncing using Firestore for persistence (optional)
async function checkFirestoreRateLimit(userId, action, maxRequests = 10, windowMs = 60000) {
  const db = getDb();
  if (!db) {
    console.warn('Database not initialized, falling back to memory rate limiting');
    return checkRateLimit(userId, action, maxRequests, windowMs);
  }
  
  const rateLimitRef = getDb().collection('rateLimits').doc(`${userId}_${action}`);
  const now = Date.now();
  
  try {
    const result = await getDb().runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        transaction.set(rateLimitRef, {
          count: 1,
          resetTime: now + windowMs,
          lastRequest: now
        });
        return true;
      }
      
      const data = doc.data();
      
      if (now > data.resetTime) {
        transaction.update(rateLimitRef, {
          count: 1,
          resetTime: now + windowMs,
          lastRequest: now
        });
        return true;
      }
      
      if (data.count < maxRequests) {
        transaction.update(rateLimitRef, {
          count: data.count + 1,
          lastRequest: now
        });
        return true;
      }
      
      return false;
    });
    
    return result;
  } catch (error) {
    console.error('Firestore rate limit check failed:', error);
    return checkRateLimit(userId, action, maxRequests, windowMs);
  }
}

// Debouncing for frequent updates (optional)
async function shouldDebounceUpdate(userId, playerId, field, minIntervalMs = 100) {
  const db = getDb();
  if (!db) {
    console.warn('Database not initialized, skipping debounce check');
    return false;
  }
  
  const debounceKey = `debounce_${userId}_${playerId}_${field}`;
  const rateLimitRef = getDb().collection('rateLimits').doc(debounceKey);
  const now = Date.now();
  
  try {
    const result = await getDb().runTransaction(async (transaction) => {
      const doc = await transaction.get(rateLimitRef);
      
      if (!doc.exists) {
        transaction.set(rateLimitRef, {
          lastUpdate: now,
          expiresAt: now + (24 * 60 * 60 * 1000)
        });
        return false;
      }
      
      const data = doc.data();
      const timeSinceLastUpdate = now - data.lastUpdate;
      
      if (timeSinceLastUpdate >= minIntervalMs) {
        transaction.update(rateLimitRef, {
          lastUpdate: now,
          expiresAt: now + (24 * 60 * 60 * 1000)
        });
        return false;
      }
      
      return true;
    });
    
    return result;
  } catch (error) {
    console.error('Debounce check failed:', error);
    return false;
  }
}

// Helper to check auth in callable functions
function authenticateUser(auth) {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be signed in.');
  }
}

// Middleware to trigger warmup on function calls
function withWarmup(functionName) {
  return function(handler) {
    return async (request) => {
      // Track this function call
      trackFunctionCall(functionName);
      
      // For the very first call, prioritize response speed over warmup
      const isFirstCall = functionCallCount === 1;
      
      if (isFirstCall) {
        console.log(`First function call detected: ${functionName} - prioritizing response speed`);
        // Start warmup in background without awaiting
        setImmediate(() => {
          triggerWarmup().catch(error => {
            console.warn('Background warmup failed:', error);
          });
        });
      } else {
        // For subsequent calls, trigger warmup in background
        triggerWarmup().catch(error => {
          console.warn('Background warmup failed:', error);
        });
      }
      
      // Execute the actual function
      return await handler(request);
    };
  };
}

// Dedicated ultra-fast warmup function for first calls
exports.quickWarmup = onCall({
  cors: true
}, async (request) => {
  // This is an ultra-lightweight function designed for the first call
  const timestamp = new Date().toISOString();
  console.log(`Quick warmup called at ${timestamp}`);
  
  // Track this as a function call but don't trigger heavy warmup
  functionCallCount++;
  
  // Start background warmup without awaiting
  setImmediate(() => {
    triggerWarmup().catch(error => {
      console.warn('Background warmup after quickWarmup failed:', error);
    });
  });
  
  return {
    success: true,
    message: 'Quick warmup completed',
    timestamp,
    ready: true
  };
});

// Dedicated function for warming up all functions
exports.warmUpFunctions = onCall({
  cors: true
}, async (request) => {
  trackFunctionCall('warmUpFunctions');
  console.log('Manual warmup triggered');
  
  try {
    await warmUpFunctions();
    return { 
      success: true, 
      message: `Warmup completed for ${WARMUP_FUNCTIONS.length} functions`,
      warmedFunctions: WARMUP_FUNCTIONS,
      timestamp: new Date().toISOString(),
      lastWarmupTime: new Date(lastWarmupTime).toISOString(),
      totalFunctionCalls: functionCallCount
    };
  } catch (error) {
    console.error('Manual warmup failed:', error);
    throw new HttpsError('internal', 'Warmup failed. Please try again.');
  }
});

// Heartbeat function to keep functions warm (can be called by external monitoring)
exports.heartbeat = onCall({
  cors: true
}, async (request) => {
  trackFunctionCall('heartbeat');
  const timestamp = new Date().toISOString();
  console.log(`Heartbeat received at ${timestamp}`);
  
  // Trigger warmup if needed
  await triggerWarmup();
  
  return {
    success: true,
    message: 'Heartbeat successful',
    timestamp,
    functionsCount: WARMUP_FUNCTIONS.length,
    lastWarmupTime: new Date(lastWarmupTime).toISOString(),
    uptime: process.uptime(),
    totalFunctionCalls: functionCallCount
  };
});

// Save or update player data when user signs in
exports.savePlayerData = onCall({
  cors: true
}, withWarmup('savePlayerData')(async (request) => {
  const data = request.data;
  const auth = request.auth;
  
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be signed in.');
  }
  
  const userId = auth.uid;
  
  // Get user info from Firebase Auth token
  const userRecord = auth;
  
  const playerData = {
    name: userRecord.token?.name || 'Unknown',
    email: userRecord.token?.email || '',
    lastLogin: FieldValue.serverTimestamp(),
    uid: userId,
    loginCount: FieldValue.increment(1)
  };

  try {
    // Use set with merge option to create or update the document
    await getDb().collection('players').doc(userId).set(playerData, { merge: true });
    trackWrite("savePlayerData - player data save");
    
    return { success: true, message: 'Player data saved successfully' };
  } catch (error) {
    console.error('Error saving player data:', error);
    throw new HttpsError('internal', 'Failed to save player data. Please try again.');
  }
}));

// Create a lobby, given player data (callable function)
exports.createLobby = onCall({
  cors: true,
  timeoutSeconds: 10
}, withWarmup('createLobby')(async (request) => {
  const player = request.data; // request.data IS the player object
  authenticateUser(request.auth);
  const userId = request.auth.uid;
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
    const lobbyRef = getDb().collection("lobbies").doc(lobbyCode);
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
}));

// Join a lobby (callable)
exports.joinLobby = onCall({
  cors: true
}, withWarmup('joinLobby')(async (request) => {
  const {player, lobbyCode} = request.data;
  authenticateUser(request.auth);
  const userId = request.auth.uid;

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
    const lobbyRef = getDb().collection("lobbies").doc(lobbyCode);
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
}));

// Get all players in a lobby
exports.getPlayers = onCall({
  cors: true
}, withWarmup('getPlayers')(async (request) => {
  const {lobbyId} = request.data;
  authenticateUser(request.auth);

  const playersSnapshot = await getDb().collection("lobbies")
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
}));

// Update a player in a lobby
exports.updatePlayer = onCall({
  cors: true
}, withWarmup('updatePlayer')(async (request) => {
  const {lobbyId, playerId, updates} = request.data;
  authenticateUser(request.auth);
  const userId = request.auth.uid;

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
  const frequentFields = ['lifeToApply', 'infectToApply', 'life'];
  for (const field of Object.keys(updates)) {
    if (frequentFields.includes(field)) {
      const shouldDebounce = await shouldDebounceUpdate(userId, playerId, field, 50); // 50ms minimum interval
      if (shouldDebounce) {
        throw new HttpsError('resource-exhausted', `Update too frequent for field ${field}. Please slow down.`);
      }
    }
  }

  const playerRef = getDb().collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update(updates);
  trackWrite(`updatePlayer - ${playerId} fields: ${Object.keys(updates).join(', ')}`);

  return {success: true};
}));

// Delete a player from a lobby
exports.deletePlayer = onCall({
  cors: true
}, withWarmup('deletePlayer')(async (request) => {
  const {lobbyId, playerId} = request.data;
  authenticateUser(request.auth);

  const playerRef = getDb().collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.delete();
  trackWrite(`deletePlayer - ${playerId}`);

  return {success: true};
}));

// Increment a player's field (e.g. life, score)
exports.incrementPlayerField = onCall({
  cors: true
}, withWarmup('incrementPlayerField')(async (request) => {
  const {lobbyId, playerId, field, value} = request.data;
  authenticateUser(request.auth);
  const userId = request.auth.uid;

  // Rate limiting: max 30 increments per minute per user
  if (!checkRateLimit(userId, 'incrementPlayerField', 30, 60000)) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Please slow down your requests.');
  }

  // Validate input
  if (Math.abs(value) > 1000) {
    throw new HttpsError('invalid-argument', 'Value change too large. Maximum allowed: ±1000');
  }

  const playerRef = getDb().collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);
  await playerRef.update({[field]: FieldValue.increment(value)});
  trackWrite(`incrementPlayerField - ${playerId} ${field} by ${value}`);

  return {success: true};
}));

// Update commander damages in a transaction
exports.updateCommanderDamage = onCall({
  cors: true
}, withWarmup('updateCommanderDamage')(async (request) => {
  const {lobbyId, playerId, commanderDamages} = request.data;
  authenticateUser(request.auth);

  const playerRef = getDb().collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  await getDb().runTransaction(async (transaction) => {
    const doc = await transaction.get(playerRef);
    trackRead(`updateCommanderDamage - get player ${playerId}`);
    if (!doc.exists) throw new Error("Player document does not exist");

    transaction.update(playerRef, {commanderDamages});
    trackWrite(`updateCommanderDamage - update player ${playerId}`);
  });

  return {success: true};
}));

// Apply combat damage transaction
exports.applyCombatDamage = onCall({
  cors: true
}, withWarmup('applyCombatDamage')(async (request) => {
  const {lobbyId, playerId} = request.data;
  authenticateUser(request.auth);

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new HttpsError('invalid-argument', "Missing or invalid lobbyId parameter");
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new HttpsError('invalid-argument', "Missing or invalid playerId parameter");
  }

  try {
    const playerRef = getDb().collection("lobbies")
        .doc(lobbyId).collection("players").doc(playerId);

    const result = await getDb().runTransaction(async (transaction) => {
      try {
        const playerDoc = await transaction.get(playerRef);
        trackRead(`applyCombatDamage - get player ${playerId}`);
        
        if (!playerDoc.exists) {
          throw new HttpsError('not-found', `Player document does not exist: ${playerId}`);
        }

        const playerData = playerDoc.data();

        // Validate player data structure
        if (typeof playerData.life !== 'number') {
          console.error(`Invalid life value for player ${playerId}:`, playerData.life);
          throw new HttpsError('invalid-argument', `Player ${playerId} has invalid life value: ${playerData.life}`);
        }

        let commanderDamages = playerData.commanderDamages || [];
        let totalCommanderlifeToApply = 0;

        // Validate commanderDamages structure
        if (!Array.isArray(commanderDamages)) {
          console.error(`Invalid commanderDamages for player ${playerId}:`, commanderDamages);
          commanderDamages = [];
        }

        commanderDamages = commanderDamages.map((cd) => {
          if (typeof cd.lifeToApply !== 'number' || typeof cd.damage !== 'number') {
            console.error(`Invalid commander damage data for player ${playerId}:`, cd);
            return cd;
          }
          totalCommanderlifeToApply += cd.lifeToApply;
          return {
            ...cd,
            damage: cd.damage + cd.lifeToApply,
            lifeToApply: 0,
          };
        });

        const lifeToApply = typeof playerData.lifeToApply === 'number' ? playerData.lifeToApply : 0;
        const infect = typeof playerData.infect === 'number' ? playerData.infect : 0;
        const infectToApply = typeof playerData.infectToApply === 'number' ? playerData.infectToApply : 0;

        const newLife = playerData.life - totalCommanderlifeToApply + lifeToApply;
        const newInfect = infect + infectToApply;

        const updateData = {
          commanderDamages,
          life: newLife,
          infect: newInfect,
          lifeToApply: 0,
          infectToApply: 0,
        };

        // Validate update data before applying
        if (typeof updateData.life !== 'number' || typeof updateData.infect !== 'number') {
          throw new HttpsError('internal', `Invalid update data for player ${playerId}: life=${updateData.life}, infect=${updateData.infect}`);
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
    // Re-throw HttpsError instances
    if (error.code && error.code.startsWith('functions/')) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to apply combat damage for player ${playerId}: ${error.message}`);
  }
}));

exports.addPlayer = onCall({
  cors: true
}, withWarmup('addPlayer')(async (request) => {
  const {lobbyId, player} = request.data;
  authenticateUser(request.auth);

  if (!lobbyId || !player) {
    throw new HttpsError('invalid-argument', "Missing lobbyId or player");
  }

  const playersRef = getDb().collection('lobbies').doc(lobbyId).collection('players');

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
}));

// Update lobby timestamp
exports.updateLobbyTimestamp = onCall({
  cors: true
}, withWarmup('updateLobbyTimestamp')(async (request) => {
  const { lobbyId } = request.data;
  authenticateUser(request.auth);

  const lobbyRef = getDb().collection('lobbies').doc(lobbyId);
  await lobbyRef.update({
    lastUpdated: FieldValue.serverTimestamp()
  });
  trackWrite(`updateLobbyTimestamp - lobby ${lobbyId}`);
  
  return { success: true };
}));

// Update player settings (name, colors, etc.)
exports.updatePlayerSettings = onCall({
  cors: true
}, withWarmup('updatePlayerSettings')(async (request) => {
  const {lobbyId, playerId, settings} = request.data;
  authenticateUser(request.auth);

  // Validate required parameters
  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new HttpsError('invalid-argument', "Missing or invalid lobbyId parameter");
  }
  if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
    throw new HttpsError('invalid-argument', "Missing or invalid playerId parameter");
  }
  if (!settings || typeof settings !== 'object') {
    throw new HttpsError('invalid-argument', "Missing or invalid settings parameter");
  }

  const playerRef = getDb().collection("lobbies")
      .doc(lobbyId).collection("players").doc(playerId);

  // Validate that the player exists
  const playerDoc = await playerRef.get();
  trackRead(`updatePlayerSettings - get player ${playerId}`);
  
  if (!playerDoc.exists) {
    throw new HttpsError('not-found', `Player document does not exist: ${playerId}`);
  }

  // Update the player settings
  await playerRef.update(settings);
  trackWrite(`updatePlayerSettings - update player ${playerId}`);
  
  return { success: true };
}));

// Cleanup function for expired rate limit documents
exports.cleanupRateLimits = onCall({
  cors: true
}, withWarmup('cleanupRateLimits')(async (request) => {
  authenticateUser(request.auth);
  
  const now = Date.now();
  const rateLimitsRef = getDb().collection('rateLimits');
  
  // Get expired documents
  const expiredDocs = await rateLimitsRef
    .where('expiresAt', '<', now)
    .limit(100) // Process in batches
    .get();
  
  if (expiredDocs.empty) {
    return { message: 'No expired rate limit documents found', deleted: 0 };
  }
  
  // Delete expired documents in batch
  const batch = getDb().batch();
  expiredDocs.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  
  return { 
    message: 'Cleanup completed', 
    deleted: expiredDocs.docs.length 
  };
}));

// Cleanup function for old lobbies (older than 7 days)
exports.cleanupOldLobbies = onCall({
  cors: true
}, withWarmup('cleanupOldLobbies')(async (request) => {
  authenticateUser(request.auth);
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const lobbiesRef = getDb().collection('lobbies');
  
  // Get lobbies older than 7 days
  const oldLobbies = await lobbiesRef
    .where('lastUpdated', '<', sevenDaysAgo)
    .limit(50) // Process in batches to avoid timeouts
    .get();
  
  if (oldLobbies.empty) {
    return { message: 'No old lobbies found to delete', deleted: 0 };
  }
  
  let deletedCount = 0;
  
  // Delete each lobby and its subcollections
  for (const lobbyDoc of oldLobbies.docs) {
    try {
      const lobbyRef = lobbyDoc.ref;
      
      // Delete all players in the lobby first
      const playersSnapshot = await lobbyRef.collection('players').get();
      const playerBatch = getDb().batch();
      
      playersSnapshot.docs.forEach(playerDoc => {
        playerBatch.delete(playerDoc.ref);
      });
      
      if (!playersSnapshot.empty) {
        await playerBatch.commit();
        trackWrite(`cleanupOldLobbies - deleted ${playersSnapshot.docs.length} players from lobby ${lobbyDoc.id}`);
      }
      
      // Delete the lobby document itself
      await lobbyRef.delete();
      trackWrite(`cleanupOldLobbies - deleted lobby ${lobbyDoc.id}`);
      
      deletedCount++;
    } catch (error) {
      console.error(`Error deleting lobby ${lobbyDoc.id}:`, error);
    }
  }
  
  return { 
    message: `Cleanup completed. Deleted ${deletedCount} old lobbies.`, 
    deleted: deletedCount,
    totalFound: oldLobbies.docs.length
  };
}));

exports.startTimer = onCall({ cors: true }, withWarmup('startTimer')(async (request) => {
  const { lobbyId, duration } = request.data;
  authenticateUser(request.auth);

  if (!lobbyId || typeof lobbyId !== 'string' || lobbyId.trim() === '') {
    throw new HttpsError('invalid-argument', 'Missing or invalid lobbyId parameter');
  }
  if (!duration || typeof duration !== 'number' || duration <= 0) {
    throw new HttpsError('invalid-argument', 'Missing or invalid duration parameter');
  }

  const lobbyRef = getFirestore().collection('lobbies').doc(lobbyId);
  const timerEnd = Date.now() + duration * 60 * 1000;

  await lobbyRef.update({
    timerEnd,
    timerDuration: duration,
    timerStartedAt: Date.now()
  });
  trackWrite(`startTimer - lobby ${lobbyId} for ${duration} min`);

  return { success: true, timerEnd };
}));

// Record user's interest in supporting the project
exports.recordPayInterest = onCall({
  cors: true
}, withWarmup('recordPayInterest')(async (request) => {
  authenticateUser(request.auth);
  const userId = request.auth.uid;

  // Rate limiting: max 5 interest records per hour per user to prevent spam
  if (!(await checkFirestoreRateLimit(userId, 'recordPayInterest', 5, 3600000))) {
    throw new HttpsError('resource-exhausted', 'You can only show interest 5 times per hour. Thank you for your enthusiasm!');
  }

  try {
    // Reference to the user's document in the players collection
    const userDocRef = getDb().collection('players').doc(userId);
    
    // Get current document
    const doc = await userDocRef.get();
    trackRead(`recordPayInterest - get player ${userId}`);
    
    if (doc.exists) {
      // Increment the pay_interest field
      await userDocRef.update({
        pay_interest: FieldValue.increment(1),
        last_interest_shown: FieldValue.serverTimestamp()
      });
      trackWrite(`recordPayInterest - update existing player ${userId}`);
    } else {
      // Create new document with pay_interest field
      await userDocRef.set({
        pay_interest: 1,
        last_interest_shown: FieldValue.serverTimestamp(),
        uid: userId
      });
      trackWrite(`recordPayInterest - create new player ${userId}`);
    }
    
    return { 
      success: true, 
      message: 'Thank you for showing interest in supporting this project!' 
    };
    
  } catch (error) {
    console.error('Error recording pay interest:', error);
    throw new HttpsError('internal', 'Failed to record interest. Please try again.');
  }
}));
