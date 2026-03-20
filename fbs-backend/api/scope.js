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

// Paradigm codes: A=hourly, B=area m², C=per item/pt, D=linear m, E=fixed lump sum
const VALID_PARADIGMS = ["A", "B", "C", "D", "E"];

// Default paradigm by unit — fallback when AI omits paradigm field
const UNIT_TO_PARADIGM = {
  "m²": "B", "m2": "B",
  "hrs": "A", "hr": "A", "hours": "A",
  "m": "D",
  "item": "C", "items": "C", "door": "C", "doors": "C", "unit": "C", "units": "C", "pt": "C", "pts": "C",
  "fixed": "E",
};

const SCOPE_PROMPT = `You are a professional quantity surveyor and construction estimator working for a London-based contractor called Fallow Building Services (FBS).

A site inspection report has been produced from photos and video frames of the job. Use it — along with any job brief and audio transcript provided — to produce a structured quantity takeoff.

COMPLEXITY TIERS — assess from the visual evidence and job brief, then choose exactly one:
- "like-for-like swap": direct replacement only, same layout, no structural work, minimal new services
- "partial renovation": some layout changes, moderate services work, cosmetic refurb of part of a property
- "full renovation": full gut-out, rerouting services, multi-room scope, structural elements likely
- "new build / extension": all trades from scratch, new structure, full M&E installation

JOB TYPE CATEGORIES — identify the primary work type, choose the closest match:
Bathroom / ensuite refurb | En-suite conversion | Kitchen remodel | Bedroom / living room renovation |
Full flat renovation | Full house renovation | Loft conversion | Extension / side return |
Basement conversion | Garage conversion | Commercial office fit-out | Retail / hospitality fit-out |
HMO room refurb | External works / landscaping | Structural alteration | Electrical rewire |
Commercial WC refurb | New build | Mixed / multi-area works

PRICING PARADIGMS — assign the correct paradigm code to each item:
- A = hourly rate (unit: hrs) — all time-based trades
- B = area rate (unit: m²) — all area-based trades
- C = per item / point (unit: item, door, unit, pt) — fixed-count installations
- D = linear rate (unit: m) — runs of skirting, coving, drainage channels
- E = fixed lump sum (unit: fixed) — certifications, scaffolding, plant hire, MVHR systems

ELECTRICAL PARADIGM GUIDE:
- First Fix Electrical [A, hrs]: cable runs, back-boxes, conduit, trunking
- Second Fix Electrical [A, hrs]: socket/switch plates, pendants, final connections, consumer unit swap
- Electrical Testing & Cert [E, fixed]: EICR or completion certificate — one item per job
- Data / AV / Low Voltage [A, hrs]: ethernet, CCTV, door entry, structured cabling, AV rack
- Underfloor Heating (electric) [B, m²]: mat or cable UFH under tiles or screed
- Fire Protection / Sprinklers [A, hrs]: sprinkler heads, pipework, alarm devices

Rules:
1. Identify every trade visible or implied across these categories:
   Area trades (m²): Plastering / Skimming, Tiling (floor), Tiling (wall), Painting & Decorating,
     Screeding, Boarding / Dry Lining, Insulation (thermal/acoustic), Brickwork / Blockwork,
     Roofing, Flooring (LVT / Engineered), Flooring (carpet), Suspended Ceilings,
     External Rendering, Waterproofing / Tanking, Underfloor Heating (electric),
     Underfloor Heating (wet), External Cleaning / Jet Wash
   Hourly trades (hrs): First Fix Electrical, Second Fix Electrical, Plumbing,
     Carpentry / Joinery, Demolition / Strip Out, Soft Strip / Careful Demolition, General Labour,
     HVAC / Mechanical Ventilation, Ductwork Installation, Fire Protection / Sprinklers,
     Groundworks / Excavation, Drainage, External Works / Landscaping, Steelwork / Structural,
     Data / AV / Low Voltage, Kitchen Units Installation, Fit-out Joinery
   Per-item trades: Bathroom Suite Installation (item), Door Hanging / Ironmongery (door),
     Window / Door Frame Install (unit)
   Linear trades (m): Skirting / Architrave, Coving / Cornicing, Drainage (linear)
   Fixed trades: Electrical Testing & Cert (fixed), Scaffolding (fixed), MVHR System (supply & install) (fixed),
     Temporary Works / Shoring (fixed)
2. For each trade, estimate quantities using the paradigm unit above. Do NOT mix units.
3. Estimate BASELINE quantities — minimum competent scope for like-for-like swap. The pricing engine applies complexity multipliers separately. Calibrate against these London benchmarks:

BATHROOM / ENSUITE — "like-for-like swap" baseline:
  Strip out: 4–6 hrs | Plumbing: 8–14 hrs | Second Fix Electrical: 4–8 hrs
  Plastering / Skimming: 12–18 m² | Tiling (wall): 8–14 m² | Tiling (floor): 3–5 m²
  Painting & Decorating: 12–18 m²

BATHROOM — "full renovation" baseline (layout change, wet room conversion):
  Demolition / Strip Out: 6–10 hrs | Plumbing: 16–28 hrs | First Fix Electrical: 8–16 hrs
  Waterproofing / Tanking: 8–14 m² | Boarding / Dry Lining: 10–16 m²
  Plastering / Skimming: 14–22 m² | Tiling (wall): 14–24 m² | Tiling (floor): 4–8 m²

EN-SUITE CONVERSION — "full renovation" baseline (new bathroom carved from bedroom):
  Demolition / Strip Out: 4–8 hrs | Carpentry / Joinery: 8–16 hrs (partition framing)
  Boarding / Dry Lining: 12–20 m² | Plumbing: 14–24 hrs | First Fix Electrical: 6–12 hrs
  Waterproofing / Tanking: 6–10 m² | Tiling (wall): 8–16 m² | Tiling (floor): 2–4 m²

KITCHEN — "like-for-like swap" baseline (units replaced, no structural):
  Demolition / Strip Out: 4–8 hrs | Plumbing: 6–12 hrs | Second Fix Electrical: 6–10 hrs
  Kitchen Units Installation: 12–20 hrs | Boarding / Dry Lining: 10–18 m²
  Flooring (LVT / Engineered): 8–14 m²

KITCHEN — "partial renovation" baseline (remove wall, extend services):
  Demolition / Strip Out: 8–16 hrs | Plumbing: 12–24 hrs
  First Fix Electrical: 10–18 hrs | Second Fix Electrical: 6–10 hrs
  Steelwork / Structural: 4–12 hrs | Kitchen Units Installation: 20–36 hrs
  Plastering / Skimming: 14–24 m²

BEDROOM / LIVING ROOM — "partial renovation" baseline:
  Soft Strip / Careful Demolition: 2–4 hrs | Plastering / Skimming: 20–40 m²
  Painting & Decorating: 30–60 m² | Skirting / Architrave: 20–40 m
  Flooring (LVT / Engineered): 12–20 m² | Second Fix Electrical: 4–8 hrs

FULL FLAT (1–2 bed) — "full renovation" baseline:
  Demolition / Strip Out: 20–40 hrs | Plastering / Skimming: 80–140 m²
  Painting & Decorating: 100–180 m² | Plumbing: 30–50 hrs
  First Fix Electrical: 20–40 hrs | Second Fix Electrical: 20–40 hrs
  Tiling (wall): 20–40 m² | Flooring (LVT / Engineered): 30–60 m²
  Carpentry / Joinery: 30–50 hrs

FULL FLAT (3-bed) / FULL HOUSE (3-bed semi) — "full renovation" baseline:
  Demolition / Strip Out: 40–80 hrs | Plastering / Skimming: 180–300 m²
  Painting & Decorating: 200–400 m² | Plumbing: 50–80 hrs
  First Fix Electrical: 40–70 hrs | Second Fix Electrical: 30–50 hrs
  Flooring (LVT / Engineered): 60–120 m² | Carpentry / Joinery: 50–90 hrs

COMMERCIAL OFFICE — "full renovation" baseline:
  Soft Strip / Careful Demolition: 20–60 hrs | Boarding / Dry Lining: 60–120 m²
  Suspended Ceilings: 40–100 m² | First Fix Electrical: 40–80 hrs
  Second Fix Electrical: 20–50 hrs | Data / AV / Low Voltage: 20–60 hrs
  HVAC / Mechanical Ventilation: 20–50 hrs | Ductwork Installation: 20–50 hrs
  Painting & Decorating: 80–160 m² | Flooring (LVT / Engineered): 40–100 m²

COMMERCIAL WC REFURB — "partial renovation" baseline:
  Demolition / Strip Out: 6–12 hrs | Plumbing: 12–24 hrs
  Second Fix Electrical: 6–12 hrs | Waterproofing / Tanking: 8–16 m²
  Tiling (wall): 12–24 m² | Tiling (floor): 4–8 m² | Suspended Ceilings: 6–12 m²

RETAIL / HOSPITALITY FIT-OUT — "full renovation" baseline:
  Soft Strip / Careful Demolition: 20–60 hrs | Boarding / Dry Lining: 40–100 m²
  Plastering / Skimming: 40–80 m² | First Fix Electrical: 30–70 hrs
  Second Fix Electrical: 20–40 hrs | Data / AV / Low Voltage: 10–30 hrs
  Fit-out Joinery: 40–100 hrs | Flooring (LVT / Engineered): 40–100 m²
  Painting & Decorating: 60–140 m²

HMO ROOM REFURB — "partial renovation" baseline:
  Soft Strip / Careful Demolition: 2–4 hrs | Plastering / Skimming: 15–30 m²
  Painting & Decorating: 20–40 m² | Second Fix Electrical: 2–4 hrs
  Flooring (LVT / Engineered): 8–14 m² | Carpentry / Joinery: 4–8 hrs

LOFT CONVERSION — "new build / extension" baseline:
  Steelwork / Structural: 20–40 hrs | Roofing: 20–40 m²
  Insulation (thermal/acoustic): 40–80 m² | Boarding / Dry Lining: 80–160 m²
  First Fix Electrical: 20–40 hrs | Second Fix Electrical: 10–20 hrs
  Plumbing: 20–40 hrs | Plastering / Skimming: 60–100 m²
  Carpentry / Joinery: 40–80 hrs | Scaffolding: 1 fixed

EXTENSION / SIDE RETURN — "new build / extension" baseline:
  Groundworks / Excavation: 20–60 hrs | Brickwork / Blockwork: 30–80 m²
  Steelwork / Structural: 10–30 hrs | Roofing: 15–40 m²
  First Fix Electrical: 20–50 hrs | Plumbing: 15–40 hrs
  Insulation (thermal/acoustic): 20–50 m² | Plastering / Skimming: 40–80 m²
  Scaffolding: 1 fixed

BASEMENT CONVERSION — "new build / extension" baseline:
  Groundworks / Excavation: 40–120 hrs | Waterproofing / Tanking: 40–100 m²
  Brickwork / Blockwork: 20–60 m² | Drainage: 10–30 hrs
  First Fix Electrical: 20–50 hrs | Plumbing: 15–40 hrs
  Boarding / Dry Lining: 40–100 m² | Plastering / Skimming: 40–80 m²
  Temporary Works / Shoring: 1 fixed

GARAGE CONVERSION — "partial renovation" baseline:
  Demolition / Strip Out: 4–10 hrs | Insulation (thermal/acoustic): 20–50 m²
  Boarding / Dry Lining: 20–50 m² | Plastering / Skimming: 20–50 m²
  First Fix Electrical: 8–20 hrs | Second Fix Electrical: 6–14 hrs
  Flooring (LVT / Engineered): 15–30 m² | Painting & Decorating: 30–60 m²

ELECTRICAL REWIRE (whole house) — "partial renovation" baseline:
  First Fix Electrical: 40–80 hrs | Second Fix Electrical: 20–40 hrs
  Electrical Testing & Cert: 1 fixed | Plastering / Skimming: 20–50 m²
  Painting & Decorating: 20–50 m²

EXTERNAL WORKS — "partial renovation" baseline:
  Groundworks / Excavation: 10–40 hrs | External Works / Landscaping: 20–60 hrs
  Drainage (linear): 10–40 m | Brickwork / Blockwork: 10–30 m²
  External Cleaning / Jet Wash: 20–60 m²

Always scale to actual area/room count visible in images. Use the lower end of each range unless clear evidence warrants higher. For multi-area jobs, sum room-by-room.

3b. Err on the side of inclusion, not omission. If a trade is implied or uncertain, include it with confidence: "low" rather than leaving it out. This produces a transparent provisional sum rather than a missing scope item.
4. Clearly state any assumptions about dimensions or quantities.
5. Set confidence: "high" for items clearly visible or explicitly instructed. Set confidence: "low" for items implied, uncertain, or requiring site verification. Do NOT use site_queries to exclude trades — site_queries is for dimension/access questions only. Every identifiable trade scope item belongs in "items".
6. Do NOT include pricing — quantities only.

Respond ONLY in this exact JSON format, no markdown, no preamble:
{
  "job_type": "Bathroom / ensuite refurb",
  "complexity": "like-for-like swap",
  "scope_summary": "One sentence describing the works.",
  "assumptions": ["assumption 1", "assumption 2"],
  "items": [
    { "trade": "Trade Name", "description": "Brief description (≤5 words)", "quantity": 0.0, "unit": "m² or hrs or item or m or fixed", "paradigm": "A", "confidence": "high" }
  ],
  "site_queries": ["Dimension/access question 1"]
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

    // Ensure every item has confidence + paradigm fields
    if (parsed.items) {
      parsed.items = parsed.items.map(item => {
        const paradigm = VALID_PARADIGMS.includes(item.paradigm)
          ? item.paradigm
          : (UNIT_TO_PARADIGM[(item.unit || "").toLowerCase()] || "A");
        return {
          ...item,
          confidence: item.confidence || "high",
          paradigm,
        };
      });
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
