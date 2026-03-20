// api/project-store.js — Project Data Persistence
// Stores the OUTPUT of the AI analysis pipeline (description, scope, identified materials,
// sourced results) in Vercel KV so the same job can be resumed without re-uploading images.
//
// NOTE: Raw images (base64) are NOT stored here — Vercel KV has a 512 KB per-key limit
// and images are typically 1–5 MB total. The valuable thing to persist is the AI output.
// Images must be re-uploaded if the user wants to re-run identification on a stored job.
//
// Endpoints:
//   POST   /api/project-store          { syncKey, jobRef, jobDescription, description?,
//                                        scopeItems?, identified?, sourced?, imageCount? }
//   GET    /api/project-store?syncKey=X&jobRef=Y          → { project }
//   GET    /api/project-store/list?syncKey=X              → { projects: [ summary, ... ] }
//   DELETE /api/project-store?syncKey=X&jobRef=Y          → { ok: true }
//
// KV keys:
//   fbs:proj:<syncKey>:<jobRef>   → full project JSON (TTL 90 days)
//   fbs:projidx:<syncKey>         → index array of project summaries (TTL 90 days)

const PROJ_PREFIX = "fbs:proj:";
const IDX_PREFIX  = "fbs:projidx:";
const TTL_SECS    = 90 * 24 * 3600; // 90 days

// --------------------------------------------------------------------------
// KV helpers (same pattern as history.js)
// --------------------------------------------------------------------------
function kv() {
  return {
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  };
}

async function kvGet(key) {
  const { url, token } = kv();
  if (!url || !token) return null;
  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify([["GET", key]]),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw  = data?.[0]?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function kvSet(key, value) {
  const { url, token } = kv();
  if (!url || !token) throw new Error("KV not configured — link Vercel KV in the dashboard");
  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify([
      ["SET", key, JSON.stringify(value)],
      ["EXPIRE", key, TTL_SECS],
    ]),
  });
  if (!res.ok) throw new Error(`KV write failed: ${await res.text()}`);
}

async function kvDel(key) {
  const { url, token } = kv();
  if (!url || !token) return;
  await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify([["DEL", key]]),
  });
}

function projKey(syncKey, jobRef) {
  return `${PROJ_PREFIX}${syncKey}:${encodeURIComponent(jobRef)}`;
}

function idxKey(syncKey) {
  return `${IDX_PREFIX}${syncKey}`;
}

// --------------------------------------------------------------------------
// Index helpers
// --------------------------------------------------------------------------
async function addToIndex(syncKey, summary) {
  const idx = (await kvGet(idxKey(syncKey))) || [];
  // Replace existing entry for same jobRef or prepend
  const filtered = idx.filter(p => p.jobRef !== summary.jobRef);
  filtered.unshift(summary); // most recent first
  // Keep last 50 projects in index
  await kvSet(idxKey(syncKey), filtered.slice(0, 50));
}

async function removeFromIndex(syncKey, jobRef) {
  const idx = (await kvGet(idxKey(syncKey))) || [];
  await kvSet(idxKey(syncKey), idx.filter(p => p.jobRef !== jobRef));
}

// --------------------------------------------------------------------------
// Route handler
// --------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  try {
    // ---- LIST -----------------------------------------------------------------
    // GET /api/project-store/list?syncKey=X
    if (req.method === "GET" && req.url && req.url.includes("/list")) {
      const syncKey = req.query?.syncKey;
      if (!syncKey) return res.status(400).json({ error: "syncKey is required" });
      const projects = (await kvGet(idxKey(syncKey))) || [];
      return res.status(200).json({ projects });
    }

    // ---- LOAD -----------------------------------------------------------------
    // GET /api/project-store?syncKey=X&jobRef=Y
    if (req.method === "GET") {
      const { syncKey, jobRef } = req.query || {};
      if (!syncKey || !jobRef) {
        return res.status(400).json({ error: "syncKey and jobRef are required" });
      }
      const project = await kvGet(projKey(syncKey, jobRef));
      if (!project) return res.status(404).json({ error: "Project not found" });
      return res.status(200).json({ project });
    }

    // ---- SAVE -----------------------------------------------------------------
    // POST /api/project-store
    if (req.method === "POST") {
      const {
        syncKey,
        jobRef,
        jobDescription = "",
        description   = "",
        scopeItems    = [],
        identified    = null,
        sourced       = null,
        imageCount    = 0,
      } = req.body || {};

      if (!syncKey || !jobRef) {
        return res.status(400).json({ error: "syncKey and jobRef are required" });
      }

      const project = {
        jobRef,
        jobDescription,
        description,
        scopeItems,
        identified,
        sourced,
        imageCount,
        savedAt: new Date().toISOString(),
        version: 1,
      };

      await kvSet(projKey(syncKey, jobRef), project);

      // Update index
      await addToIndex(syncKey, {
        jobRef,
        jobDescription,
        materialCount: identified?.materials?.length || 0,
        sourcedCount:  sourced?.sourced?.length || 0,
        imageCount,
        savedAt: project.savedAt,
      });

      console.log(`Project saved: ${jobRef} for syncKey ${syncKey.slice(0, 8)}...`);
      return res.status(200).json({ ok: true, savedAt: project.savedAt });
    }

    // ---- DELETE ---------------------------------------------------------------
    // DELETE /api/project-store?syncKey=X&jobRef=Y
    if (req.method === "DELETE") {
      const { syncKey, jobRef } = req.query || {};
      if (!syncKey || !jobRef) {
        return res.status(400).json({ error: "syncKey and jobRef are required" });
      }
      await kvDel(projKey(syncKey, jobRef));
      await removeFromIndex(syncKey, jobRef);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("project-store error:", err);
    return res.status(500).json({ error: err.message });
  }
};
