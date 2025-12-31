// src/db/db.js
const Database = require("better-sqlite3");
const path = require("path");

// DB 파일 위치는 init.js와 동일하게 유지
const dbPath = path.join(__dirname, "voting.db");

const db = new Database(dbPath);

module.exports = db;