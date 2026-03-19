// api/scope.js — Stage 3: Site description + context → Quantity Takeoff via Kimi K2.5
// Kimi receives rich text only (no images) — keeps its context free for analysis.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "moonshotai/kimi-k2.5";

const SCOPE_PROMPT = `You are a professional quantity surveyor and construction estimator working for a London-based contractor called Fallow Building Services (FBS).

A site inspection report has been produced from photos and video frames of the job. Use it — along with any job brief and audio transcript provided — to produce a structured quantity takeoff.

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
3. Calibrate quantities against these London benchmarks. For "like-for-like swap":
   - Full bathroom strip out: 4–6 hrs demolition
   - Replumb suite (like-for-like): 8–14 hrs plumbing
   - Bathroom electrical (no new circuits): 4–8 hrs
   - Skimming a bathroom (walls + ceiling): 12–18 m²
   - Painting a bathroom: 12–18 m²
   Use the lower bound for swap/minor work; scale up only with clear visible evidence.
3b. Err on the side of inclusion, not omission. If a trade is implied or uncertain, include it with confidence: "low" rather than leaving it out. This produces a transparent provisional sum rather than a missing scope item.
4. Clearly state any assumptions about dimensions or quantities.
5. Set confidence: "high" for items clearly visible or explicitly instructed. Set confidence: "low" for items implied, uncertain, or requiring site verification. Do NOT use site_queries to exclude trades — site_queries is for dimension/access questions only. Every identifiable trade scope item belongs in "items".
6. Do NOT include pricing — quantities only.

Respond ONLY in this exact JSON format, no markdown, no preamble:
{
  "scope_summary": "One sentence including complexity tier — use one of: [like-for-like swap | partial renovation | full renovation | structural/extension]. Example: 'Like-for-like bathroom suite swap in a small en-suite, existing layout retained.'",
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

  const { description, jobDescription, transcript, complexity, refinements } = req.body;
  if (!description) {
    return res.status(400).json({ error: "description (site inspection report) is required" });
  }

  // Build context block — all text, no images
  const contextParts = [];

  // Complexity tier — injected first as a hard constraint
  if (complexity) {
    contextParts.push(
      `JOB COMPLEXITY (confirmed by estimator): "${complexity}"\n` +
      `Calibrate all quantity estimates to this tier. For "like-for-like swap", ` +
      `use minimum competent hours. Do not inflate scope beyond what this tier requires.`
    );
  }

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

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("scope error:", err);
    return res.status(500).json({ error: err.message });
  }
};
