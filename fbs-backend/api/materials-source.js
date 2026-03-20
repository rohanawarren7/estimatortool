// api/materials-source.js — Materials Sourcing Stage
// Receives: identified materials list from /api/materials-identify
// Model: perplexity/sonar-pro-search (via OpenRouter) — real-time web search + citations
// Returns: sourced products per material with UK supplier links, prices, pack sizes
//
// POST /api/materials-source
// Body: { materials: [...from identify stage], budget: "standard"|"mid"|"premium" }
// Response: { sourced: [...], grand_total: number, currency: "GBP" }
//
// Perplexity Sonar Pro is called once per batch of BATCH_SIZE items.
// Batch size reduced from 15 → 10 to improve JSON reliability and avoid truncation.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL          = "perplexity/sonar-pro-search";
const BATCH_SIZE     = 10;   // Reduced from 15 for better JSON reliability
const MAX_TOKENS_PER_BATCH = 10000; // Raised from 8000

function buildSourcingPrompt(materials, budget = "standard") {
  const budgetGuidance = {
    standard: "trade-grade / builder's merchant quality — Screwfix, Toolstation, Jewson, Travis Perkins, Selco, B&Q, Wickes",
    mid: "mid-market quality — B&Q, Wickes, Topps Tiles, Tile Giant, Karndean, Dulux Trade",
    premium: "premium quality — Topps Tiles (designer range), Fired Earth, Mandarin Stone, Duravit, Hansgrohe, Osmo"
  };

  const materialsJSON = JSON.stringify(materials.map(m => ({
    id: m.id,
    trade: m.trade,
    material_name: m.material_name,
    spec: m.spec,
    quantity_gross: m.quantity_gross,
    unit: m.unit,
    search_query: m.search_query,
    preferred_suppliers: m.preferred_suppliers,
  })), null, 2);

  return `You are a construction materials buyer for a London building contractor (Fallow Building Services).

Search the internet RIGHT NOW for current UK pricing for each material listed below. Use live supplier websites.

Budget level: ${budget.toUpperCase()} — source from: ${budgetGuidance[budget] || budgetGuidance.standard}

MATERIALS TO SOURCE (${materials.length} items):
${materialsJSON}

FOR EACH MATERIAL:
1. Search for the specific product using the search_query field
2. Find 2–3 real UK supplier options with current prices (not estimated)
3. Calculate total cost = unit_price × quantity_gross (accounting for pack sizes)
4. Always include a direct product URL (must be a real, clickable URL to the product page)
5. Note if the item is currently in stock (if inferable from the page)
6. Prefer the preferred_suppliers list but always find the best-value option too

IMPORTANT RULES:
- Use ONLY real, currently available UK products with verified prices
- URLs must be actual product pages, not search result pages
- If you cannot find an exact match, find the closest equivalent and note the deviation
- For tiles: always calculate packs needed based on pack coverage (m² per box/pack)
- For paint: always calculate tins needed based on coverage (m² per litre typical = 12–14 m² first coat, 16 m² second coat)
- For screed/plaster: bags needed based on coverage per bag (noted on product page)
- Round UP to whole packs/tins/bags — never round down
- Flag any material where price confidence is low (estimated, not found on live page)

RESPOND ONLY in this exact JSON format — no markdown, no preamble:
{
  "sourced": [
    {
      "id": "mat_001",
      "trade": "Tiling (floor)",
      "material_name": "Porcelain floor tile 600x600mm",
      "spec": "600x600mm, matt, R10",
      "quantity_gross": 11.8,
      "unit": "m²",
      "options": [
        {
          "rank": 1,
          "supplier": "Topps Tiles",
          "product_name": "Exact product name from website",
          "product_url": "https://www.toppstiles.co.uk/...",
          "unit_price": 18.50,
          "unit_description": "per m²",
          "pack_coverage": 1.44,
          "pack_coverage_unit": "m² per box",
          "packs_required": 9,
          "pack_price": 26.64,
          "total_cost": 239.76,
          "in_stock": true,
          "notes": "Optional note about delivery, lead time, or spec deviation"
        }
      ],
      "recommended_option_index": 0,
      "recommended_total": 239.76,
      "price_confidence": "high",
      "citation_urls": ["https://..."]
    }
  ],
  "grand_total": 0.00,
  "currency": "GBP",
  "budget_level": "${budget}",
  "search_timestamp": "${new Date().toISOString()}",
  "notes": "Any overall notes"
}`;
}

// --------------------------------------------------------------------------
// Simple JSON repair: truncate to last complete sourced object, close array/object
// --------------------------------------------------------------------------
function repairJson(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end   = clean.lastIndexOf("}");
  if (start === -1) return null;
  if (end !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  // Attempt repair: find last complete sourced entry (ends with "}," or "}" before "]")
  const lastGoodBrace = clean.lastIndexOf("},", end);
  if (lastGoodBrace > start) {
    const repaired = clean.slice(start, lastGoodBrace + 1) + '],"grand_total":0,"currency":"GBP","notes":"[truncated — partial results]"}';
    try { return JSON.parse(repaired); } catch {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  const { materials, budget = "standard" } = req.body;

  if (!materials || !Array.isArray(materials) || materials.length === 0) {
    return res.status(400).json({ error: "materials array is required" });
  }

  const validBudgets = ["standard", "mid", "premium"];
  const safeBudget = validBudgets.includes(budget) ? budget : "standard";

  // Batch into groups of BATCH_SIZE
  const batches = [];
  for (let i = 0; i < materials.length; i += BATCH_SIZE) {
    batches.push(materials.slice(i, i + BATCH_SIZE));
  }

  console.log(`Materials source: ${materials.length} items → ${batches.length} batch(es) of max ${BATCH_SIZE}`);

  const allSourced = [];

  try {
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch  = batches[batchIdx];
      const prompt = buildSourcingPrompt(batch, safeBudget);

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://fallowbuildingservices.co.uk",
          "X-Title": "FBS Materials Sourcer"
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS_PER_BATCH,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        console.error(`Perplexity error on batch ${batchIdx}:`, err);
        return res.status(502).json({
          error: err?.error?.message || `Perplexity API error ${response.status}`
        });
      }

      const data      = await response.json();
      const raw       = data.choices?.[0]?.message?.content || "";
      const finishReason = data.choices?.[0]?.finish_reason;
      const citations = data.citations || [];

      console.log(`Batch ${batchIdx}: ${raw.length} chars, finish: ${finishReason}`);

      const parsed = repairJson(raw);
      if (!parsed) {
        console.warn(`Batch ${batchIdx}: No valid JSON found, skipping. Raw: ${raw.slice(0, 300)}`);
        continue;
      }

      if (parsed.sourced && Array.isArray(parsed.sourced)) {
        const enriched = parsed.sourced.map(item => ({
          ...item,
          citation_urls: item.citation_urls?.length ? item.citation_urls : citations.slice(0, 3),
          recommended_total: Number(item.recommended_total) || 0,
        }));
        allSourced.push(...enriched);
      }
    }

    // Grand total from recommended options
    const grandTotal = allSourced.reduce((sum, item) => sum + (item.recommended_total || 0), 0);

    return res.status(200).json({
      sourced: allSourced,
      grand_total: Math.round(grandTotal * 100) / 100,
      currency: "GBP",
      budget_level: safeBudget,
      total_line_items: allSourced.length,
      search_timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error("materials-source error:", err);
    return res.status(500).json({ error: err.message });
  }
};
