// api/materials-library.js — Personal materials library (CRUD)
// Backed by a simple in-memory store on the server plus localStorage sync on the client.
// In a production upgrade, swap the in-memory Map for a Vercel KV or PlanetScale call.
//
// GET  /api/materials-library            — list all saved items
// POST /api/materials-library            — add or update an item  { item: {...} }
// DELETE /api/materials-library          — remove an item          { id: "lib_xxx" }

const STORE = new Map(); // process-level cache — survives warm restarts on Vercel

function normaliseItem(raw, existingId) {
  const id = existingId || raw.id || `lib_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    trade: raw.trade || "General",
    material_name: raw.material_name || "Unknown",
    spec: raw.spec || "",
    unit: raw.unit || "item",
    preferred_suppliers: Array.isArray(raw.preferred_suppliers) ? raw.preferred_suppliers : [],
    search_query: raw.search_query || raw.material_name || "",
    last_unit_price: raw.last_unit_price != null ? Number(raw.last_unit_price) : null,
    last_supplier: raw.last_supplier || "",
    last_product_url: raw.last_product_url || "",
    use_count: raw.use_count != null ? Number(raw.use_count) : 1,
    last_used: raw.last_used || new Date().toISOString(),
    notes: raw.notes || "",
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  // GET — list everything, sorted by use_count desc
  if (req.method === "GET") {
    const items = Array.from(STORE.values()).sort((a, b) => b.use_count - a.use_count);
    return res.status(200).json({ items, count: items.length });
  }

  // POST — upsert item
  if (req.method === "POST") {
    const { item } = req.body || {};
    if (!item || !item.material_name) {
      return res.status(400).json({ error: "item.material_name is required" });
    }
    const existing = item.id && STORE.has(item.id) ? STORE.get(item.id) : null;
    const saved = normaliseItem(item, existing?.id);
    if (existing) {
      // bump use count when re-saving a known item
      saved.use_count = (existing.use_count || 0) + 1;
    }
    STORE.set(saved.id, saved);
    return res.status(200).json({ item: saved, action: existing ? "updated" : "created" });
  }

  // DELETE — remove item
  if (req.method === "DELETE") {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id is required" });
    const existed = STORE.delete(id);
    return res.status(200).json({ deleted: existed, id });
  }

  return res.status(405).json({ error: "Method not allowed" });
};
