// api/describe.js — Vision stage: all frames → rich text description via Gemini 2.5 Flash
// Gemini 2.5 Flash has a 1M token context and superior visual reasoning.
// Output feeds into scope.js (Kimi K2.5) as text, keeping Kimi's context free for analysis.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const DESCRIBE_PROMPT = `You are a construction site inspector analysing photos and video frames for a UK building contractor called Fallow Building Services (FBS).

Examine ALL uploaded images carefully. They may be photos or extracted frames from a site walkthrough video. Produce a detailed written site description that a quantity surveyor will use to estimate labour scope.

For each distinct room or area visible across the images, describe:
1. Room/area type and estimated dimensions (width × length × ceiling height where you can judge)
2. Surfaces — floors, walls, ceilings: material, condition, and approximate area
3. Fixtures and fittings present (sanitaryware, kitchen units, radiators, sockets/switches, lighting)
4. Visible damage, damp, cracking, staining, or defects — location and approximate extent
5. Services indicators: electrical conduit/cables/consumer unit, pipework, ductwork, heating
6. What remediation or installation work is clearly required or implied

If frames appear sequential (similar angles, slight movement), treat them as a continuous walkthrough rather than separate rooms.

If any images are pages from architectural or construction drawings (floor plans, elevations, sections, M&E drawings, or schedules of works), extract:
- Room names, dimensions (width × length × height), and floor areas from the drawings
- All annotations, dimension strings, and labels visible in the drawing
- Materials, finishes, or specifications noted in legends or schedules
- Trade-specific layouts: electrical point locations, plumbing/drainage routes, structural elements, HVAC routes, fire protection zones
- Any schedule of works, finishes schedule, or specification notes visible
Reconcile drawing information with site photos where both are present.

Write as a professional site inspection report in clear prose, grouped by area. Be specific about materials, approximate dimensions, and areas. Flag anything with limited visibility or requiring site verification.`;

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

  const { images, jobDescription, stream: streamMode } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "images array is required" });
  }

  const contextPrefix = jobDescription
    ? `Job Brief from client: "${jobDescription}"\n\nNow analyse the uploaded site images:\n\n`
    : "";

  const imgContent = images.map(img => ({
    type: "image_url",
    image_url: { url: `data:${img.type};base64,${img.b64}` }
  }));

  const requestBody = {
    model: MODEL,
    max_tokens: 12000,
    temperature: 0.3,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: contextPrefix + DESCRIBE_PROMPT },
        ...imgContent
      ]
    }]
  };

  // ── Streaming path ─────────────────────────────────────────────────────────
  if (streamMode) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://fallowbuildingservices.co.uk",
          "X-Title": "FBS Quote Scoper"
        },
        body: JSON.stringify({ ...requestBody, stream: true }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        res.write(`data: ${JSON.stringify({ type: "error", error: err?.error?.message || `Gemini API error ${response.status}` })}\n\n`);
        return res.end();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let finishReason = null;
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // hold incomplete line
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          let parsed;
          try { parsed = JSON.parse(payload); } catch { continue; }
          const token = parsed.choices?.[0]?.delta?.content || "";
          finishReason = parsed.choices?.[0]?.finish_reason || finishReason;
          if (!token) continue;
          accumulated += token;
          res.write(`data: ${JSON.stringify({ type: "token", content: token })}\n\n`);
        }
      }

      if (!accumulated.trim()) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Empty response from Gemini" })}\n\n`);
        return res.end();
      }

      console.log("Gemini stream complete:", accumulated.length, "chars, finish_reason:", finishReason);
      res.write(`data: ${JSON.stringify({
        type: "done",
        result: { description: accumulated.trim(), truncated: finishReason === "max_tokens" }
      })}\n\n`);
      res.end();

    } catch (err) {
      console.error("describe stream error:", err);
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  // ── Non-streaming path (unchanged) ────────────────────────────────────────
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://fallowbuildingservices.co.uk",
        "X-Title": "FBS Quote Scoper"
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `Gemini API error ${response.status}` });
    }

    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim() || "";
    const finishReason = data.choices?.[0]?.finish_reason;
    console.log("Gemini description length:", description.length, "chars");
    console.log("Finish reason:", finishReason);
    if (!description) throw new Error(`Empty description from Gemini. finish_reason=${finishReason}`);

    return res.status(200).json({
      description,
      truncated: finishReason === "max_tokens",
    });

  } catch (err) {
    console.error("describe error:", err);
    return res.status(500).json({ error: err.message });
  }
};
