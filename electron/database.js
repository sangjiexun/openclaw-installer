const path = require("path");
const { app } = require("electron");
const Database = require("better-sqlite3");

let db = null;

function getDbPath() {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "openclaw.db");
}

function getDb() {
  if (db) return db;

  db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS vip (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      out_trade_no TEXT,
      paid_at TEXT,
      amount REAL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      out_trade_no TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'NOTPAY',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT,
      description TEXT
    );
  `);

  // Ensure vip row exists
  const row = db.prepare("SELECT id FROM vip WHERE id = 1").get();
  if (!row) {
    db.prepare("INSERT INTO vip (id, active, expires_at) VALUES (1, 0, NULL)").run();
  }

  return db;
}

// ─── VIP ────────────────────────────────────────────────────────────────────

function getVipState() {
  const d = getDb();
  const row = d.prepare("SELECT active, expires_at FROM vip WHERE id = 1").get();
  if (!row) return { active: false, expiresAt: null };

  // Auto-expire
  if (row.active && row.expires_at && new Date(row.expires_at) < new Date()) {
    d.prepare("UPDATE vip SET active = 0 WHERE id = 1").run();
    return { active: false, expiresAt: row.expires_at };
  }

  return { active: !!row.active, expiresAt: row.expires_at || null };
}

function activateVip(months, outTradeNo, amount) {
  const d = getDb();
  const current = d.prepare("SELECT expires_at FROM vip WHERE id = 1").get();
  console.log("[DB] activateVip called:", { months, outTradeNo, amount, current });

  let base = new Date();
  if (current && current.expires_at) {
    const prev = new Date(current.expires_at);
    if (prev > base) base = prev;
  }
  base.setMonth(base.getMonth() + months);

  d.prepare(`
    UPDATE vip SET active = 1, expires_at = ?, out_trade_no = ?, paid_at = datetime('now'), amount = ?
    WHERE id = 1
  `).run(base.toISOString(), outTradeNo || null, amount || null);

  // Verify write
  const after = d.prepare("SELECT * FROM vip WHERE id = 1").get();
  console.log("[DB] activateVip result:", after);

  return { active: true, expiresAt: base.toISOString() };
}

function resetVip() {
  const d = getDb();
  d.prepare("UPDATE vip SET active = 0, expires_at = NULL, out_trade_no = NULL, paid_at = NULL, amount = NULL WHERE id = 1").run();
  return { active: false, expiresAt: null };
}

// ─── Config ─────────────────────────────────────────────────────────────────

function getConfig(key) {
  const d = getDb();
  const row = d.prepare("SELECT value FROM config WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  const d = getDb();
  d.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value);
}

function deleteConfig(key) {
  const d = getDb();
  d.prepare("DELETE FROM config WHERE key = ?").run(key);
}

function getAllConfig() {
  const d = getDb();
  const rows = d.prepare("SELECT key, value FROM config").all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

function saveOrder(outTradeNo, amount, description) {
  const d = getDb();
  d.prepare(`
    INSERT OR REPLACE INTO orders (out_trade_no, amount, description, status, created_at)
    VALUES (?, ?, ?, 'NOTPAY', datetime('now'))
  `).run(outTradeNo, amount, description || null);
}

function updateOrderStatus(outTradeNo, status) {
  const d = getDb();
  const paidAt = status === "SUCCESS" || status === "PAID" ? new Date().toISOString() : null;
  d.prepare("UPDATE orders SET status = ?, paid_at = ? WHERE out_trade_no = ?").run(status, paidAt, outTradeNo);
}

function getOrder(outTradeNo) {
  const d = getDb();
  return d.prepare("SELECT * FROM orders WHERE out_trade_no = ?").get(outTradeNo);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  getDbPath,
  getVipState,
  activateVip,
  resetVip,
  getConfig,
  setConfig,
  deleteConfig,
  getAllConfig,
  saveOrder,
  updateOrderStatus,
  getOrder,
  closeDb,
};
