import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import sqlite3 from "sqlite3";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/**
 * مهم: على Render مع Disk خلي DB_PATH=/var/data/data.sqlite
 * محلياً بيمشي ./data.sqlite
 */
const DB_PATH = process.env.DB_PATH || "./data.sqlite";

const ALLOWED_ORIGINS = new Set([
  "https://beautiful-clafoutis-fe61aa.netlify.app",
  "https://www.coffeedeals.co.il",
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error("CORS blocked: " + origin));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));
app.options("*", cors());

// --- SQLite helpers
const db = new sqlite3.Database(DB_PATH);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

// --- init schema
await run(`
  CREATE TABLE IF NOT EXISTS refs (
    ref TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

await run(`
  CREATE TABLE IF NOT EXISTS phones (
    phone TEXT PRIMARY KEY,
    ref TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

await run(`
  CREATE TABLE IF NOT EXISTS visits (
    ref TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (ref, visitor_id)
  )
`);

async function ensureRef(ref) {
  await run(`INSERT OR IGNORE INTO refs (ref, count) VALUES (?, 0)`, [ref]);
}

async function getCount(ref) {
  await ensureRef(ref);
  const row = await get(`SELECT count FROM refs WHERE ref = ?`, [ref]);
  return row?.count ?? 0;
}

async function incrementRef(ref, visitorId = null) {
  await ensureRef(ref);

  if (visitorId) {
    try {
      await run(`INSERT INTO visits (ref, visitor_id) VALUES (?, ?)`, [ref, visitorId]);
    } catch {
      return { ok: true, ref, value: await getCount(ref), duplicate: true };
    }
  }

  await run(`UPDATE refs SET count = count + 1 WHERE ref = ?`, [ref]);
  return { ok: true, ref, value: await getCount(ref), duplicate: false };
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}
function validPhone(phone) {
  return /^(05\d{8}|9725\d{8})$/.test(phone);
}

// --- HTTP routes
app.get("/", (req, res) => res.send("ok"));

app.get("/count", async (req, res) => {
  const ref = req.query.ref;
  if (!ref) return res.status(400).json({ ok: false, error: "ref required" });
  try {
    res.json({ ok: true, ref, value: await getCount(ref) });
  } catch {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/increment", async (req, res) => {
  const { ref, visitorId } = req.body || {};
  if (!ref) return res.status(400).json({ ok: false, error: "ref required" });

  try {
    const result = await incrementRef(ref, visitorId || null);
    await broadcast(ref);
    res.json(result);
  } catch {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/set-phone", async (req, res) => {
  let { phone } = req.body || {};
  phone = normalizePhone(phone);

  if (!validPhone(phone)) {
    return res.status(400).json({ ok: false, error: "invalid_phone" });
  }

  try {
    const existing = await get(`SELECT ref FROM phones WHERE phone = ?`, [phone]);
    if (existing?.ref) {
      await ensureRef(existing.ref);
      return res.json({ ok: true, ref: existing.ref, existing: true });
    }

    const ref = crypto.randomUUID();
    await ensureRef(ref);
    await run(`INSERT INTO phones (phone, ref) VALUES (?, ?)`, [phone, ref]);

    res.json({ ok: true, ref, existing: false });
  } catch {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// --- WS
const server = app.listen(PORT, () => console.log("Listening on", PORT));
const wss = new WebSocketServer({ server, path: "/ws" });

// ref -> Set(ws)
const subs = new Map();

async function broadcast(ref) {
  const value = await getCount(ref);
  const msg = JSON.stringify({ type: "count", ref, value });
  const set = subs.get(ref);
  if (!set) return;
  for (const ws of set) if (ws.readyState === 1) ws.send(msg);
}

wss.on("connection", (ws) => {
  ws.on("message", async (buf) => {
    let data;
    try { data = JSON.parse(buf.toString()); } catch { return; }
    if (data.type !== "subscribe") return;

    const ref = data.ref;
    if (!ref) return;

    if (!subs.has(ref)) subs.set(ref, new Set());
    subs.get(ref).add(ws);

    ws.send(JSON.stringify({ type: "count", ref, value: await getCount(ref) }));
  });

  ws.on("close", () => {
    for (const set of subs.values()) set.delete(ws);
  });
});
