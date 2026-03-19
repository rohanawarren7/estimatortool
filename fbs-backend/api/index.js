// api/index.js - Health check endpoint for root URL
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  
  return res.status(200).json({
    status: "OK",
    message: "FBS Quote Scoper API",
    endpoints: {
      "POST /api/scope": "Photo analysis - quantity takeoff",
      "POST /api/price": "Pricing calculation"
    }
  });
}