// src/db/init.js
const path = require("path");
const Database = require("better-sqlite3");

console.log("✓ Initializing database...");

const dbPath = path.join(__dirname, "voting.db");
const db = new Database(dbPath);

// snapshot (voteId first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS snapshot (
    voteId INTEGER,
    eoa TEXT,
    weight INTEGER,
    PRIMARY KEY (voteId, eoa)
  )
`).run();

// permits (voteId first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS permits (
    voteId INTEGER,
    id INTEGER,
    encryptedVotes TEXT,
    encryptedVotesHash TEXT,
    PRIMARY KEY (voteId, id)
  )
`).run();

// leaf_data (voteId already first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS leaf_data (
    voteId INTEGER,
    leaf TEXT,
    leafIndex INTEGER,
    root TEXT,
    pathElements TEXT,
    pathIndices TEXT,
    PRIMARY KEY (voteId, leaf)
  )
`).run();

// root_history (voteId first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS root_history (
    voteId INTEGER,
    id INTEGER,
    root TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (voteId, id),
    UNIQUE(voteId, root)
  )
`).run();

// used_nullifiers (voteId already first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS used_nullifiers (
    voteId INTEGER,
    nullifier TEXT,
    txHash TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (voteId, nullifier)
  )
`).run();

// active_votes (voteId already first)
db.prepare(`
  CREATE TABLE IF NOT EXISTS active_votes (
    voteId INTEGER PRIMARY KEY,
    title TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    closedAt DATETIME
  )
`).run();

console.log("✓ DB initialized at", dbPath);
console.log("✓ Database ready (no initial snapshot - use createSnapshot.js)");