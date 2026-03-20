// api/materials-identify.js — Materials Identification Stage
// Receives: site images (base64) + scope JSON from Kimi + site description
// Model: google/gemini-2.5-pro-preview (via OpenRouter) — deep visual reasoning
// Returns: structured list of materials with specs, quantities, and search queries
//
// POST /api/materials-identify
// Body: { images: [{b64, type}], scopeItems: [...], description: string, jobDescription: string }
// Response: { materials: [...] }
//
// CHUNKING: if scopeItems.length > CHUNK_SIZE, the scope is split into smaller batches
// and Gemini is called once per chunk (images re-used each time). Results are merged.
// This avoids finish_reason=length truncation on large jobs (e.g., 26 scope items).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL          = "google/gemini-2.5-pro-preview";
const MAX_TOKENS     = 32000;  // Raised from 16000; Gemini 2.5 Pro supports up to 65k output
const CHUNK_SIZE     = 12;     // Scope items per Gemini call (keeps output well under token limit)
const MAX_IMAGES     = 20;     // Hard cap on images per call

const IDENTIFY_PROMPT = `You are a specialist construction materials estimator working for Fallow Building Services (FBS), a London-based building contractor.

You have been given:
1. Site photos or video frames of the job
2. A quantity takeoff (scope items with trade, description, quantity, unit)
3. A site inspection report

Your task is to produce a detailed, line-item materials schedule — NOT labour. For every scope item in the takeoff, identify the specific physical materials required to complete that item of work.

RULES:
1. Cover ALL scope items. Do not skip any trade.
2. For each material, provide:
   - A specific product description (not generic — include dimensions, grade, finish, standard)
   - The net quantity needed (from the scope) and the gross quantity with waste applied
   - A precise UK supplier search query that will return real product results from Screwfix, Toolstation, Jewson, Topps Tiles, Travis Perkins, B&Q, Wickes, Selco, City Electrical Factors, or similar UK trade suppliers
3. Break compound scope items into individual materials:
   - Example: "Tiling (floor) 10 m²" → (a) floor tiles m², (b) tile adhesive bags, (c) grout bags, (d) tile trim/edge strip m
   - Example: "Plastering / Skimming 30 m²" → (a) bonding coat bags, (b) finish plaster bags, (c) plasterboard if boarding first
   - Example: "Second Fix Electrical 20 hrs" → (a) white plastic sockets 13A, (b) single-gang switches, (c) ceiling roses/pendants, (d) consumer unit if CU swap
4. Waste factors to apply to net quantity:
   - Tiles: +12% (straight lay) or +15% (diagonal/herringbone)
   - Plastering materials: +10%
   - Paint: +10% first coat, +5% second coat (round up to nearest litre)
   - Timber / skirting / coving: +10%
   - Electrical cable: +15% (running tolerance)
   - Plumbing pipe: +10%
   - Flooring (LVT/engineered): +10%
   - Screeding: +5%
   - All other materials: +5% default
5. Use images to infer material specifications:
   - Tile size and finish visible? Note it.
   - Existing wall colour? Note for paint match.
   - Existing fixture grade (budget / mid / high)? Match it.
   - Any drawings visible? Extract dimensions and specs.
   - First-fix items visible (dust sheets, tarpaulins, temporary lighting)? Include them.
6. For electrical: only include materials here if visible in images or explicit in scope. Do NOT guess high-spec finishes unless evidence supports it.
7. Mark confidence: "high" if spec clearly visible in images or stated in brief; "low" if inferred.
8. For items with significant uncertainty (e.g., exact tile size not visible), provide a reasonable spec assumption and flag it.

TARGET UK SUPPLIERS BY TRADE (use these in search_query):
- Electrical: Screwfix, Toolstation, CEF (City Electrical Factors), Rexel, RS Components
- Plumbing: Screwfix, Toolstation, Plumbbase, Wolseley, Graham
- Tiles: Topps Tiles, Tile Giant, Wickes, Fired Earth (high-end), CTD Tiles
- Plastering: Jewson, Travis Perkins, Selco, Buildbase
- Timber/Joinery: Jewson, Travis Perkins, Selco, B&Q, Wickes
- Flooring: Karndean, Topps Tiles, B&Q, Wickes, Tile Giant
- Paint: Dulux (B&Q/Screwfix), Johnstone's (Toolstation), Crown (B&Q)
- Fixings/General: Screwfix, Toolstation, Wickes
- Protection/First-fix: Screwfix, Toolstation (dust sheets, tarpaulins, masking tape, floor protection)

Respond ONLY in this exact JSON format — no markdown, no preamble:
{
  "job_ref": "string or null",
  "materials": [
    {
      "id": "mat_001",
      "trade": "Trade Name from scope",
      "scope_item_ref": "Brief description of the scope item this relates to",
      "material_name": "Specific product description",
      "spec": "Dimensions, grade, finish, standard (e.g., 600x600mm porcelain, R10, BS EN 14411)",
      "quantity_net": 10.5,
      "unit": "m² or item or bag or litre or m or roll or box",
      "waste_factor": 1.12,
      "quantity_gross": 11.8,
      "search_query": "UK supplier search string (include dimensions + finish + trade brand if visible)",
      "preferred_suppliers": ["Topps Tiles", "Tile Giant"],
      "confidence": "high",
      "notes": "Optional — spec assumption, visible finish inference, or flag"
    }
  ],
  "total_materials_count": 0,
  "assumptions": ["assumption 1"]
}`;

// --------------------------------------------------------------------------
// Single Gemini call for a subset of scopeItems
// --------------------------------------------------------------------------
async function runIdentifyChunk({ images, scopeItems, description, jobDescription, jobRef, chunkIndex }) {
  const contentParts = [];

  const textBlock = [
    jobDescription ? `JOB BRIEF: "${jobDescription}"` : null,
    jobRef ? `JOB REFERENCE: ${jobRef}` : null,
    description ? `SITE INSPECTION REPORT:\n${description}` : null,
    chunkIndex > 0
      ? `NOTE: This is chunk ${chunkIndex + 1} of a multi-part analysis. IDs should start from mat_${String(chunkIndex * CHUNK_SIZE + 1).padStart(3, "0")}. Cover ONLY the scope items listed below.`
      : null,
    `QUANTITY TAKEOFF (scope items to source materials for):\n${JSON.stringify(scopeItems, null, 2)}`,
    IDENTIFY_PROMPT,
  ].filter(Boolean).join("\n\n");

  contentParts.push({ type: "text", text: textBlock });

  if (images && images.length > 0) {
    images.slice(0, MAX_IMAGES).forEach(img => {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${img.type};base64,${img.b64}` }
      });
    });
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://fallowbuildingservices.co.uk",
      "X-Title": "FBS Materials Identifier"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: contentParts }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const finishReason = data.choices?.[0]?.finish_reason;
  console.log(`Materials identify chunk ${chunkIndex}: ${raw.length} chars, finish: ${finishReason}`);

  // If still truncated, log a warning (chunk size may need reducing)
  if (finishReason === "length") {
    console.warn(`Chunk ${chunkIndex} still hit length limit. Consider reducing CHUNK_SIZE.`);
  }

  // Strip thinking blocks and markdown fences
  const stripped = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/g, "")
    .trim();

  const start = stripped.indexOf("{");
  let end = stripped.lastIndexOf("}");
  if (start === -1) {
    throw new Error(`No JSON found in chunk ${chunkIndex}. finish_reason=${finishReason}. Raw: ${raw.slice(0, 200)}`);
  }

  // JSON repair: if finish_reason=length the JSON may be incomplete — attempt to close it
  let jsonSlice = stripped.slice(start, end + 1);
  if (finishReason === "length" || end === -1) {
    // Truncate to the last complete material object boundary
    const lastCompleteObj = jsonSlice.lastIndexOf("},");
    if (lastCompleteObj > -1) {
      jsonSlice = jsonSlice.slice(0, lastCompleteObj + 1) + '],"total_materials_count":0,"assumptions":[]}';
      console.warn(`Chunk ${chunkIndex}: JSON repaired by truncating to last complete object.`);
    } else {
      throw new Error(`Cannot repair truncated JSON in chunk ${chunkIndex}.`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch (parseErr) {
    console.error("JSON parse failed. Slice:", jsonSlice.slice(0, 500));
    throw new Error(`JSON parse failed: ${parseErr.message}. finish_reason=${finishReason}`);
  }

  return parsed;
}

// --------------------------------------------------------------------------
// Normalise a materials array — ensures all required fields, reassigns IDs
// --------------------------------------------------------------------------
function normaliseMaterials(materials, idOffset = 0) {
  return materials.map((mat, idx) => ({
    id: `mat_${String(idOffset + idx + 1).padStart(3, "0")}`,
    trade: mat.trade || "General",
    scope_item_ref: mat.scope_item_ref || "",
    material_name: mat.material_name || "Unspecified material",
    spec: mat.spec || "",
    quantity_net: Number(mat.quantity_net) || 0,
    unit: mat.unit || "item",
    waste_factor: Number(mat.waste_factor) || 1.05,
    quantity_gross: Number(mat.quantity_gross) || Math.ceil((mat.quantity_net || 0) * (mat.waste_factor || 1.05)),
    search_query: mat.search_query || mat.material_name,
    preferred_suppliers: mat.preferred_suppliers || [],
    confidence: mat.confidence || "low",
    notes: mat.notes || "",
  }));
}

// --------------------------------------------------------------------------
// Main handler
// --------------------------------------------------------------------------
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

  const { images, scopeItems, description, jobDescription, jobRef } = req.body;

  if (!scopeItems || !Array.isArray(scopeItems) || scopeItems.length === 0) {
    return res.status(400).json({ error: "scopeItems array is required" });
  }
  if (!description && (!images || images.length === 0)) {
    return res.status(400).json({ error: "Either description or images must be provided" });
  }

  // Prepare images array (cap at MAX_IMAGES)
  const imgSlice = (images && Array.isArray(images)) ? images.slice(0, MAX_IMAGES) : [];

  // Split scopeItems into chunks if needed
  const chunks = [];
  for (let i = 0; i < scopeItems.length; i += CHUNK_SIZE) {
    chunks.push(scopeItems.slice(i, i + CHUNK_SIZE));
  }

  console.log(`Materials identify: ${scopeItems.length} scope items → ${chunks.length} chunk(s), ${imgSlice.length} images`);

  try {
    const allMaterials = [];
    const allAssumptions = [];
    let jobRefOut = jobRef || null;

    for (let i = 0; i < chunks.length; i++) {
      const result = await runIdentifyChunk({
        images:       imgSlice,
        scopeItems:   chunks[i],
        description,
        jobDescription,
        jobRef,
        chunkIndex:   i,
      });

      if (result.job_ref && !jobRefOut) jobRefOut = result.job_ref;
      if (result.assumptions) allAssumptions.push(...result.assumptions);

      const normalised = normaliseMaterials(result.materials || [], allMaterials.length);
      allMaterials.push(...normalised);
    }

    return res.status(200).json({
      job_ref: jobRefOut,
      materials: allMaterials,
      total_materials_count: allMaterials.length,
      assumptions: [...new Set(allAssumptions)], // dedupe
      chunks_processed: chunks.length,
    });

  } catch (err) {
    console.error("materials-identify error:", err);
    return res.status(500).json({ error: err.message });
  }
};
