const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DATABASE_PATH = path.join(__dirname, "..", "data", "kisansetu.sqlite");
const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "migrations");

function openDatabase(databasePath = process.env.KISANSETU_DB_PATH || DEFAULT_DATABASE_PATH) {
  const resolvedPath = databasePath === ":memory:" ? databasePath : path.resolve(databasePath);
  if (resolvedPath !== ":memory:") fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  const migrations = fs.readdirSync(MIGRATIONS_DIRECTORY)
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, migration), "utf8"));
  }
  return db;
}

let sharedDatabase;

function getDatabase() {
  if (!sharedDatabase) sharedDatabase = openDatabase();
  return sharedDatabase;
}

function closeDatabase() {
  if (!sharedDatabase) return;
  sharedDatabase.close();
  sharedDatabase = undefined;
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  closeDatabase,
  getDatabase,
  openDatabase
};
