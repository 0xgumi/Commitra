// src/db/db_demo.js
const Database = require("better-sqlite3");
const path = require("path");

// Demo DB 파일 위치
const dbPath = path.join(__dirname, "voting_demo.db");

const db = new Database(dbPath);

module.exports = db;
