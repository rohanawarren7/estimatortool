// api/summarise.js — Generate a prose scope of works from a WAV transcript (+ optional job brief)
// Returns a formatted plain-text document suitable for sharing directly with clients or colleagues.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "moonshotai/kimi-k2.5";

const SUMMARISE_PROMPT = `You are a professional site manager for a London-based building contractor called Fallow Building Services (FBS).

You have been given an audio transcript recorded on site and an optional job brief. Your task is to produce a clear, professional scope of works document from the content of the transcript.

RULES:
1. Extract only what is mentioned or clearly implied in the transcript — do not invent works.
2. Group works by trade or room/area, whichever is clearer given the content.
3. Use concise bullet points under each heading.
4. After the scope, include a short "Notes" section covering anything uncertain or that needs further clarification on site.
5. Write in plain professional English. No pricing, no quantities, no jargon.
6. End with a one-line "Scope summary:" sentence (e.g. "Full bathroom refurb with new suite, tiling and electrics.").

Output format (plain text, no markdown symbols):

SCOPE OF WORKS
──────────────────────────────────────
[Area or Trade]
- [work item]
- [work item]

[Area or Trade]
- [work item]

NOTES
- [anything uncertain or requiring verification]

Scope summary: [one sentence]`;

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

  const { transcript, jobDescription } = req.body;
  if (!transcript) return res.status(400).json({ error: "transcript is required" });

  const contextParts = [];
  if (jobDescription?.trim()) contextParts.push(`JOB BRIEF:\n"${jobDescription.trim()}"`);
  contextParts.push(`SITE RECORDING TRANSCRIPT:\n"${transcript}"`);

  const promptText = `${contextParts.join("\n\n")}\n\n${SUMMARISE_PROMPT}`;

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
        max_tokens: 2000,
        temperature: 0.2,
        messages: [{ role: "user", content: promptText }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `API error ${response.status}` });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";
    if (!summary) throw new Error("Empty response from model");

    return res.status(200).json({ summary });

  } catch (err) {
    console.error("summarise error:", err);
    return res.status(500).json({ error: err.message });
  }
};
