// api/materials-voice.js — Voice-note to Materials List
// POST /api/materials-voice
// Body option A: { audio: "<base64 WAV>" }          — transcribe then parse
// Body option B: { transcript: "<plain text>" }      — skip transcription
// Returns: { transcript, materials: [...] }
// The returned materials[] array is compatible with /api/materials-source.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// --------------------------------------------------------------------------
// Transcription — Groq Whisper Large v3 Turbo (same as existing transcribe.js)
// --------------------------------------------------------------------------
async function transcribeAudio(audioBase64) {
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const boundary = "----WhisperBoundary" + Math.random().toString(36).slice(2);
  const CRLF = "\r\n";

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"${CRLF}` +
      `Content-Type: audio/wav${CRLF}${CRLF}`
    ),
    audioBuffer,
    Buffer.from(
      `${CRLF}--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
      `whisper-large-v3-turbo${CRLF}` +
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}` +
      `text${CRLF}` +
      `--${boundary}--${CRLF}`
    ),
  ]);

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${response.status}`);
  }

  return (await response.text()).trim();
}

// --------------------------------------------------------------------------
// Parse transcript → structured materials list  (Gemini 2.0 Flash)
// --------------------------------------------------------------------------
const PARSE_PROMPT = `You are a professional quantity surveyor for a London building contractor.

A site operative has recorded a voice note listing materials needed. The transcript is below.

Your job:
1. Extract every distinct material mentioned.
2. Infer the most likely quantity and unit from context clues (e.g. "a couple of boxes of tiles" = 2 box, "twenty metres of cable" = 20 m, "some screws" = 1 box).
3. If a quantity is genuinely unclear, set quantity_gross to null and flag low confidence.
4. Generate a clear search_query suitable for finding the item on a UK supplier site.
5. Assign the most relevant UK preferred_suppliers (Screwfix, Toolstation, Jewson, Selco, Travis Perkins, B&Q, Wickes, Topps Tiles, Tile Giant, City Plumbing, Wolseley, CEF, RS Components).
6. Map each material to the nearest trade from this list: Plastering/Skimming, Tiling (floor), Tiling (wall), First Fix Electrical, Second Fix Electrical, Plumbing, Carpentry, Painting & Decorating, Flooring (carpet), Flooring (LVT), Flooring (hardwood), Screeding, Insulation, Roofing, Rendering, Drainage, Brickwork, Groundworks, General Labour, Fire Protection, HVAC, Steelwork, or "General" if none fit.

RESPOND ONLY with a valid JSON object in this exact format — no markdown, no preamble, no trailing text:

{
  "materials": [
    {
      "id": "mat_001",
      "trade": "Tiling (floor)",
      "material_name": "Porcelain floor tile 600x600mm grey matt",
      "spec": "600x600mm, R10 slip rating, matt finish",
      "quantity_gross": 14.4,
      "unit": "m²",
      "search_query": "porcelain floor tile 600x600 grey matt UK",
      "preferred_suppliers": ["Topps Tiles", "Tile Giant", "B&Q"],
      "confidence": "high",
      "notes": "Quantity inferred from 'about 12 square metres plus wastage'"
    }
  ],
  "parse_notes": "Optional overall notes about the transcript"
}

TRANSCRIPT:
`;

async function parseTranscript(transcript) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://fallowbuildingservices.co.uk",
      "X-Title": "FBS Voice Materials Parser",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 8000,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: PARSE_PROMPT + transcript }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter error ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";

  // Strip any markdown fences
  const clean = raw.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model returned no valid JSON. Raw: " + raw.slice(0, 200));
  }

  const parsed = JSON.parse(clean.slice(start, end + 1));

  // Normalise IDs so they are always present and unique
  const materials = (parsed.materials || []).map((m, i) => ({
    id: m.id || `mat_${String(i + 1).padStart(3, "0")}`,
    trade: m.trade || "General",
    material_name: m.material_name || "Unknown material",
    spec: m.spec || "",
    quantity_gross: m.quantity_gross != null ? Number(m.quantity_gross) : null,
    unit: m.unit || "item",
    search_query: m.search_query || m.material_name,
    preferred_suppliers: Array.isArray(m.preferred_suppliers) ? m.preferred_suppliers : ["Screwfix", "Toolstation"],
    confidence: m.confidence || "medium",
    notes: m.notes || "",
  }));

  return { materials, parse_notes: parsed.parse_notes || "" };
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

  const { audio, transcript: incomingTranscript } = req.body;

  if (!audio && !incomingTranscript) {
    return res.status(400).json({ error: "Provide either audio (base64 WAV) or transcript (string)" });
  }

  try {
    // Step 1 — transcription (skip if transcript already provided)
    let transcript = incomingTranscript || "";
    if (audio && !transcript) {
      transcript = await transcribeAudio(audio);
    }

    if (!transcript || transcript.trim().length < 5) {
      return res.status(400).json({ error: "Transcript is empty or too short to parse" });
    }

    // Step 2 — parse transcript into materials
    const { materials, parse_notes } = await parseTranscript(transcript);

    return res.status(200).json({
      transcript,
      materials,
      parse_notes,
      material_count: materials.length,
    });

  } catch (err) {
    console.error("materials-voice error:", err);
    return res.status(500).json({ error: err.message });
  }
};
