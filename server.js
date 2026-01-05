import express from "express";
import http from "http";
import cors from "cors";
import Database from "better-sqlite3";
import { WebSocketServer } from "ws";

const app = express();
app.use(cors());
app.use(express.json());

/* ======================
   HTTP + WS SERVER
====================== */
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/* ======================
   DATABASE (SQLite)
====================== */
const db = new Database("data.db");

// جدول واحد للحملات
db.prepare(`
  CREATE TABLE IF NOT EXISTS counters (
    campaign TEXT,
    userId TEXT,
    count INTEGER,
    PRIMARY KEY (campaign, userId)
  )
`).run();

/* ======================
   HELPERS
====================== */
function getCount(campaign, userId) {
  const row = db.prepare(
    "SELECT count FROM counters WHERE campaign = ? AND userId = ?"
  ).get(campaign, userId);
  return row ? row.count : 0;
}

function incrementCount(campaign, userId) {
  const existing = db.prepare(
    "SELECT count FROM counters WHERE campaign = ? AND userId = ?"
  ).get(campaign, userId);

  if (existing) {
    db.prepare(
      "UPDATE counters SET count = count + 1 WHERE campaign = ? AND userId = ?"
    ).run(campaign, userId);
  } else {
    db.prepare(
      "INSERT INTO counters (campaign, userId, count) VALUES (?, ?, 1)"
    ).run(campaign, userId);
  }

  return getCount(campaign, userId);
}

/* ======================
   WEBSOCKET
====================== */
wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch {
      return;
    }

    if (data.type === "register" && data.campaign && data.userId) {
      ws.campaign = data.campaign;
      ws.userId = data.userId;

      const count = getCount(ws.campaign, ws.userId);
      ws.send(JSON.stringify({
        type: "count",
        value: count
      }));
    }
  });
});

/* ======================
   INCREMENT ENDPOINT
====================== */
app.get("/open", (req, res) => {
  const { campaign, id } = req.query;
  if (!campaign || !id) {
    return res.status(400).json({ error: "missing campaign or id" });
  }

  const count = incrementCount(campaign, id);

  // بث التحديث
  wss.clients.forEach(client => {
    if (
      client.readyState === 1 &&
      client.campaign === campaign &&
      client.userId === id
    ) {
      client.send(JSON.stringify({
        type: "count",
        value: count
      }));
    }
  });

  res.json({ ok: true, count });
});

/* ======================
   HEALTH
====================== */
app.get("/", (_, res) => {
  res.send("WS + Campaign OK");
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 Server running on", PORT);
});
