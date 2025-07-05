const functions = require('firebase-functions'); // Use require for Node.js environment
const admin = require('firebase-admin'); // Use require for Node.js environment
admin.initializeApp();

exports.createLobby = functions.https.onCall({ cors: true }, async (data, context) => { // Use exports and functions.https.onCall
 console.log("createLobby function called"); // Add this line
  // 1. Authenticate the user
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const userId = context.auth.uid;
  const playerName = data.playerName || 'Player'; // Get player name from data

  // 2. Generate a unique lobby code (simple 6-character code)
  const lobbyCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  console.log("Generating lobby code:", lobbyCode);

  // 3. Create the lobby in Cloud Firestore
  const db = admin.firestore();
  const lobbyRef = db.collection('lobbies').doc(lobbyCode);

  await lobbyRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    hostId: userId,
  });

  console.log("Lobby created in Firestore for code:", lobbyCode);
  // Add the host as the first player in the 'players' subcollection

  await lobbyRef.collection('players').doc(userId).set({
    name: playerName,
    life: 8000
  });

  // 4. Return the lobby code to the client
  return { lobbyCode };
});
// Keep joinLobby for now, we'll modify it next
exports.joinLobby = functions.https.onCall({ cors: true }, async (data, context) => { // Use exports and functions.https.onCall
  // 1. Authenticate the user
  if (!context.auth) {
    throw new functions.https.HttpsError( // Use functions.https.HttpsError
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  } // Corrected closing brace position

  const userId = context.auth.uid;
  const lobbyCode = data.lobbyCode;
  const playerName = data.playerName || 'Player';

  // 2. Validate lobby code
  if (!lobbyCode) {
    throw new functions.https.HttpsError( // Use functions.https.HttpsError
      'invalid-argument',
      'Lobby code is required.'
    );
  }

  // 3. Get lobby reference and check if it exists (use admin.database())
  const db = admin.firestore();
  const lobbyRef = db.collection('lobbies').doc(lobbyCode);
  const lobbyDoc = await lobbyRef.get();

  if (!lobbyDoc.exists) {
    throw new functions.https.HttpsError( // Use functions.https.HttpsError
      'not-found',
      'Lobby not found.'
    );
  }

  // 4. Add the player to the lobby
  await lobbyRef.collection('players').doc(userId).set({
    [userId]: { name: playerName, life: 8000 }
  });
});
