const express = require("express");
const app = express();

// Global CORS — handles preflight for all routes
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-fbs-secret");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(express.json({ limit: "20mb" }));

app.all("/api/describe",           require("./api/describe"));
app.all("/api/scope",              require("./api/scope"));
app.all("/api/transcribe",         require("./api/transcribe"));
app.all("/api/summarise",          require("./api/summarise"));
app.all("/api/slack",              require("./api/slack"));
app.all("/api/history",            require("./api/history"));
app.all("/api/materials-identify", require("./api/materials-identify"));
app.all("/api/materials-source",   require("./api/materials-source"));
app.all("/api/materials-voice",    require("./api/materials-voice"));
app.all("/api/materials-library",  require("./api/materials-library"));
app.all("/api/materials-validate", require("./api/materials-validate"));
app.all("/api/project-store",      require("./api/project-store"));
app.all("/api/project-store/list", require("./api/project-store"));

// Slack slash commands use form-encoded bodies (must come before global json middleware applies)
app.use("/api/slack/command", express.urlencoded({ extended: false }));
app.post("/api/slack/command", require("./api/slack-command"));

app.all("/api",                    require("./api/index"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FBS API running on port ${PORT}`));
