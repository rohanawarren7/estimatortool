// api/slack.js
// GET  — list workspace channels (requires channels:read + groups:read scopes)
// POST — post a message via chat.postMessage (requires chat:write scope)

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");

  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = process.env.FBS_SECRET;
  if (secret && req.headers["x-fbs-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorised" });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: "SLACK_BOT_TOKEN is not configured on the server" });

  // ── GET: list channels ────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // Fetch public + private channels the bot can see (up to 200)
      const url = "https://slack.com/api/conversations.list" +
        "?types=public_channel,private_channel&exclude_archived=true&limit=200";
      const response = await fetch(url, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.ok) {
        return res.status(502).json({ error: data.error || "Slack API error" });
      }
      const channels = (data.channels || [])
        .map(c => ({ id: c.id, name: c.name, isPrivate: c.is_private }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.status(200).json({ channels });
    } catch (err) {
      console.error("slack channels error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: send message ────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { channel, text } = req.body;
    if (!channel) return res.status(400).json({ error: "channel is required" });
    if (!text)    return res.status(400).json({ error: "text is required" });

    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ channel, text }),
      });
      const data = await response.json();
      if (!data.ok) {
        return res.status(502).json({ error: data.error || "Slack API error" });
      }
      return res.status(200).json({ ok: true, ts: data.ts, channel: data.channel });
    } catch (err) {
      console.error("slack post error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
