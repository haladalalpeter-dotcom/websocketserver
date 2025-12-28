import { WebSocketServer } from "ws";
import express from "express";
import fs from "fs";

const app = express();
app.use(express.json());

// ملف قاعدة البيانات
const DB_FILE = "./db.json";

// تحميل العدد من قاعدة البيانات
function loadCount() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return data.count || 0;
  } catch {
    return 0;
  }
}

// حفظ العدد
function saveCount(count) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ count }));
}

let currentCount = loadCount();

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

// بث العدد لكل المتصلين
function broadcast() {
  const msg = JSON.stringify({ type: "count", value: currentCount });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// Endpoint لتحديث العدد من n8n
app.post("/update", (req, res) => {
  const { count } = req.body;

  if (typeof count === "number") {
    currentCount = count;
    saveCount(currentCount);
    broadcast();
  }

  res.json({ ok: true });
});

// تشغيل السيرفر
const server = app.listen(3000, () => {
  console.log("WebSocket server running on port 3000");
});

// تحويل HTTP → WebSocket
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit("connection", ws, req);
  });
});