// api/slack.js — Post a message to a Slack channel via chat.postMessage
// Requires SLACK_BOT_TOKEN env var (Bot User OAuth Token, starts with xoxb-).
// The bot must be invited to any channel it posts to.

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

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: "SLACK_BOT_TOKEN is not configured on the server" });

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
    console.error("slack error:", err);
    return res.status(500).json({ error: err.message });
  }
};
