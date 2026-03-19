# FBS Estimation Tool — Claude Context

## What this is
AI-powered quoting tool for Fallow Building Services (Fallow Business Group Ltd t/a Fallow Building Services, Company No: 16532814). An estimator uploads site photos or video, adds a job brief, and the tool produces a priced scope of works to copy-paste into a client quote.

## Stack
- **Frontend:** React + Vite, single component `fbs-frontend/src/FBSQuoteScoper.jsx`, deployed on Vercel
- **Backend:** Node.js serverless API routes in `fbs-backend/api/`, deployed on Vercel
- **AI:** Gemini 2.0 Flash (vision/describe via `describe.js`), Kimi K2.5 via OpenRouter (scope via `scope.js`)
- **Repo:** github.com/rohanawarren7/estimatortool, branch: main

## Pipeline
1. `describe.js` — Gemini analyses uploaded photos/frames, returns a scene description
2. `scope.js` — Kimi reads description + images, returns structured JSON line items (temperature: 0.1)
3. Pricing — **fully deterministic, client-side arithmetic** (no LLM call for pricing)

## Architecture decisions (confirmed 2026-03-19)

### Pricing engine: deterministic, frontend only
- No `/api/price` LLM call. After scope returns, the frontend prices everything with arithmetic.
- Rate card has two columns per trade: `labour` (£/unit) and `materials` (£/unit)
- `cost = quantity × (labour_rate + materials_rate)`
- Complexity tier multipliers are applied per trade category (not a blanket total multiplier)

### Financial model: three levels
```
Direct Costs (labour + materials)
+ Site Prelims %       (default 8%)  — skip hire, PPE, site management
+ Company Overhead %   (default 12%) — insurance, vehicles, tools, office
= Total Cost
+ Net Profit %         (default 20%)
= Sell Price (ex VAT)
```
CIS deduction (default 20% of labour) is an informational line — it does not change the client total.

### Scope completeness
Scope items carry `confidence: "high" | "low"`. Low-confidence items appear as Provisional Sums (PS) in the quote — included in total, flagged visually.

### Deletions require double confirmation
Both line item deletion and history entry deletion are two-step: click × → confirm DELETE / Cancel.

## Labour rate context (for sanity-checking defaults)
- General labourers: £100–£120/day (~£12–15/hr)
- Infrastructure trades: £180–£200/day (~£22–25/hr)
- Electricians: £250/day (~£31/hr)
A basic bathroom swap should not quote above ~£2,500–3,500 ex VAT for a like-for-like.

## Known issue: iCloud Drive (if working from iCloudDrive path)
iCloud Drive on Windows renames files during sync (e.g. `FBSQuoteScoper.jsx` → `FBSQuoteScoper 2.jsx`). This breaks git staging and causes Vercel build failures. **Work from a non-iCloud path** (e.g. clone to `C:/Users/tamar/dev/estimatortool`).

## Company details (for footer/quotes)
Fallow Business Group Ltd trading as Fallow Building Services
Company No: 16532814
https://fallowbuildingservices.co.uk/terms-conditions
https://fallowbuildingservices.co.uk/privacy-policy
