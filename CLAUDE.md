# CLAUDE.md — FBS Estimation Tool
# Project context for Claude Code — read this before editing any file.
# Updated: 2026-03-20

## Project overview
FBS Quote Scoper — AI-powered estimating tool for Fallow Building Services (London).
Company: Fallow Business Group Ltd t/a Fallow Building Services, Co. No. 16532814.

## Repo structure
```
estimatortool/
├── fbs-backend/
│   ├── server.js                    Express server, all routes registered here
│   ├── api/
│   │   ├── describe.js              Gemini 2.0 Flash — site photo → description
│   │   ├── scope.js                 Kimi K2.5 — description → quantity takeoff JSON
│   │   ├── transcribe.js            Groq Whisper Large v3 Turbo — audio → text
│   │   ├── summarise.js             Gemini 2.0 Flash — summary of scope
│   │   ├── slack.js                 Slack message sender
│   │   ├── slack-command.js         Slack /fbs slash-command handler
│   │   ├── history.js               Quote history persistence
│   │   ├── materials-identify.js    Gemini 2.5 Pro — scope → materials list
│   │   ├── materials-source.js      Perplexity Sonar Pro — materials → UK prices
│   │   ├── materials-voice.js       NEW: Groq + Gemini 2.0 Flash — voice → materials
│   │   └── materials-library.js     NEW: in-memory library CRUD
│   └── lib/
│       └── rates.js                 Shared rate card (44 trades, priceScope fn)
└── fbs-frontend/
    ├── src/
    │   ├── FBSQuoteScoper.jsx        Main React component (~145 KB)
    │   └── components/
    │       ├── MaterialsSourcing.jsx  Two-stage scope→materials modal
    │       └── MaterialsVoice.jsx     NEW: voice note → materials → prices modal
    └── package.json                  React 18 + Vite 5
```

## Environment variables (Vercel — no new vars needed)
| Variable           | Used by                                     |
|--------------------|---------------------------------------------|
| OPENROUTER_API_KEY | describe, scope, materials-identify/source/voice |
| GROQ_API_KEY       | transcribe, materials-voice                 |
| FBS_SECRET         | All endpoints (optional auth header)        |
| VITE_API_URL       | Frontend API base URL                       |
| VITE_FBS_SECRET    | Frontend secret header value                |

## AI models in use
| Endpoint             | Model                              | Purpose                        |
|----------------------|------------------------------------|--------------------------------|
| describe.js          | google/gemini-2.0-flash-001        | Photo → site description       |
| scope.js             | moonshot/kimi-k2-5                 | Description → quantity takeoff |
| transcribe.js        | whisper-large-v3-turbo (Groq)      | Audio → transcript             |
| materials-identify   | google/gemini-2.5-pro-preview-05-06| Scope → materials list (vision)|
| materials-source     | perplexity/sonar-pro-search        | Materials → live UK prices     |
| materials-voice      | whisper-large-v3-turbo + gemini-2.0-flash-001 | Voice → materials |

## Pricing model (CURRENT — as of 2026-03-20)
**Direct costs only. No prelims, overhead, or profit markup is added.**
Profit is factored into the labour rates themselves.

```
Sell price = Direct Labour + Direct Materials (with waste factors)
CIS deduction shown informatively (20% of labour) but does NOT affect total.
VAT is not included in any output — quoted ex VAT.
```

### Default financial percentages (stored in localStorage, shown in settings)
sitePrelims: hidden (0%)
overhead:    hidden (0%)
profit:      hidden (0%)
CIS:         20% of labour (informational only)

## Pricing paradigms
- A = hourly   (hrs)
- B = area     (m²)
- C = per item (item)
- D = linear   (m)
- E = fixed    (fixed)

## Trade categories for complexity multipliers
- mechanical: Plumbing, HVAC, Ductwork, Drainage, Underfloor Heating (wet), MVHR, Bathroom Suite
- electrical: First Fix Electrical, Second Fix Electrical, Fire Protection, Data/AV/Low Voltage,
              Underfloor Heating (electric), Electrical Testing
- structural: Demolition, Soft Strip, Brickwork, Steelwork, Groundworks, Roofing, Waterproofing,
              Temporary Works, Scaffolding
- core: everything else

## Complexity multipliers
| Tier                  | core | mechanical | electrical | structural |
|-----------------------|------|------------|------------|------------|
| like-for-like swap    | 1.0  | 1.0        | 1.0        | 1.0        |
| partial renovation    | 1.2  | 1.35       | 1.2        | 1.6        |
| full renovation       | 1.5  | 1.7        | 1.5        | 2.2        |
| new build/extension   | 1.8  | 2.2        | 1.8        | 3.0        |

## Key calibrated labour rates (v3)
| Trade                  | Unit | Labour (£) | Material (£) | Waste  |
|------------------------|------|-----------|--------------|--------|
| First Fix Electrical   | hrs  | 38        | 8            | 1.05   |
| Second Fix Electrical  | hrs  | 40        | 12           | 1.05   |
| Plumbing               | hrs  | 42        | 15           | 1.08   |
| Tiling (floor)         | m²   | 32        | 12           | 1.12   |
| Tiling (wall)          | m²   | 28        | 10           | 1.12   |
| Plastering/Skimming    | m²   | 12        | 4            | 1.10   |
| Screeding              | m²   | 12        | 6            | 1.05   |
| Painting & Decorating  | m²   | 6         | 3            | 1.10   |
| General Labour         | hrs  | 18        | 0            | 1.00   |
| Demolition/Strip Out   | hrs  | 18        | 0            | 1.00   |

Full rate card is in `fbs-backend/lib/rates.js`.

## Voice materials pipeline (NEW)
1. User records audio or pastes text in `MaterialsVoice.jsx`
2. POST `/api/materials-voice` → Groq transcription → Gemini 2.0 Flash parse
3. Returns `{ transcript, materials[] }`
4. User edits quantities/specs in the Materials tab
5. POST `/api/materials-source` → Perplexity Sonar Pro live UK prices
6. Results shown per item with supplier options, URLs, totals
7. Items saved to localStorage library (`fbs:materials-library`) via LibraryPane

## Materials library
- Key: `fbs:materials-library` in localStorage
- Schema: `{ id, trade, material_name, spec, unit, preferred_suppliers, search_query,
             last_unit_price, last_supplier, last_product_url, use_count, last_used, notes }`
- Sorted by use_count desc
- Backend echo route at `/api/materials-library` for future KV persistence

## Known iCloud issue
iCloud Drive on Windows renames files (e.g. "FBSQuoteScoper.jsx" → "FBSQuoteScoper 2.jsx"),
breaking Git and Vercel builds. Keep the repo on a non-iCloud path.

## Coding conventions
- CommonJS (`module.exports`, `require`) — NO ES modules in backend
- React 18 functional components with hooks — NO class components
- Tailwind CSS utility classes for all UI
- No TypeScript
- All monetary values in GBP, displayed ex VAT
- Auth: `x-fbs-secret` header on every backend request
