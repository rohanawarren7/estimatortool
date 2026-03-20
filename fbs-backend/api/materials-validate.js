// api/materials-validate.js — Quantity & Waste-Factor Sanity Check via DeepSeek V3
// POST /api/materials-validate
// Body: { materials: [...], description?: string, jobRef?: string }
// Returns: { validated_materials: [...], flags: [...], summary: string }
//
// Uses DeepSeek V3 (deepseek/deepseek-chat-v3-0324) at ~$0.28/$0.42 per M tokens.
// Purpose: cheap second-pass QS review that catches implausible quantities,
// missing waste factors, and out-of-scope items before sourcing is triggered.
// Cost per validate call: typically < $0.02 per job.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL          = "deepseek/deepseek-chat-v3-0324";

const VALIDATE_PROMPT = `You are a professional quantity surveyor reviewing a bill of materials for a UK building project.

Your task is to validate the materials list below for accuracy and completeness. Check each item against the job description and flag any issues.

For each material item, assess:
1. QUANTITY: Is the quantity_gross plausible for the stated scope? Flag if quantity is suspiciously high, low, or zero.
2. UNIT: Is the unit correct for the material type (e.g. tiles in m², timber in m, fixings in box)?
3. WASTE FACTOR: UK construction norms:
   - Tiles (ceramic/porcelain): 10–15% wastage
   - Tiling adhesive/grout: 10%
   - Flooring (LVT/engineered): 10%
   - Paint/plaster: 5–10%
   - Timber (structural): 5–10%
   - Insulation boards: 5%
   - Bricks/blocks: 5–10%
   Flag if waste allowance appears absent or excessive.
4. SCOPE ALIGNMENT: Does this material make sense for the described job type? Flag if a material seems out of scope.
5. FIRST-FIX ITEMS: Ensure protection materials (dust sheets, floor protection, masking tape) are present where disruption trades are listed.
6. UK MARKET SENSE: Flag if the spec seems unusual for UK residential/commercial work (e.g. non-metric sizes, US-spec products).

RESPOND ONLY with a valid JSON object — no markdown, no preamble:

{
  "validated_materials": [
    {
      "id": "mat_001",
      "status": "ok",
      "flag": null,
      "suggestion": null
    },
    {
      "id": "mat_002",
      "status": "warning",
      "flag": "Quantity 0.5 m² seems low for a full bathroom floor — typical bathroom is 4–6 m²",
      "suggestion": "Increase to 5 m² and add 10% waste = 5.5 m²"
    }
  ],
  "missing_items": [
    {
      "trade": "Painting & Decorating",
      "material_name": "Dust sheets / floor protection",
      "reason": "Strip-out and plastering trades listed but no surface protection materials present"
    }
  ],
  "flags": [
    "3 items have quantities that may be under-estimated",
    "Dust sheets missing despite disruption trades"
  ],
  "summary": "14 of 16 items look correct. 2 quantity warnings and 1 missing protection item noted."
}

JOB DESCRIPTION:
{JOB_DESCRIPTION}

MATERIALS LIST:
{MATERIALS_JSON}
`;

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

  const { materials, description, jobRef } = req.body;

  if (!materials || !Array.isArray(materials) || materials.length === 0) {
    return res.status(400).json({ error: "materials array is required" });
  }

  const jobDescription = description || "No job description provided.";
  const materialsJson = JSON.stringify(
    materials.map(m => ({
      id: m.id,
      trade: m.trade,
      material_name: m.material_name,
      spec: m.spec,
      quantity_gross: m.quantity_gross,
      unit: m.unit,
      confidence: m.confidence,
      notes: m.notes,
    })),
    null,
    2
  );

  const prompt = VALIDATE_PROMPT
    .replace("{JOB_DESCRIPTION}", jobDescription)
    .replace("{MATERIALS_JSON}", materialsJson);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://fallowbuildingservices.co.uk",
        "X-Title": "FBS Materials Validator",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `DeepSeek API error ${response.status}` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const finishReason = data.choices?.[0]?.finish_reason;

    console.log(`materials-validate: ${materials.length} items, jobRef=${jobRef || "none"}, finish_reason=${finishReason}, chars=${raw.length}`);

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end   = clean.lastIndexOf("}");

    if (start === -1 || end === -1) {
      console.error("materials-validate: no JSON in response. Raw:", raw.slice(0, 300));
      return res.status(502).json({ error: "Validation model returned no JSON.", raw: raw.slice(0, 300) });
    }

    let parsed;
    try {
      parsed = JSON.parse(clean.slice(start, end + 1));
    } catch (parseErr) {
      console.error("materials-validate: JSON parse error:", parseErr.message);
      return res.status(502).json({ error: "JSON parse failed: " + parseErr.message, raw: raw.slice(0, 300) });
    }

    // Normalise output structure
    const validatedMaterials = (parsed.validated_materials || []).map(v => ({
      id: v.id,
      status: v.status || "ok",
      flag: v.flag || null,
      suggestion: v.suggestion || null,
    }));

    const missingItems = (parsed.missing_items || []).map(m => ({
      trade: m.trade || "General",
      material_name: m.material_name || "",
      reason: m.reason || "",
    }));

    return res.status(200).json({
      validated_materials: validatedMaterials,
      missing_items: missingItems,
      flags: parsed.flags || [],
      summary: parsed.summary || `Validated ${materials.length} materials.`,
      model_used: MODEL,
      items_checked: materials.length,
    });

  } catch (err) {
    console.error("materials-validate error:", err);
    return res.status(500).json({ error: err.message });
  }
};
