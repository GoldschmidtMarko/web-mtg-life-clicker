// public/js/models.js

// Define a class for the Player
class Player {
  constructor(id, name, life, damageToApply, infect, backgroundColor, fontColor) { // Add damageToApply and infect here
    this.id = id; // Player's unique ID (e.g., Firebase Auth UID).
    this.name = name; // Player's display name.
    this.life = life; // Player's life total.
    this.damageToApply = damageToApply; // Player's damage to apply
    this.infect = infect; // Player's infect status
    this.backgroundColor = backgroundColor;
    this.fontColor = fontColor;
    // Add other player-related attributes here as needed
  }

  toFirestoreObject() {
    return {
      id: this.id,
      name: this.name,
      life: this.life,
      damageToApply: this.damageToApply,
      infect: this.infect,
      backgroundColor: this.backgroundColor,
      fontColor: this.fontColor
    };
  }
}

// Define a class for the Lobby
class Lobby {
  constructor(code, hostId, hostPlayerName, createdAt, lastUpdated) {
    this.code = code; // Unique lobby code.
    this.hostId = hostId; // ID of the host player.
    this.hostPlayerName = hostPlayerName; // Name of the host player.
    this.createdAt = createdAt; // Timestamp of lobby creation (Firestore Timestamp).
    this.players = {}; // An object or Map to store Player objects, keyed by player ID.
    // Add other lobby-related attributes here as needed
    this.lastUpdated = lastUpdated; // Timestamp of the last update (Firestore Timestamp)
  }

  toFirestoreObject() {
    return {
      code: this.code,
      hostId: this.hostId,
      hostPlayerName: this.hostPlayerName,
      createdAt: this.createdAt,
      players: this.players,
      lastUpdated: this.lastUpdated
    };
  }


  // Method to add a player to the lobby
  addPlayer(player) {
    if (player instanceof Player) {
      this.players[player.id] = player;
    } else {
      console.error("Invalid player object provided.");
    }
  }

  // Method to remove a player from the lobby
  removePlayer(playerId) {
    delete this.players[playerId];
  }

  // Method to get a specific player by ID
  getPlayer(playerId) {
    return this.players[playerId];
  }

  // Method to get all players as an array
  getAllPlayers() {
    return Object.values(this.players);
  }

  // You can add other methods related to lobby management
}

// If you are using JavaScript modules, you might export these classes:
export { Player, Lobby };