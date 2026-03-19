// api/price.js — Stage 2: Quantities + Rates → Priced Quote
// Deployed on Vercel. API key never leaves the server.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "moonshotai/kimi-k2.5";

function buildPricingPrompt(items, rates, margin, prelims, cisDeduction) {
  return `You are a construction cost estimator for Fallow Building Services (FBS), a London contractor.

Apply the following labour rates to the quantity takeoff below. Then add preliminaries and the FBS margin.

QUANTITY TAKEOFF:
${JSON.stringify(items, null, 2)}

LABOUR RATES (£ per unit):
${rates.map(r => `- ${r.trade}: £${r.rate}/${r.unit}`).join("\n")}

INSTRUCTIONS:
1. Match each takeoff item to the closest trade rate above.
2. Calculate: Cost = Quantity × Rate
3. After summing all trade costs, add ${prelims}% for Preliminaries/Supervision.
4. Then add FBS margin of ${margin}% on top of the subtotal + prelims.
5. Also calculate the CIS deduction: ${cisDeduction}% of the subtotal. This is the amount FBS withholds from subcontractors — it is INFORMATIONAL ONLY and does NOT change the total.
6. Round all costs to the nearest pound.
7. Keep each "description" field to 5 words or fewer — brevity is essential.

Respond ONLY in this exact JSON format, no markdown, no preamble:
{
  "line_items": [
    { "trade": "Trade Name", "description": "desc", "quantity": 0.0, "unit": "m²", "rate": 0.0, "cost": 0.0 }
  ],
  "subtotal": 0,
  "prelims_pct": ${prelims},
  "prelims_cost": 0,
  "margin_pct": ${margin},
  "margin_cost": 0,
  "cis_pct": ${cisDeduction},
  "cis_cost": 0,
  "total": 0,
  "vat_note": "Standard rated 20% VAT applicable unless zero-rated (e.g. disabled adaptation)"
}`;
}

module.exports = async function handler(req, res) {
  // ── CORS ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Auth ──
  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  // ── Validate body ──
  const { items, rates, margin = 25, prelims = 15, cisDeduction = 20 } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array is required" });
  }
  if (!rates || !Array.isArray(rates)) {
    return res.status(400).json({ error: "rates array is required" });
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://fallowbuildingservices.co.uk",
        "X-Title": "FBS Quote Scoper"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        temperature: 0.6,
        messages: [{
          role: "user",
          content: buildPricingPrompt(items, rates, margin, prelims, cisDeduction)
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `Kimi API error ${response.status}` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object found in model response");
    const parsed = JSON.parse(clean.slice(start, end + 1));

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("price error:", err);
    return res.status(500).json({ error: err.message });
  }
}
