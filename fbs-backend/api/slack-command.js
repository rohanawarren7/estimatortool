// api/slack-command.js — Slack slash command handler
// Receives /fbs [mode] [description] from Slack
// Modes: quote | scope | materials
//
// Flow:
//   1. Verify Slack request signature (HMAC-SHA256)
//   2. Immediately acknowledge (< 3s) with "Processing…" message
//   3. Run AI pipeline async and POST result to response_url (valid 30 min)
//
// Slack app config required:
//   - Slash command /fbs → POST https://<railway-url>/api/slack/command
//   - OAuth scopes: chat:write, chat:write.public, commands
//   - SLACK_SIGNING_SECRET env var

const crypto = require("crypto");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// ── Rate card (mirrors DEFAULT_RATES in frontend) ─────────────────────────────
const DEFAULT_RATES = [
  { trade: "Plastering / Skimming",           unit: "m²",   labour: 12,  materials: 4,   wasteFactor: 1.10 },
  { trade: "Tiling (floor)",                  unit: "m²",   labour: 15,  materials: 12,  wasteFactor: 1.12 },
  { trade: "Tiling (wall)",                   unit: "m²",   labour: 18,  materials: 10,  wasteFactor: 1.12 },
  { trade: "Painting & Decorating",           unit: "m²",   labour: 8,   materials: 4,   wasteFactor: 1.10 },
  { trade: "Screeding",                       unit: "m²",   labour: 8,   materials: 5,   wasteFactor: 1.10 },
  { trade: "Boarding / Dry Lining",           unit: "m²",   labour: 10,  materials: 6,   wasteFactor: 1.10 },
  { trade: "Insulation (thermal/acoustic)",   unit: "m²",   labour: 6,   materials: 8,   wasteFactor: 1.10 },
  { trade: "Brickwork / Blockwork",           unit: "m²",   labour: 25,  materials: 8,   wasteFactor: 1.10 },
  { trade: "Roofing",                         unit: "m²",   labour: 20,  materials: 15,  wasteFactor: 1.12 },
  { trade: "Flooring (LVT / Engineered)",     unit: "m²",   labour: 10,  materials: 18,  wasteFactor: 1.10 },
  { trade: "Flooring (carpet)",               unit: "m²",   labour: 6,   materials: 12,  wasteFactor: 1.10 },
  { trade: "Suspended Ceilings",              unit: "m²",   labour: 12,  materials: 10,  wasteFactor: 1.08 },
  { trade: "External Rendering",              unit: "m²",   labour: 14,  materials: 8,   wasteFactor: 1.10 },
  { trade: "Waterproofing / Tanking",         unit: "m²",   labour: 12,  materials: 10,  wasteFactor: 1.10 },
  { trade: "Underfloor Heating (electric)",   unit: "m²",   labour: 8,   materials: 20,  wasteFactor: 1.05 },
  { trade: "Underfloor Heating (wet)",        unit: "m²",   labour: 10,  materials: 25,  wasteFactor: 1.05 },
  { trade: "External Cleaning / Jet Wash",    unit: "m²",   labour: 3,   materials: 1,   wasteFactor: 1.00 },
  { trade: "First Fix Electrical",            unit: "hrs",  labour: 25,  materials: 8,   wasteFactor: 1.05 },
  { trade: "Second Fix Electrical",           unit: "hrs",  labour: 31,  materials: 6,   wasteFactor: 1.05 },
  { trade: "Plumbing",                        unit: "hrs",  labour: 25,  materials: 12,  wasteFactor: 1.10 },
  { trade: "Carpentry / Joinery",             unit: "hrs",  labour: 25,  materials: 5,   wasteFactor: 1.08 },
  { trade: "Demolition / Strip Out",          unit: "hrs",  labour: 14,  materials: 0,   wasteFactor: 1.00 },
  { trade: "Soft Strip / Careful Demolition", unit: "hrs",  labour: 16,  materials: 0,   wasteFactor: 1.00 },
  { trade: "General Labour",                  unit: "hrs",  labour: 14,  materials: 0,   wasteFactor: 1.00 },
  { trade: "HVAC / Mechanical Ventilation",   unit: "hrs",  labour: 28,  materials: 10,  wasteFactor: 1.08 },
  { trade: "Ductwork Installation",           unit: "hrs",  labour: 25,  materials: 15,  wasteFactor: 1.08 },
  { trade: "Fire Protection / Sprinklers",    unit: "hrs",  labour: 28,  materials: 12,  wasteFactor: 1.08 },
  { trade: "Groundworks / Excavation",        unit: "hrs",  labour: 18,  materials: 2,   wasteFactor: 1.00 },
  { trade: "Drainage",                        unit: "hrs",  labour: 25,  materials: 8,   wasteFactor: 1.08 },
  { trade: "External Works / Landscaping",    unit: "hrs",  labour: 16,  materials: 3,   wasteFactor: 1.05 },
  { trade: "Steelwork / Structural",          unit: "hrs",  labour: 30,  materials: 5,   wasteFactor: 1.05 },
  { trade: "Data / AV / Low Voltage",         unit: "hrs",  labour: 25,  materials: 5,   wasteFactor: 1.05 },
  { trade: "Kitchen Units Installation",      unit: "hrs",  labour: 25,  materials: 4,   wasteFactor: 1.05 },
  { trade: "Fit-out Joinery",                 unit: "hrs",  labour: 28,  materials: 8,   wasteFactor: 1.08 },
  { trade: "Bathroom Suite Installation",     unit: "item", labour: 250, materials: 20,  wasteFactor: 1.05 },
  { trade: "Door Hanging / Ironmongery",      unit: "door", labour: 80,  materials: 15,  wasteFactor: 1.05 },
  { trade: "Window / Door Frame Install",     unit: "unit", labour: 150, materials: 10,  wasteFactor: 1.05 },
  { trade: "Skirting / Architrave",           unit: "m",    labour: 6,   materials: 4,   wasteFactor: 1.10 },
  { trade: "Coving / Cornicing",              unit: "m",    labour: 5,   materials: 3,   wasteFactor: 1.10 },
  { trade: "Drainage (linear)",               unit: "m",    labour: 20,  materials: 15,  wasteFactor: 1.08 },
  { trade: "Electrical Testing & Cert",       unit: "fixed",labour: 400, materials: 20,  wasteFactor: 1.00 },
  { trade: "Scaffolding",                     unit: "fixed",labour: 150, materials: 500, wasteFactor: 1.00 },
  { trade: "MVHR System (supply & install)",  unit: "fixed",labour: 800, materials: 400, wasteFactor: 1.05 },
  { trade: "Temporary Works / Shoring",       unit: "fixed",labour: 600, materials: 100, wasteFactor: 1.00 },
];

const TRADE_CATEGORY = {
  "Plumbing": "mechanical", "HVAC / Mechanical Ventilation": "mechanical",
  "Ductwork Installation": "mechanical", "Drainage": "mechanical",
  "Drainage (linear)": "mechanical", "Underfloor Heating (wet)": "mechanical",
  "MVHR System (supply & install)": "mechanical", "Bathroom Suite Installation": "mechanical",
  "First Fix Electrical": "electrical", "Second Fix Electrical": "electrical",
  "Fire Protection / Sprinklers": "electrical", "Data / AV / Low Voltage": "electrical",
  "Underfloor Heating (electric)": "electrical", "Electrical Testing & Cert": "electrical",
  "Demolition / Strip Out": "structural", "Soft Strip / Careful Demolition": "structural",
  "Brickwork / Blockwork": "structural", "Steelwork / Structural": "structural",
  "Groundworks / Excavation": "structural", "Roofing": "structural",
  "Waterproofing / Tanking": "structural", "Temporary Works / Shoring": "structural",
  "Scaffolding": "structural",
};

const COMPLEXITY_MULTIPLIERS = {
  "like-for-like swap":    { core: 1.0, mechanical: 1.0,  electrical: 1.0,  structural: 1.0  },
  "partial renovation":    { core: 1.2, mechanical: 1.35, electrical: 1.2,  structural: 1.6  },
  "full renovation":       { core: 1.5, mechanical: 1.7,  electrical: 1.5,  structural: 2.2  },
  "new build / extension": { core: 1.8, mechanical: 2.2,  electrical: 1.8,  structural: 3.0  },
};

function fmt(n) {
  return `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function priceScope(items, complexity) {
  const rateMap = Object.fromEntries(DEFAULT_RATES.map(r => [r.trade, r]));
  const mults   = COMPLEXITY_MULTIPLIERS[complexity] || COMPLEXITY_MULTIPLIERS["like-for-like swap"];

  const line_items = items.map(item => {
    const r           = rateMap[item.trade] || { labour: 0, materials: 0, wasteFactor: 1.0 };
    const category    = TRADE_CATEGORY[item.trade] || "core";
    const multiplier  = mults[category];
    const wasteFactor = r.wasteFactor || 1.0;
    const adj_qty     = Math.round(item.quantity * multiplier * 10) / 10;
    const labour_cost    = Math.round(adj_qty * r.labour);
    const materials_cost = Math.round(adj_qty * (r.materials || 0) * wasteFactor);
    return { ...item, adj_qty, labour_cost, materials_cost, cost: labour_cost + materials_cost };
  });

  const direct_labour    = line_items.reduce((s, l) => s + l.labour_cost, 0);
  const direct_materials = line_items.reduce((s, l) => s + l.materials_cost, 0);
  const direct_costs     = direct_labour + direct_materials;
  const prelims_amt      = Math.round(direct_costs * 0.08);
  const overhead_amt     = Math.round((direct_costs + prelims_amt) * 0.12);
  const total_cost       = direct_costs + prelims_amt + overhead_amt;
  const profit_amt       = Math.round(total_cost * 0.20);
  const sell_price       = total_cost + profit_amt;

  return { line_items, direct_labour, direct_materials, direct_costs, prelims_amt, overhead_amt, total_cost, profit_amt, sell_price };
}

// ── Verify Slack request signature ─────────────────────────────────────────────
function verifySlackSignature(req, rawBody) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return true; // skip if not configured
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSig  = req.headers["x-slack-signature"];
  if (!timestamp || !slackSig) return false;
  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const sigBase     = `v0:${timestamp}:${rawBody}`;
  const computedSig = "v0=" + crypto.createHmac("sha256", signingSecret).update(sigBase).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(slackSig));
}

// ── Call OpenRouter ────────────────────────────────────────────────────────────
async function callModel(model, messages, maxTokens, temperature) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://fallowbuildingservices.co.uk",
      "X-Title": "FBS Slack Bot"
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ── Parse scope JSON from model output ────────────────────────────────────────
function parseScopeJSON(raw) {
  const clean = raw.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end   = clean.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in scope response");
  return JSON.parse(clean.slice(start, end + 1));
}

// ── Format quote as Slack Block Kit ───────────────────────────────────────────
function buildSlackQuoteBlocks(scope, quote, description) {
  const lines = quote.line_items.map(l =>
    `${l.trade.padEnd(32)} ${String(l.adj_qty).padStart(6)} ${(l.unit || "").padEnd(6)}  ${fmt(l.cost)}`
  );
  const ps = quote.line_items.filter(l => l.confidence === "low");

  const blocks = [
    { type: "header", text: { type: "plain_text", text: "🏗 FBS Quote Estimate" } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${scope.scope_summary || "Quote"}*\n_Complexity: ${scope.complexity}_` }
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "```" + lines.join("\n") + "```" }
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Direct Costs*\n${fmt(quote.direct_costs)}` },
        { type: "mrkdwn", text: `*Site Prelims (8%)*\n${fmt(quote.prelims_amt)}` },
        { type: "mrkdwn", text: `*Overhead (12%)*\n${fmt(quote.overhead_amt)}` },
        { type: "mrkdwn", text: `*Profit (20%)*\n${fmt(quote.profit_amt)}` },
      ]
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*TOTAL (ex VAT): ${fmt(quote.sell_price)}*` }
    },
  ];

  if (ps.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `⚠ Includes ${ps.length} provisional sum(s) — subject to site verification` }]
    });
  }
  if (scope.assumptions?.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📋 Assumptions: ${scope.assumptions.slice(0, 3).join(" · ")}` }]
    });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `_Generated by FBS Quote Scoper · Text-based estimate (no site photos) · <https://scope.fallowbuildingservices.co.uk|Open in app>_` }]
  });

  return blocks;
}

// ── Build scope-only Slack blocks ─────────────────────────────────────────────
function buildSlackScopeBlocks(summary) {
  return [
    { type: "header", text: { type: "plain_text", text: "📋 FBS Scope of Works" } },
    { type: "section", text: { type: "mrkdwn", text: "```" + summary + "```" } },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `_Generated by FBS Quote Scoper · <https://scope.fallowbuildingservices.co.uk|Open in app for full quote>_` }]
    }
  ];
}

// ── Post to response_url (async reply back to Slack) ─────────────────────────
async function postToResponseUrl(responseUrl, payload) {
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ── Pipeline runners ───────────────────────────────────────────────────────────
async function runQuotePipeline(description, responseUrl) {
  try {
    // Stage 1: Scope (text-only — no images)
    const SCOPE_PROMPT_TEXT = require("./scope").SCOPE_PROMPT_TEXT;
    const scopeRaw = await callModel(
      "moonshotai/kimi-k2.5",
      [{ role: "user", content: `JOB BRIEF FROM CLIENT:\n"${description}"\n\n${SCOPE_PROMPT_TEXT}` }],
      4000, 0.1
    );
    const scope = parseScopeJSON(scopeRaw);

    // Normalise
    if (!["like-for-like swap","partial renovation","full renovation","new build / extension"].includes(scope.complexity)) {
      scope.complexity = "like-for-like swap";
    }
    if (scope.items) {
      scope.items = scope.items.map(item => ({
        ...item,
        confidence: item.confidence || "high",
      }));
    }

    // Stage 2: Price (deterministic)
    const quote = priceScope(scope.items || [], scope.complexity);

    // Post result
    await postToResponseUrl(responseUrl, {
      response_type: "in_channel",
      blocks: buildSlackQuoteBlocks(scope, quote, description),
    });
  } catch (err) {
    console.error("Slack quote pipeline error:", err);
    await postToResponseUrl(responseUrl, {
      response_type: "in_channel",
      text: `❌ Quote failed: ${err.message}`,
    });
  }
}

async function runScopePipeline(description, responseUrl) {
  try {
    const summarisePrompt = `You are a professional site manager for Fallow Building Services (FBS).

Produce a clear, professional scope of works from the job description below.

RULES:
1. Extract only what is mentioned or clearly implied — do not invent works.
2. Group by trade or room/area.
3. Concise bullet points under each heading.
4. Include a Notes section for anything uncertain.
5. Plain professional English. No pricing, no quantities.
6. End with "Scope summary: [one sentence]".

JOB BRIEF:
"${description}"

Output format (plain text):
SCOPE OF WORKS
──────────────────────────────
[Area or Trade]
- [work item]

NOTES
- [anything uncertain]

Scope summary: [one sentence]`;

    const summary = await callModel("moonshotai/kimi-k2.5", [{ role: "user", content: summarisePrompt }], 1500, 0.2);

    await postToResponseUrl(responseUrl, {
      response_type: "in_channel",
      blocks: buildSlackScopeBlocks(summary.trim()),
    });
  } catch (err) {
    console.error("Slack scope pipeline error:", err);
    await postToResponseUrl(responseUrl, {
      response_type: "in_channel",
      text: `❌ Scope failed: ${err.message}`,
    });
  }
}

// ── Help text ─────────────────────────────────────────────────────────────────
const HELP_TEXT = `*FBS Quote Scoper — Slash Commands*

\`/fbs quote [description]\` — Generate a priced quote estimate
\`/fbs scope [description]\` — Generate a prose scope of works only
\`/fbs help\` — Show this help message

*Examples:*
\`/fbs quote bathroom refurb, 3m x 2m, replace sanitaryware, retile walls and floor\`
\`/fbs scope attic conversion with dormer window, 25m² new floor area\`

_Note: Text-based estimates only — upload site photos in the <https://scope.fallowbuildingservices.co.uk|web app> for AI visual analysis._`;

// ── Main handler ───────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Slack sends application/x-www-form-urlencoded — body already parsed by express.urlencoded()
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Signature verification uses the raw body string
  const rawBody = new URLSearchParams(req.body).toString();
  if (!verifySlackSignature(req, rawBody)) {
    console.warn("Slack signature verification failed");
    return res.status(401).json({ error: "Invalid Slack signature" });
  }

  const { command, text = "", response_url, user_name } = req.body;

  console.log(`Slack command from ${user_name}: ${command} ${text}`);

  // Parse mode from text: first word is the mode
  const parts = text.trim().split(/\s+/);
  const mode  = parts[0]?.toLowerCase();
  const description = parts.slice(1).join(" ").trim();

  // Help
  if (!text.trim() || mode === "help") {
    return res.json({ response_type: "ephemeral", text: HELP_TEXT });
  }

  if (!["quote", "scope"].includes(mode)) {
    return res.json({
      response_type: "ephemeral",
      text: `Unknown mode \`${mode}\`. Use \`/fbs quote\`, \`/fbs scope\`, or \`/fbs help\`.`,
    });
  }

  if (!description) {
    return res.json({
      response_type: "ephemeral",
      text: `Please provide a job description. Example:\n\`/fbs ${mode} bathroom refurb, 3m x 2m, replace sanitaryware\``,
    });
  }

  // Acknowledge immediately (Slack requires response within 3s)
  const modeLabel = mode === "quote" ? "priced quote" : "scope of works";
  res.json({
    response_type: "in_channel",
    text: `⏳ *${user_name}* requested a ${modeLabel} for: _${description}_\nProcessing… this takes 15–30 seconds.`,
  });

  // Run pipeline async (response_url valid for 30 min)
  if (mode === "quote") {
    runQuotePipeline(description, response_url).catch(console.error);
  } else {
    runScopePipeline(description, response_url).catch(console.error);
  }
};
