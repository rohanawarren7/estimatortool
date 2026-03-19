// api/history.js — Cross-device history sync via Vercel KV (Upstash Redis)
// GET  /api/history?syncKey=<uuid>  → { history: [...] }
// POST /api/history { syncKey, history } → { ok: true }
//
// Requires env vars auto-injected by Vercel when a KV store is linked:
//   KV_REST_API_URL, KV_REST_API_TOKEN
//
// History is stored under key "fbs:hist:<syncKey>" with a 1-year TTL.

const KEY_PREFIX = "fbs:hist:";
const TTL_SECS   = 365 * 24 * 3600; // 1 year

async function kvGet(syncKey) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify([["GET", KEY_PREFIX + syncKey]]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw  = data?.[0]?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvSet(syncKey, history) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV not configured — link a Vercel KV store in the dashboard");

  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify([
      ["SET", KEY_PREFIX + syncKey, JSON.stringify(history)],
      ["EXPIRE", KEY_PREFIX + syncKey, TTL_SECS],
    ]),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KV write failed: ${err}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  const syncKey = req.method === "GET"
    ? req.query?.syncKey
    : req.body?.syncKey;

  if (!syncKey || typeof syncKey !== "string" || syncKey.length < 10) {
    return res.status(400).json({ error: "syncKey is required" });
  }

  try {
    if (req.method === "GET") {
      const history = await kvGet(syncKey);
      return res.status(200).json({ history: history || [] });
    }

    if (req.method === "POST") {
      const { history } = req.body;
      if (!Array.isArray(history)) {
        return res.status(400).json({ error: "history must be an array" });
      }
      await kvSet(syncKey, history);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("history error:", err);
    return res.status(500).json({ error: err.message });
  }
};
