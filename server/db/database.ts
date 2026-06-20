import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { databasePath, dataDir } from "../config.js";
import { migrate } from "./schema.js";

let connection: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (connection) return connection;
  fs.mkdirSync(dataDir, { recursive: true });
  connection = new DatabaseSync(databasePath);
  migrate(connection);
  return connection;
}

export function closeDb(): void {
  connection?.close();
  connection = null;
}
