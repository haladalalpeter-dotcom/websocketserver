import express from "express";
import http from "http";
import Database from "better-sqlite3";
import { WebSocketServer } from "ws";

// =======================
// App & Server
// =======================
const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// =======================
// Database (SQLite)
// =======================
const db = new Database("db.sqlite");

// create table if not exists
db.prepare(`
  CREATE TABLE IF NOT EXISTS counters (
    userId TEXT PRIMARY KEY,
    count INTEGER NOT NULL
  )
`).run();

// helpers
function getCount(userId) {
  const row = db.prepare(
    "SELECT count FROM counters WHERE userId = ?"
  ).get(userId);
  return row ? row.count : 0;
}

function incrementCount(userId) {
  const exists = db.prepare(
    "SELECT 1 FROM counters WHERE userId = ?"
  ).get(userId);

  if (exists) {
    db.prepare(
      "UPDATE counters SET count = count + 1 WHERE userId = ?"
    ).run(userId);
  } else {
    db.prepare(
      "INSERT INTO counters (userId, count) VALUES (?, 1)"
    ).run(userId);
  }

  return getCount(userId);
}

// =======================
// WebSocket connections
// =======================
const connections = {}; // userId -> Set(ws)

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "register" && data.userId) {
      const userId = String(data.userId);
      ws.userId = userId;

      if (!connections[userId]) {
        connections[userId] = new Set();
      }
      connections[userId].add(ws);

      // send current count
      ws.send(JSON.stringify({
        type: "count",
        value: getCount(userId)
      }));
    }
  });

  ws.on("close", () => {
    if (ws.userId && connections[ws.userId]) {
      connections[ws.userId].delete(ws);
      if (connections[ws.userId].size === 0) {
        delete connections[ws.userId];
      }
    }
  });
});

// =======================
// HTTP endpoint (increment)
// =======================
app.get("/open", (req, res) => {
  const userId = req.query.id;
  if (!userId) {
    return res.status(400).json({ error: "missing id" });
  }

  const count = incrementCount(String(userId));

  // notify only this user
  if (connections[userId]) {
    connections[userId].forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: "count",
          value: count
        }));
      }
    });
  }

  res.json({ ok: true, count });
});

// =======================
// Health
// =======================
app.get("/", (_, res) => res.send("WS + DB OK"));

// =======================
// Render PORT
// =======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 running on", PORT);
});
