import express from "express";
import http from "http";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
app.use(cors());
app.use(express.json());

// ===== تحميل البيانات =====
let counters = {};
try {
  if (fs.existsSync(DATA_FILE)) {
    counters = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (e) {
  console.error("❌ Failed to load data.json");
  counters = {};
}

// ===== حفظ البيانات =====
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(counters, null, 2));
}

// health check
app.get("/", (req, res) => {
  res.send("WS OK");
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket connections لكل مستخدم
const userConnections = {};

// ===== WebSocket =====
wss.on("connection", (ws) => {
  console.log("🟢 client connected");

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

      if (!userConnections[userId]) {
        userConnections[userId] = [];
      }
      userConnections[userId].push(ws);

      ws.send(JSON.stringify({
        type: "count",
        value: counters[userId] || 0
      }));
    }
  });

  ws.on("close", () => {
    if (ws.userId && userConnections[ws.userId]) {
      userConnections[ws.userId] =
        userConnections[ws.userId].filter(c => c !== ws);

      if (userConnections[ws.userId].length === 0) {
        delete userConnections[ws.userId];
      }
    }
  });
});

// ===== HTTP increment =====
app.get("/open", (req, res) => {
  const userId = req.query.id;
  if (!userId) {
    return res.status(400).json({ error: "missing id" });
  }

  const uid = String(userId);

  if (!counters[uid]) counters[uid] = 0;
  counters[uid]++;

  // حفظ دائم
  saveData();

  // بث التحديث
  if (userConnections[uid]) {
    userConnections[uid].forEach(ws => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: "count",
          value: counters[uid]
        }));
      }
    });
  }

  res.json({ ok: true, count: counters[uid] });
});

// ===== PORT =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 running on port", PORT);
});
