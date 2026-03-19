// api/scope.js — Stage 3: Site description + context → Quantity Takeoff via Kimi K2.5
// Kimi receives rich text only (no images) — keeps its context free for analysis.
// Option B: Kimi self-assesses job_type and complexity from visual evidence.
// Multiplier table in the frontend owns all complexity uplift.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "moonshotai/kimi-k2.5";

const VALID_TIERS = [
  "like-for-like swap",
  "partial renovation",
  "full renovation",
  "new build / extension",
];

const SCOPE_PROMPT = `You are a professional quantity surveyor and construction estimator working for a London-based contractor called Fallow Building Services (FBS).

A site inspection report has been produced from photos and video frames of the job. Use it — along with any job brief and audio transcript provided — to produce a structured quantity takeoff.

COMPLEXITY TIERS — assess from the visual evidence and job brief, then choose exactly one:
- "like-for-like swap": direct replacement only, same layout, no structural work, minimal new services
- "partial renovation": some layout changes, moderate services work, cosmetic refurb of part of a property
- "full renovation": full gut-out, rerouting services, multi-room scope, structural elements likely
- "new build / extension": all trades from scratch, new structure, full M&E installation

JOB TYPE CATEGORIES — identify the primary work type, choose the closest match:
Bathroom / ensuite refurb | Kitchen remodel | Bedroom / living room renovation |
Full flat renovation | Full house renovation | Loft conversion | Extension / side return |
Commercial office fit-out | Retail / hospitality fit-out | External works / landscaping |
Structural alteration | New build | Mixed / multi-area works

Rules:
1. Identify every trade visible or implied across these categories:
   - Plastering / Skimming, Tiling (floor), Tiling (wall), Painting & Decorating
   - First Fix Electrical, Second Fix Electrical, Plumbing
   - Carpentry / Joinery, Screeding, Boarding / Dry Lining
   - Demolition / Strip Out, General Labour
   - HVAC / Mechanical Ventilation, Ductwork Installation
   - Fire Protection / Sprinklers, Insulation (thermal/acoustic)
   - Groundworks / Excavation, Drainage, External Works / Landscaping
   - Brickwork / Blockwork, Roofing, Flooring (LVT / Engineered)
   - Steelwork / Structural, Suspended Ceilings
2. For each trade, estimate quantities in the EXACT units specified:
   - Area-based work (plastering, tiling, painting, boarding, screeding, insulation, roofing, flooring, brickwork, suspended ceilings): m²
   - Time-based work (electrical, plumbing, carpentry, demolition, HVAC, groundworks, drainage, steelwork, labour): hours
3. Estimate BASELINE quantities — the minimum competent hours/areas for a like-for-like swap. Do NOT inflate for complexity; the pricing engine applies complexity multipliers separately. Calibrate against these London benchmarks:

BATHROOM / ENSUITE — "like-for-like swap" baseline:
  Strip out: 4–6 hrs | Plumbing: 8–14 hrs | Electrical (no new circuits): 4–8 hrs
  Skim walls + ceiling: 12–18 m² | Tiling (walls): 8–14 m² | Tiling (floor): 3–5 m²
  Painting: 12–18 m²

BATHROOM — "full renovation" baseline (layout change, wet room conversion etc.):
  Strip out: 6–10 hrs | Plumbing: 16–28 hrs | Electrical (new circuits): 8–16 hrs
  Boarding: 10–16 m² | Skimming: 14–22 m² | Tiling: 14–30 m²

KITCHEN — "like-for-like swap" baseline (units replaced, no structural):
  Strip out: 4–8 hrs | Plumbing: 6–12 hrs | Electrical (2nd fix): 6–10 hrs
  Carpentry (fit new units): 12–20 hrs | Boarding/skim (if damaged): 10–18 m²
  Flooring: 8–14 m²

KITCHEN — "partial renovation" baseline (remove wall, extend services):
  Strip out: 8–16 hrs | Plumbing: 12–24 hrs | Electrical (1st + 2nd fix): 14–24 hrs
  Structural: 4–12 hrs | Carpentry: 20–36 hrs | Plastering: 14–24 m²

BEDROOM / LIVING ROOM — "partial renovation" baseline:
  Strip out: 2–4 hrs | Plastering: 20–40 m² | Painting: 30–60 m²
  Carpentry (skirtings, architrave): 6–12 hrs | Flooring: 12–20 m²
  Electrical (2nd fix): 4–8 hrs

FULL FLAT (1–2 bed) — "full renovation" baseline:
  Strip out: 20–40 hrs | Plastering: 80–140 m² | Painting: 100–180 m²
  Plumbing: 30–50 hrs | Electrical (1st + 2nd fix): 40–70 hrs
  Tiling: 20–40 m² | Flooring: 30–60 m² | Carpentry: 30–50 hrs

COMMERCIAL OFFICE — "full renovation" baseline:
  Strip out: 20–60 hrs | Boarding / dry lining: 60–120 m² | Suspended ceilings: 40–100 m²
  Electrical (1st + 2nd fix): 60–120 hrs | HVAC / ductwork: 30–80 hrs
  Painting: 80–160 m² | Flooring (LVT): 40–100 m²

LOFT CONVERSION — "new build / extension" baseline:
  Structural / steelwork: 20–40 hrs | Roofing: 20–40 m²
  Boarding: 80–160 m² | Insulation: 80–160 m²
  Electrical (1st + 2nd fix): 40–80 hrs | Plumbing: 20–40 hrs
  Plastering: 60–100 m² | Carpentry (stairs, dormer): 40–80 hrs

Always scale to actual area/room count visible in images. Use the lower end of each range unless clear evidence warrants higher. For multi-area jobs, sum room-by-room.

3b. Err on the side of inclusion, not omission. If a trade is implied or uncertain, include it with confidence: "low" rather than leaving it out. This produces a transparent provisional sum rather than a missing scope item.
4. Clearly state any assumptions about dimensions or quantities.
5. Set confidence: "high" for items clearly visible or explicitly instructed. Set confidence: "low" for items implied, uncertain, or requiring site verification. Do NOT use site_queries to exclude trades — site_queries is for dimension/access questions only. Every identifiable trade scope item belongs in "items".
6. Do NOT include pricing — quantities only.

Respond ONLY in this exact JSON format, no markdown, no preamble:
{
  "job_type": "Bathroom / ensuite refurb",
  "complexity": "like-for-like swap",
  "scope_summary": "One sentence describing the works — e.g. 'Like-for-like bathroom suite swap in a small en-suite, existing layout retained.'",
  "assumptions": ["assumption 1", "assumption 2"],
  "items": [
    { "trade": "Trade Name", "description": "Brief description (≤5 words)", "quantity": 0.0, "unit": "m² or hrs", "confidence": "high" }
  ],
  "site_queries": ["Dimension/access question 1", "Dimension/access question 2"]
}`;

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

  const { description, jobDescription, transcript, refinements } = req.body;
  if (!description) {
    return res.status(400).json({ error: "description (site inspection report) is required" });
  }

  // Build context block — all text, no images
  const contextParts = [];

  if (refinements?.trim()) {
    contextParts.push(
      `ESTIMATOR REFINEMENTS / RESPONSES TO SITE QUERIES:\n${refinements.trim()}\n` +
      `Use this information to adjust quantities and scope. ` +
      `Override or confirm previous assumptions where addressed.`
    );
  }

  if (jobDescription) contextParts.push(`JOB BRIEF FROM CLIENT:\n"${jobDescription}"`);
  if (transcript)     contextParts.push(`AUDIO TRANSCRIPT FROM SITE VIDEO:\n"${transcript}"`);
  contextParts.push(`SITE INSPECTION REPORT (from visual analysis of photos/video frames):\n${description}`);

  const promptText = `${contextParts.join("\n\n")}\n\n${SCOPE_PROMPT}`;

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
        max_tokens: 6000,
        temperature: 0.1,
        messages: [{
          role: "user",
          content: promptText
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `Kimi API error ${response.status}` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";
    console.log("Kimi raw response:", raw.slice(0, 500));
    console.log("Finish reason:", data.choices?.[0]?.finish_reason);
    const clean = raw.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error(`No JSON object found. finish_reason=${data.choices?.[0]?.finish_reason} raw=${raw.slice(0, 200)}`);
    const parsed = JSON.parse(clean.slice(start, end + 1));

    // Ensure every item has a confidence field (default "high" if missing)
    if (parsed.items) {
      parsed.items = parsed.items.map(item => ({
        ...item,
        confidence: item.confidence || "high",
      }));
    }

    // Validate and normalise complexity tier — fallback if Kimi returns unexpected value
    if (!parsed.complexity || !VALID_TIERS.includes(parsed.complexity)) {
      console.warn("Kimi returned unexpected complexity:", parsed.complexity, "— defaulting to 'like-for-like swap'");
      parsed.complexity = "like-for-like swap";
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("scope error:", err);
    return res.status(500).json({ error: err.message });
  }
};
