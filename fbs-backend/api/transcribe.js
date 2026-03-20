// api/transcribe.js — Audio transcription via Groq Whisper
// Accepts base64-encoded WAV audio, returns transcript text.

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

  const { audio } = req.body; // base64-encoded WAV
  if (!audio) return res.status(400).json({ error: "audio (base64 WAV) is required" });

  try {
    const audioBuffer = Buffer.from(audio, "base64");

    // Build multipart/form-data manually using Buffer — avoids the experimental
    // buffer.File warning triggered by new Blob() + FormData in Node 20.
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

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err?.error?.message || `Groq API error ${response.status}` });
    }

    const transcript = await response.text();
    return res.status(200).json({ transcript: transcript.trim() });

  } catch (err) {
    console.error("transcribe error:", err);
    return res.status(500).json({ error: err.message });
  }
};
