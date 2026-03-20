const express = require("express");
const app = express();

// Global CORS — handles preflight for all routes
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(express.json({ limit: "20mb" }));

app.all("/api/describe",   require("./api/describe"));
app.all("/api/scope",      require("./api/scope"));
app.all("/api/transcribe", require("./api/transcribe"));
app.all("/api/summarise",  require("./api/summarise"));
app.all("/api/history",    require("./api/history"));
app.all("/api",            require("./api/index"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FBS API running on port ${PORT}`));
