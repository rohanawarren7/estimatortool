import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIGURATION — update VERCEL_BASE_URL after deployment
//  FBS_SECRET must match the FBS_SECRET env var you set in Vercel
// ─────────────────────────────────────────────────────────────────────────────
const VERCEL_BASE_URL = import.meta.env.VITE_API_URL;
const FBS_SECRET      = import.meta.env.VITE_FBS_SECRET;

// localStorage key namespace
const LS = {
  rates:        "fbs:rates",
  sitePrelims:  "fbs:sitePrelims",
  overhead:     "fbs:overhead",
  profit:       "fbs:profit",
  cisDeduction: "fbs:cisDeduction",
  history:      "fbs:history",
};

// ─────────────────────────────────────────────────────────────────────────────
//  RATE CARD — cost rates: what FBS pays per unit
//  labour  = direct labour cost (based on FBS day rates ÷ 8 hrs)
//  materials = trade installation materials (adhesive, fittings, cable, etc.)
//  Finish materials (tiles, sanitaryware, boards) are PC sums — not in rate card.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_RATES = [
  { trade: "Plastering / Skimming",          unit: "m²",  labour: 12, materials: 4  },
  { trade: "Tiling (floor)",                 unit: "m²",  labour: 15, materials: 12 },
  { trade: "Tiling (wall)",                  unit: "m²",  labour: 18, materials: 10 },
  { trade: "Painting & Decorating",          unit: "m²",  labour: 8,  materials: 4  },
  { trade: "First Fix Electrical",           unit: "hrs", labour: 25, materials: 8  },
  { trade: "Second Fix Electrical",          unit: "hrs", labour: 31, materials: 6  },
  { trade: "Plumbing",                       unit: "hrs", labour: 25, materials: 12 },
  { trade: "Carpentry / Joinery",            unit: "hrs", labour: 25, materials: 5  },
  { trade: "Screeding",                      unit: "m²",  labour: 8,  materials: 5  },
  { trade: "Boarding / Dry Lining",          unit: "m²",  labour: 10, materials: 6  },
  { trade: "Demolition / Strip Out",         unit: "hrs", labour: 14, materials: 0  },
  { trade: "General Labour",                 unit: "hrs", labour: 14, materials: 0  },
  { trade: "HVAC / Mechanical Ventilation",  unit: "hrs", labour: 28, materials: 10 },
  { trade: "Ductwork Installation",          unit: "hrs", labour: 25, materials: 15 },
  { trade: "Fire Protection / Sprinklers",   unit: "hrs", labour: 28, materials: 12 },
  { trade: "Insulation (thermal/acoustic)",  unit: "m²",  labour: 6,  materials: 8  },
  { trade: "Groundworks / Excavation",       unit: "hrs", labour: 18, materials: 2  },
  { trade: "Drainage",                       unit: "hrs", labour: 25, materials: 8  },
  { trade: "External Works / Landscaping",   unit: "hrs", labour: 16, materials: 3  },
  { trade: "Brickwork / Blockwork",          unit: "m²",  labour: 25, materials: 8  },
  { trade: "Roofing",                        unit: "m²",  labour: 20, materials: 15 },
  { trade: "Flooring (LVT / Engineered)",    unit: "m²",  labour: 10, materials: 18 },
  { trade: "Steelwork / Structural",         unit: "hrs", labour: 30, materials: 5  },
  { trade: "Suspended Ceilings",             unit: "m²",  labour: 12, materials: 10 },
];

// ─────────────────────────────────────────────────────────────────────────────
//  PRICING ENGINE — deterministic, no API call
// ─────────────────────────────────────────────────────────────────────────────
const TRADE_CATEGORY = {
  "Plumbing":                      "mechanical",
  "HVAC / Mechanical Ventilation": "mechanical",
  "Drainage":                      "mechanical",
  "First Fix Electrical":          "electrical",
  "Second Fix Electrical":         "electrical",
  "Fire Protection / Sprinklers":  "electrical",
  "Demolition / Strip Out":        "structural",
  "Brickwork / Blockwork":         "structural",
  "Steelwork / Structural":        "structural",
  "Groundworks / Excavation":      "structural",
  "Roofing":                       "structural",
};

const COMPLEXITY_MULTIPLIERS = {
  "like-for-like swap":    { core: 1.0, mechanical: 1.0,  electrical: 1.0,  structural: 1.0  },
  "partial renovation":    { core: 1.2, mechanical: 1.35, electrical: 1.2,  structural: 1.6  },
  "full renovation":       { core: 1.5, mechanical: 1.7,  electrical: 1.5,  structural: 2.2  },
  "new build / extension": { core: 1.8, mechanical: 2.2,  electrical: 1.8,  structural: 3.0  },
};

function priceScope(items, rates, complexity, sitePrelimsPct, overheadPct, profitPct, cisPct) {
  const rateMap   = Object.fromEntries(rates.map(r => [r.trade, r]));
  const mults     = COMPLEXITY_MULTIPLIERS[complexity] || COMPLEXITY_MULTIPLIERS["like-for-like swap"];

  const line_items = items.map(item => {
    const r          = rateMap[item.trade] || { labour: 0, materials: 0 };
    const category   = TRADE_CATEGORY[item.trade] || "core";
    const multiplier = mults[category];
    const adj_qty    = Math.round(item.quantity * multiplier * 10) / 10;
    const labour_cost    = Math.round(adj_qty * r.labour);
    const materials_cost = Math.round(adj_qty * (r.materials || 0));
    return {
      ...item,
      quantity:      adj_qty,
      labour_rate:   r.labour,
      materials_rate: r.materials || 0,
      labour_cost,
      materials_cost,
      cost: labour_cost + materials_cost,
    };
  });

  const labour_subtotal    = line_items.reduce((s, l) => s + l.labour_cost, 0);
  const materials_subtotal = line_items.reduce((s, l) => s + l.materials_cost, 0);
  const subtotal           = labour_subtotal + materials_subtotal;
  const ps_subtotal        = line_items
    .filter(l => l.confidence === "low")
    .reduce((s, l) => s + l.cost, 0);

  const site_prelims_cost = Math.round(subtotal * sitePrelimsPct / 100);
  const overhead_base     = subtotal + site_prelims_cost;
  const overhead_cost     = Math.round(overhead_base * overheadPct / 100);
  const profit_base       = overhead_base + overhead_cost;
  const profit_cost       = Math.round(profit_base * profitPct / 100);
  const cis_cost          = Math.round(labour_subtotal * cisPct / 100);
  const total             = subtotal + site_prelims_cost + overhead_cost + profit_cost;

  return {
    line_items,
    labour_subtotal, materials_subtotal, subtotal, ps_subtotal,
    site_prelims_pct: sitePrelimsPct, site_prelims_cost,
    overhead_pct: overheadPct, overhead_cost,
    profit_pct: profitPct, profit_cost,
    cis_pct: cisPct, cis_cost,
    total,
    complexity,
    vat_note: "Standard rated 20% VAT applicable unless zero-rated (e.g. disabled adaptation)",
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function migrateRates(stored) {
  if (!stored) return DEFAULT_RATES;
  // Old format had a single `rate` field — map it to labour, set materials: 0
  if (stored[0]?.rate !== undefined && stored[0]?.labour === undefined) {
    return stored.map(r => ({ trade: r.trade, unit: r.unit, labour: r.rate, materials: 0 }));
  }
  return stored;
}

function resizeImage(file, maxDim = 768) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.85);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function adaptiveFrameCount(durationSecs) {
  if (durationSecs <= 10)  return Math.min(10, Math.ceil(durationSecs));
  if (durationSecs <= 60)  return 16;
  if (durationSecs <= 180) return 30;
  if (durationSecs <= 600) return 50;
  return 60;
}

function captureFrame(video, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth || 1, video.videoHeight || 1));
  const w = Math.round((video.videoWidth || 640) * scale);
  const h = Math.round((video.videoHeight || 360) * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(video, 0, 0, w, h);
  return new Promise(resolve => {
    canvas.toBlob(blob => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(",")[1];
        const url = URL.createObjectURL(blob);
        resolve({ b64, url });
      };
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.85);
  });
}

function extractVideoFrames(file, maxDim = 512) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const count = adaptiveFrameCount(duration);
      const start = Math.min(2, duration * 0.05);
      const end   = Math.max(start + 0.1, duration - Math.min(2, duration * 0.05));
      const timestamps = Array.from({ length: count }, (_, i) =>
        count === 1 ? start : start + (i / (count - 1)) * (end - start)
      );

      const frames = [];
      const useRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

      for (let i = 0; i < timestamps.length; i++) {
        if (useRVFC) {
          await new Promise(res => {
            video.requestVideoFrameCallback(async () => {
              const { b64, url } = await captureFrame(video, maxDim);
              frames.push({
                name: `${file.name} · frame ${i + 1}/${count}`,
                b64, url, type: "image/jpeg", source: "video", videoName: file.name,
              });
              res();
            });
            video.currentTime = timestamps[i];
          });
        } else {
          await new Promise(res => { video.onseeked = res; video.currentTime = timestamps[i]; });
          const { b64, url } = await captureFrame(video, maxDim);
          frames.push({
            name: `${file.name} · frame ${i + 1}/${count}`,
            b64, url, type: "image/jpeg", source: "video", videoName: file.name,
          });
        }
      }

      URL.revokeObjectURL(objectUrl);
      resolve(frames);
    };

    video.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not load video")); };
  });
}

async function extractPdfPages(file, maxPages = 10, maxDim = 2000, quality = 0.85) {
  const pdfjsLib = await import("pdfjs-dist");
  // CDN worker — avoids Vite worker config complexity
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdf.numPages;
  const pagesToProcess = Math.min(pageCount, maxPages);

  const frames = [];
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    const page     = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });

    const canvas   = document.createElement("canvas");
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    // Downscale to maxDim if larger — preserves annotation legibility
    const scale    = Math.min(maxDim / canvas.width, maxDim / canvas.height, 1);
    const out      = document.createElement("canvas");
    out.width      = Math.round(canvas.width  * scale);
    out.height     = Math.round(canvas.height * scale);
    out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);

    const dataUrl  = out.toDataURL("image/jpeg", quality);
    const b64      = dataUrl.split(",")[1];
    canvas.width   = 0;  // free memory
    out.width      = 0;

    frames.push({
      name:       `${file.name} · page ${pageNum}/${pageCount}`,
      b64, url:   dataUrl, type: "image/jpeg",
      source:     "pdf",
      pdfName:    file.name,
      pageNumber: pageNum,
      pageCount,
    });
  }

  return { frames, pageCount };
}

async function extractAudioB64(file, maxSecs = 60) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const targetRate  = 16000;
  const numSamples  = Math.ceil(Math.min(audioBuffer.duration, maxSecs) * targetRate);
  const offCtx      = new OfflineAudioContext(1, numSamples, targetRate);
  const src         = offCtx.createBufferSource();
  src.buffer        = audioBuffer;
  src.connect(offCtx.destination);
  src.start(0);
  const rendered = await offCtx.startRendering();
  const samples  = rendered.getChannelData(0);

  const wavBuf = new ArrayBuffer(44 + samples.length * 2);
  const v      = new DataView(wavBuf);
  const ws     = (off, str) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, targetRate, true);
  v.setUint32(28, targetRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    v.setInt16(off, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
    off += 2;
  }

  const bytes = new Uint8Array(wavBuf);
  let binary  = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fmt(n) {
  return `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function callBackend(path, body) {
  const res = await fetch(`${VERCEL_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fbs-secret": FBS_SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── UI COMPONENTS ────────────────────────────────────────────────────────────
function StatusBadge({ stage }) {
  const map = {
    idle:         { label: "Ready",                color: "#4B5563" },
    transcribing: { label: "Transcribing audio…",  color: "#D97706" },
    describing:   { label: "Analysing frames…",    color: "#D97706" },
    scoping:      { label: "Building takeoff…",    color: "#D97706" },
    done:         { label: "Quote ready",           color: "#059669" },
    error:        { label: "Error",                color: "#DC2626" },
  };
  const s = map[stage] || map.idle;
  const busy = stage === "transcribing" || stage === "describing" || stage === "scoping";
  return (
    <span style={{
      fontSize: 11, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em",
      padding: "3px 10px", borderRadius: 3, background: s.color + "22",
      color: s.color, border: `1px solid ${s.color}44`, textTransform: "uppercase"
    }}>
      {busy && <PulsingDot />}
      {s.label}
    </span>
  );
}

function PulsingDot() {
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: "#D97706", marginRight: 6, verticalAlign: "middle",
      animation: "pulse 1s ease-in-out infinite"
    }} />
  );
}

function Spinner({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#9CA3AF", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
      <div style={{ width: 16, height: 16, border: "2px solid #374151", borderTopColor: "#D97706",
        borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      {label}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FBSQuoteScoper() {
  const [images, setImages]                       = useState([]);
  const [rates, setRates]                         = useState(() => migrateRates(loadLS(LS.rates, null)));
  const [sitePrelims, setSitePrelims]             = useState(() => loadLS(LS.sitePrelims, 8));
  const [overhead, setOverhead]                   = useState(() => loadLS(LS.overhead, 12));
  const [profit, setProfit]                       = useState(() => loadLS(LS.profit, 20));
  const [cisDeduction, setCisDeduction]           = useState(() => loadLS(LS.cisDeduction, 20));
  const [complexity, setComplexity]               = useState("like-for-like swap");
  const [jobRef, setJobRef]                       = useState("FBS-2026-");
  const [jobDescription, setJobDescription]       = useState("");
  const [stage, setStage]                         = useState("idle");
  const [scopeData, setScopeData]                 = useState(null);
  const [quoteData, setQuoteData]                 = useState(null);
  const [error, setError]                         = useState("");
  const [tab, setTab]                             = useState("upload");
  const [quoteMode, setQuoteMode]                 = useState("detailed");
  const [history, setHistory]                     = useState(() => loadLS(LS.history, []));
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);
  const [pendingDeleteId, setPendingDeleteId]         = useState(null);
  const [pendingDeleteLineIndex, setPendingDeleteLineIndex] = useState(null);
  const [jobSummary, setJobSummary]               = useState("");
  const [videoProcessing, setVideoProcessing]     = useState(false);
  const [pdfProcessing, setPdfProcessing]         = useState(false);
  const [pdfTruncWarnings, setPdfTruncWarnings]   = useState([]);
  const [pendingClear, setPendingClear]           = useState(false);
  const [refinementText, setRefinementText]       = useState("");
  const [refinementOpen, setRefinementOpen]       = useState(false);
  const [audioClips, setAudioClips]               = useState([]);
  const [transcriptData, setTranscriptData]       = useState(null);
  const [descriptionData, setDescriptionData]     = useState(null);
  const fileRef = useRef();

  // Persist settings to localStorage
  useEffect(() => { try { localStorage.setItem(LS.rates,       JSON.stringify(rates));       } catch {} }, [rates]);
  useEffect(() => { try { localStorage.setItem(LS.sitePrelims, JSON.stringify(sitePrelims)); } catch {} }, [sitePrelims]);
  useEffect(() => { try { localStorage.setItem(LS.overhead,    JSON.stringify(overhead));    } catch {} }, [overhead]);
  useEffect(() => { try { localStorage.setItem(LS.profit,      JSON.stringify(profit));      } catch {} }, [profit]);
  useEffect(() => { try { localStorage.setItem(LS.cisDeduction,JSON.stringify(cisDeduction));} catch {} }, [cisDeduction]);
  useEffect(() => { try { localStorage.setItem(LS.history,     JSON.stringify(history));     } catch {} }, [history]);

  const handleFiles = useCallback(async (files) => {
    const photos = [];
    const videos = [];
    const pdfs   = [];
    for (const f of files) {
      if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) pdfs.push(f);
      else if (f.type.startsWith("image/"))      photos.push(f);
      else if (f.type.startsWith("video/"))      videos.push(f);
    }

    if (photos.length) {
      const arr = [];
      for (const f of photos) {
        const b64 = await resizeImage(f);
        arr.push({ name: f.name, b64, url: URL.createObjectURL(f), type: "image/jpeg", source: "photo" });
      }
      setImages(prev => [...prev, ...arr]);
    }

    if (videos.length) {
      setVideoProcessing(true);
      try {
        for (const vf of videos) {
          const [frames, audioB64] = await Promise.all([
            extractVideoFrames(vf),
            extractAudioB64(vf).catch(() => null),
          ]);
          setImages(prev => [...prev, ...frames]);
          if (audioB64) {
            setAudioClips(prev => [
              ...prev.filter(c => c.videoName !== vf.name),
              { videoName: vf.name, b64: audioB64 },
            ]);
          }
        }
      } finally {
        setVideoProcessing(false);
      }
    }

    if (pdfs.length) {
      setPdfProcessing(true);
      try {
        for (const pf of pdfs) {
          const { frames, pageCount } = await extractPdfPages(pf);
          setImages(prev => [...prev, ...frames]);
          if (pageCount > 10) {
            setPdfTruncWarnings(prev => [
              ...prev.filter(w => w.name !== pf.name),
              { name: pf.name, total: pageCount },
            ]);
          }
        }
      } finally {
        setPdfProcessing(false);
      }
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const removeImage = (i) => {
    setImages(prev => {
      const removed = prev[i];
      const next    = prev.filter((_, idx) => idx !== i);
      if (removed?.source === "video") {
        const stillHas = next.some(img => img.videoName === removed.videoName);
        if (!stillHas) setAudioClips(clips => clips.filter(c => c.videoName !== removed.videoName));
      }
      return next;
    });
  };

  const deleteLineItem = (i) => {
    if (!quoteData) return;
    const newItems = quoteData.line_items.filter((_, idx) => idx !== i);
    // Re-price with same settings but without the deleted item's original (pre-multiplied) quantities
    // Since line_items already have adj quantities, we re-price directly from those
    const repriced = priceScope(
      newItems.map(l => ({ ...l, quantity: l.quantity })),
      rates, quoteData.complexity || complexity,
      quoteData.site_prelims_pct, quoteData.overhead_pct, quoteData.profit_pct,
      quoteData.cis_pct ?? cisDeduction
    );
    // Multipliers would be re-applied — but since items already carry adj quantities and the
    // "like-for-like" multiplier is 1.0, passing the items through priceScope with complexity
    // "like-for-like swap" ensures quantities aren't re-multiplied. We pass items directly.
    setQuoteData({
      ...repriced,
      // Use already-adjusted items, priced at like-for-like (×1.0) to avoid double-multiplying
    });
  };

  const saveToHistory = () => {
    if (!quoteData || !scopeData) return;
    const entry = {
      id:              `${jobRef}-${Date.now()}`,
      jobRef,
      jobSummary,
      date:            new Date().toISOString(),
      total:           quoteData.total,
      complexity:      quoteData.complexity,
      scopeSummary:    scopeData.scope_summary,
      quoteData,
      scopeData,
      descriptionData,
    };
    setHistory(prev => [entry, ...prev].slice(0, 100));
  };

  const deleteHistoryEntry = (id) => {
    setHistory(prev => prev.filter(e => e.id !== id));
    setPendingDeleteId(null);
  };

  const loadHistoryEntry = (entry, openRefinement = false) => {
    setJobRef(entry.jobRef);
    setJobSummary(entry.jobSummary || "");
    setScopeData(entry.scopeData);
    setQuoteData(entry.quoteData);
    setDescriptionData(entry.descriptionData || null);
    setStage("done");
    setTab("quote");
    setExpandedHistoryId(null);
    setRefinementText("");
    setRefinementOpen(openRefinement);
  };

  const clearAll = () => {
    setImages([]); setAudioClips([]); setPdfTruncWarnings([]);
    setTranscriptData(null); setDescriptionData(null);
    setScopeData(null); setQuoteData(null);
    setStage("idle"); setError("");
    setJobSummary(""); setJobDescription("");
    setRefinementText(""); setRefinementOpen(false);
    setPendingClear(false);
    setTab("upload");
  };

  const buildProxyDescription = (sd) =>
    `[Re-scope from prior estimate]\n${sd.scope_summary}\n\nPrevious scope items:\n` +
    sd.items.map(i => `- ${i.trade}: ${i.quantity} ${i.unit} — ${i.description}`).join("\n");

  const runRefinement = async () => {
    if (!scopeData) return;
    setRefinementOpen(false);
    setScopeData(null); setQuoteData(null); setError("");
    setStage("scoping");
    try {
      const effectiveDescription = descriptionData || buildProxyDescription(scopeData);
      const scope = await callBackend("/api/scope", {
        description: effectiveDescription,
        complexity,
        ...(jobDescription.trim() && { jobDescription: jobDescription.trim() }),
        ...(transcriptData         && { transcript: transcriptData }),
        refinements: refinementText,
      });
      setScopeData(scope);
      setJobSummary(prev => prev.trim() ? prev
        : (scope.scope_summary?.split(/\s+/).slice(0, 6).join(" ") ?? ""));
      const quote = priceScope(scope.items, rates, complexity, sitePrelims, overhead, profit, cisDeduction);
      setQuoteData(quote);
      setStage("done");
    } catch (e) {
      setError(e.message);
      setStage("error");
    }
  };

  const runPipeline = async () => {
    if (images.length === 0) { setError("Upload at least one photo or video."); return; }
    setError(""); setScopeData(null); setQuoteData(null); setTranscriptData(null); setDescriptionData(null);
    const hasAudio = audioClips.length > 0;

    try {
      setTab("quote");

      // Stage 1 — Transcribe audio (optional, non-fatal)
      let transcript = null;
      if (hasAudio) {
        setStage("transcribing");
        try {
          const result = await callBackend("/api/transcribe", { audio: audioClips[0].b64 });
          transcript = result.transcript || null;
          setTranscriptData(transcript);
        } catch (e) {
          console.warn("Transcription skipped:", e.message);
        }
      }

      // Stage 2 — Gemini 2.0 Flash: frames → rich text description
      setStage("describing");
      const { description } = await callBackend("/api/describe", {
        images: images.map(img => ({ b64: img.b64, type: img.type })),
        ...(jobDescription.trim() && { jobDescription: jobDescription.trim() }),
      });
      setDescriptionData(description);

      // Stage 3 — Kimi K2.5: text description → quantity takeoff
      setStage("scoping");
      const scope = await callBackend("/api/scope", {
        description,
        complexity,
        ...(jobDescription.trim() && { jobDescription: jobDescription.trim() }),
        ...(transcript            && { transcript }),
      });
      setScopeData(scope);
      setJobSummary(prev => prev.trim() ? prev
        : (scope.scope_summary?.split(/\s+/).slice(0, 6).join(" ") ?? ""));

      // Stage 4 — Deterministic pricing (no API call)
      const quote = priceScope(scope.items, rates, complexity, sitePrelims, overhead, profit, cisDeduction);
      setQuoteData(quote);
      setStage("done");
    } catch (e) {
      setError(e.message);
      setStage("error");
    }
  };

  const copyQuote = () => {
    if (!quoteData) return;
    const q = quoteData;
    const isNew = q.labour_subtotal !== undefined;

    let lines;
    if (quoteMode === "detailed") {
      lines = [
        `FALLOW BUILDING SERVICES — QUOTE ESTIMATE`,
        `Ref: ${jobRef}${jobSummary ? ` — ${jobSummary}` : ""}${q.complexity ? ` · ${q.complexity}` : ""}`,
        ``,
        `TRADE BREAKDOWN`,
        `${"─".repeat(90)}`,
        ...quoteData.line_items.map(l => {
          const rate = isNew ? (l.labour_rate + l.materials_rate) : l.rate;
          const ps   = l.confidence === "low" ? " (PS)" : "";
          return `${(l.trade + ps).padEnd(32)} ${String(l.quantity).padStart(7)} ${l.unit.padEnd(4)}  @ £${rate}/${l.unit}  =  ${fmt(l.cost)}`;
        }),
        `${"─".repeat(90)}`,
        ...(isNew ? [
          `Labour (direct costs):                                                       ${fmt(q.labour_subtotal)}`,
          `Materials (direct costs):                                                    ${fmt(q.materials_subtotal)}`,
          `Direct Costs:                                                                ${fmt(q.subtotal)}`,
          `Site Prelims / Supervision (${q.site_prelims_pct}%):                                          ${fmt(q.site_prelims_cost)}`,
          `Company Overhead (${q.overhead_pct}%):                                                        ${fmt(q.overhead_cost)}`,
          `${"─".repeat(90)}`,
          `Total Cost:                                                                  ${fmt(q.subtotal + q.site_prelims_cost + q.overhead_cost)}`,
          `Net Profit (${q.profit_pct}%):                                                              ${fmt(q.profit_cost)}`,
        ] : [
          `Subtotal (direct costs):                                                     ${fmt(q.subtotal)}`,
          `Prelims / Supervision (${q.prelims_pct}%):                                                ${fmt(q.prelims_cost)}`,
          `FBS Margin (${q.margin_pct}%):                                                             ${fmt(q.margin_cost)}`,
        ]),
        `${"═".repeat(90)}`,
        `TOTAL (ex VAT):                                                                ${fmt(q.total)}`,
        ``,
        `CIS withheld from subbies (${q.cis_pct}%):                                                -${fmt(q.cis_cost)}`,
        ...(isNew && q.ps_subtotal > 0 ? [``, `Note: Includes ${fmt(q.ps_subtotal)} provisional sums (PS) — subject to site verification.`] : []),
        ``,
        q.vat_note,
      ];
    } else {
      lines = [
        `FALLOW BUILDING SERVICES — QUOTE ESTIMATE`,
        `Ref: ${jobRef}${q.complexity ? ` · ${q.complexity}` : ""}`,
        ``,
        ...(isNew ? [
          `Labour (direct costs):        ${fmt(q.labour_subtotal)}`,
          `Materials (direct costs):     ${fmt(q.materials_subtotal)}`,
          `Direct Costs:                 ${fmt(q.subtotal)}`,
          `Site Prelims (${q.site_prelims_pct}%):            ${fmt(q.site_prelims_cost)}`,
          `Company Overhead (${q.overhead_pct}%):            ${fmt(q.overhead_cost)}`,
          `${"─".repeat(48)}`,
          `Total Cost:                   ${fmt(q.subtotal + q.site_prelims_cost + q.overhead_cost)}`,
          `Net Profit (${q.profit_pct}%):               ${fmt(q.profit_cost)}`,
        ] : [
          `Subtotal (direct costs):      ${fmt(q.subtotal)}`,
          `Prelims (${q.prelims_pct}%):               ${fmt(q.prelims_cost)}`,
          `FBS Margin (${q.margin_pct}%):             ${fmt(q.margin_cost)}`,
        ]),
        `${"─".repeat(48)}`,
        `TOTAL (EX VAT):               ${fmt(q.total)}`,
        ``,
        `CIS withheld from subbies (${q.cis_pct}%): -${fmt(q.cis_cost)}`,
        ...(isNew && q.ps_subtotal > 0 ? [``, `Includes ${fmt(q.ps_subtotal)} provisional sums — subject to site verification.`] : []),
        ``,
        q.vat_note,
      ];
    }
    navigator.clipboard.writeText(lines.join("\n"));
  };

  const C = {
    bg: "#0F1117", card: "#161B27", border: "#1E2535",
    amber: "#F59E0B", subtle: "#374151", muted: "#6B7280",
    text: "#E5E7EB", green: "#10B981", red: "#EF4444",
  };

  const busy      = stage === "transcribing" || stage === "describing" || stage === "scoping";
  const hasAudio  = audioClips.length > 0;
  const totalStages = hasAudio ? 3 : 2;
  const videoNames  = [...new Set(images.filter(i => i.source === "video").map(i => i.videoName))];

  const COMPLEXITY_TIERS = [
    "like-for-like swap",
    "partial renovation",
    "full renovation",
    "new build / extension",
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text,
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif", paddingBottom: 60 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&family=Bebas+Neue&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }
        @keyframes slideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
        input:focus, textarea:focus { outline: 1px solid #F59E0B !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }
        .row-hover:hover { background: #1E2535 !important; }
        .del-btn { opacity: 0.35; transition: opacity 0.15s; }
        .row-hover:hover .del-btn { opacity: 1; }
        .hist-card:hover { background: #1E2535 !important; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, background: C.amber, borderRadius: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Bebas Neue'", fontSize: 18, color: "#000", letterSpacing: 1 }}>FBS</div>
          <div>
            <div style={{ fontFamily: "'Bebas Neue'", fontSize: 20, letterSpacing: "0.08em", lineHeight: 1 }}>
              QUOTE SCOPER
            </div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'", marginTop: 1 }}>
              Gemini 2.0 Flash → Kimi K2.5 · Video + Audio → Takeoff → Deterministic Quote
            </div>
          </div>
        </div>
        <StatusBadge stage={stage} />
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px" }}>

        {/* JOB REF + SUMMARY + CLEAR + RUN */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontFamily: "'DM Mono'", color: C.muted, whiteSpace: "nowrap" }}>JOB REF</div>
          <input value={jobRef} onChange={e => setJobRef(e.target.value)}
            style={{ width: 160, background: C.card, border: `1px solid ${C.subtle}`,
              borderRadius: 5, padding: "8px 12px", color: C.text, fontSize: 13,
              fontFamily: "'DM Mono'" }} />
          <input value={jobSummary} onChange={e => setJobSummary(e.target.value)}
            placeholder="client / job summary…"
            style={{ flex: 1, minWidth: 140, background: C.card, border: `1px solid ${C.subtle}`,
              borderRadius: 5, padding: "8px 12px", color: C.text, fontSize: 12,
              fontFamily: "'DM Mono'" }} />
          {/* Clear All */}
          {pendingClear ? (
            <>
              <button onClick={clearAll}
                style={{ background: C.red, border: "none", borderRadius: 5, padding: "8px 14px",
                  color: "#fff", fontFamily: "'DM Mono'", fontSize: 11, cursor: "pointer",
                  letterSpacing: "0.06em" }}>CONFIRM CLEAR</button>
              <button onClick={() => setPendingClear(false)}
                style={{ background: "transparent", border: `1px solid ${C.subtle}`, borderRadius: 5,
                  padding: "8px 12px", color: C.muted, fontFamily: "'DM Mono'",
                  fontSize: 11, cursor: "pointer" }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setPendingClear(true)}
              style={{ background: "transparent", border: `1px solid ${C.subtle}`, borderRadius: 5,
                padding: "8px 12px", color: C.muted, fontFamily: "'DM Mono'",
                fontSize: 11, cursor: "pointer" }}>✕ Clear</button>
          )}
          <button onClick={runPipeline} disabled={busy}
            style={{ background: busy ? C.subtle : C.amber, color: "#000", border: "none",
              borderRadius: 6, padding: "10px 28px", fontFamily: "'Bebas Neue'", fontSize: 16,
              letterSpacing: "0.08em", cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
            {stage === "transcribing" ? "Transcribing…" :
             stage === "describing"   ? "Analysing…"    :
             stage === "scoping"      ? "Scoping…"      : "▶  Run Scope + Price"}
          </button>
        </div>

        {/* TABS */}
        <div style={{ display: "flex", gap: 2, marginBottom: 0 }}>
          {[
            { id: "upload",  label: `📷 Media${images.length ? ` (${images.length})` : ""}` },
            { id: "rates",   label: "⚙️  Rates & Margin" },
            { id: "quote",   label: "📋 Quote Output" },
            { id: "history", label: `🕒 History${history.length ? ` (${history.length})` : ""}` },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: "8px 20px", border: "none", borderRadius: "5px 5px 0 0",
                background: tab === id ? C.card : "transparent",
                color: tab === id ? C.amber : C.muted,
                fontFamily: "'DM Mono'", fontSize: 12, textTransform: "uppercase",
                letterSpacing: "0.08em", cursor: "pointer",
                borderBottom: tab === id ? `2px solid ${C.amber}` : "2px solid transparent" }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`,
          borderRadius: "0 8px 8px 8px", padding: 20 }}>

          {/* ── TAB: MEDIA ─────────────────────────────────────────────────── */}
          {tab === "upload" && (
            <div style={{ animation: "slideIn 0.2s ease" }}>
              {/* Job Brief */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'",
                  textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                  Job Brief{" "}
                  <span style={{ color: C.subtle, textTransform: "none", letterSpacing: 0 }}>
                    — optional, recommended when including video
                  </span>
                </label>
                <textarea
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                  placeholder="e.g. Full bathroom refurb — client wants retiling, new shower, replaster walls and ceiling…"
                  rows={3}
                  style={{ width: "100%", background: "#0F1117", border: `1px solid ${C.subtle}`,
                    borderRadius: 5, padding: "10px 12px", color: C.text, fontSize: 13,
                    fontFamily: "'DM Sans'", resize: "vertical", lineHeight: 1.6 }}
                />
              </div>

              {/* Complexity selector */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'",
                  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Job Complexity
                </div>
                <div style={{ display: "flex", gap: 0, border: `1px solid ${C.subtle}`, borderRadius: 5, overflow: "hidden", width: "fit-content" }}>
                  {COMPLEXITY_TIERS.map(tier => (
                    <button key={tier} onClick={() => setComplexity(tier)}
                      style={{ padding: "6px 14px", border: "none",
                        borderRight: `1px solid ${C.subtle}`,
                        cursor: "pointer",
                        background: complexity === tier ? C.amber : "transparent",
                        color: complexity === tier ? "#000" : C.muted,
                        fontSize: 11, fontFamily: "'DM Mono'", letterSpacing: "0.05em",
                        textTransform: "capitalize", whiteSpace: "nowrap" }}>
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dropzone */}
              <div onDrop={onDrop} onDragOver={e => e.preventDefault()}
                onClick={() => fileRef.current.click()}
                style={{ border: `2px dashed ${videoProcessing ? C.amber : C.subtle}`, borderRadius: 8,
                  padding: "40px 20px", textAlign: "center", cursor: "pointer", marginBottom: 20,
                  transition: "border-color 0.2s" }}>
                <input ref={fileRef} type="file" multiple accept="image/*,video/*,application/pdf,.pdf" style={{ display: "none" }}
                  onChange={e => handleFiles(Array.from(e.target.files))} />
                {videoProcessing ? (
                  <Spinner label="Extracting video frames + audio…" />
                ) : pdfProcessing ? (
                  <Spinner label="Rasterising PDF pages…" />
                ) : (
                  <>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📸</div>
                    <div style={{ color: C.muted, fontSize: 14 }}>Drop photos, videos or PDF drawings here, or click to browse</div>
                    <div style={{ color: C.subtle, fontSize: 11, marginTop: 6, fontFamily: "'DM Mono'" }}>
                      JPG · PNG · WEBP · MP4 · MOV · PDF · multiple angles recommended
                    </div>
                  </>
                )}
              </div>

              {/* Video summary */}
              {videoNames.length > 0 && (
                <div style={{ marginBottom: 12, padding: "8px 14px", background: "#F59E0B11",
                  border: `1px solid #F59E0B33`, borderRadius: 6, fontSize: 12,
                  color: C.muted, fontFamily: "'DM Mono'" }}>
                  🎬 {videoNames.length} video{videoNames.length > 1 ? "s" : ""} →{" "}
                  {images.filter(i => i.source === "video").length} frames extracted
                  {audioClips.length > 0 && " · audio ready for transcription"}
                </div>
              )}

              {/* PDF truncation warnings */}
              {pdfTruncWarnings.map(w => (
                <div key={w.name} style={{ marginBottom: 12, padding: "8px 14px", background: "#3B82F611",
                  border: `1px solid #3B82F633`, borderRadius: 6, fontSize: 12,
                  color: C.muted, fontFamily: "'DM Mono'" }}>
                  ⚠ {w.name} has {w.total} pages — first 10 shown. For large drawing sets, upload individual sheets.
                </div>
              ))}

              {/* Media grid */}
              {images.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                  {images.map((img, i) => (
                    <div key={i} style={{ position: "relative", borderRadius: 6, overflow: "hidden",
                      border: `1px solid ${img.source === "video" ? "#F59E0B44" : img.source === "pdf" ? "#3B82F644" : C.border}` }}>
                      <img src={img.url} alt={img.name}
                        style={{ width: "100%", height: 100, objectFit: "cover", display: "block" }} />
                      {img.source === "video" && (
                        <div style={{ position: "absolute", top: 4, left: 4, background: "#00000099",
                          borderRadius: 3, padding: "2px 5px", fontSize: 9,
                          color: C.amber, fontFamily: "'DM Mono'" }}>▶ frame</div>
                      )}
                      {img.source === "pdf" && (
                        <div style={{ position: "absolute", top: 4, left: 4, background: "#00000099",
                          borderRadius: 3, padding: "2px 5px", fontSize: 9,
                          color: "#60A5FA", fontFamily: "'DM Mono'" }}>
                          📄 {img.pageNumber}/{img.pageCount}
                        </div>
                      )}
                      <button onClick={() => removeImage(i)}
                        style={{ position: "absolute", top: 4, right: 4, background: "#00000099",
                          border: "none", color: "#fff", borderRadius: "50%", width: 22, height: 22,
                          cursor: "pointer", fontSize: 12 }}>×</button>
                      <div style={{ padding: "4px 6px", fontSize: 10, color: C.muted,
                        fontFamily: "'DM Mono'", background: C.card,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {img.source === "pdf" ? img.pdfName : img.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── TAB: RATES ─────────────────────────────────────────────────── */}
          {tab === "rates" && (
            <div style={{ animation: "slideIn 0.2s ease" }}>
              {/* Financial model — 3 fields + CIS */}
              <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                {[
                  { label: "SITE PRELIMS %",      val: sitePrelims, set: setSitePrelims, color: C.text,    hint: "Skip hire, PPE, site visits" },
                  { label: "COMPANY OVERHEAD %",   val: overhead,    set: setOverhead,    color: C.text,    hint: "Insurance, vehicles, office" },
                  { label: "NET PROFIT %",          val: profit,      set: setProfit,      color: C.amber,   hint: "Genuine profit margin" },
                  { label: "CIS DEDUCTION %",       val: cisDeduction,set: setCisDeduction,color: "#9CA3AF", hint: "Informational — withheld from subbies" },
                ].map(({ label, val, set, color, hint }) => (
                  <div key={label} style={{ flex: "1 1 120px", minWidth: 120 }}>
                    <label style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'",
                      display: "block", marginBottom: 4 }}>{label}</label>
                    <div style={{ fontSize: 10, color: C.subtle, fontFamily: "'DM Mono'", marginBottom: 6 }}>{hint}</div>
                    <input type="number" value={val} onChange={e => set(+e.target.value)}
                      style={{ width: "100%", background: "#0F1117", border: `1px solid ${C.subtle}`,
                        borderRadius: 5, padding: "8px 12px", color, fontSize: 16,
                        fontFamily: "'DM Mono'", textAlign: "center" }} />
                  </div>
                ))}
              </div>

              {/* Rate card */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'",
                    textTransform: "uppercase", letterSpacing: "0.06em" }}>Cost Rates</div>
                  <div style={{ fontSize: 10, color: C.subtle, fontFamily: "'DM Mono'", marginTop: 3, maxWidth: 480 }}>
                    Labour = what FBS pays per unit · Materials = trade installation materials (adhesive, fittings, cable) · Finish materials (tiles, sanitaryware, boards) are PC sums
                  </div>
                </div>
                <button onClick={() => setRates(DEFAULT_RATES)}
                  style={{ background: "transparent", border: "none", color: C.muted,
                    fontSize: 11, fontFamily: "'DM Mono'", cursor: "pointer",
                    textDecoration: "underline", letterSpacing: "0.04em", flexShrink: 0, marginLeft: 12 }}>
                  Reset to defaults
                </button>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Trade", "Unit", "Labour (£)", "Materials (£)", "Total (£/unit)"].map((h, i) => (
                      <th key={h} style={{ padding: "8px 10px", textAlign: i >= 2 ? "right" : "left",
                        color: C.muted, fontFamily: "'DM Mono'", fontSize: 11,
                        textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 400 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => (
                    <tr key={i} className="row-hover"
                      style={{ borderBottom: `1px solid ${C.border}22`, transition: "background 0.1s" }}>
                      <td style={{ padding: "7px 10px" }}>{r.trade}</td>
                      <td style={{ padding: "7px 10px", color: C.muted, fontFamily: "'DM Mono'", fontSize: 12 }}>{r.unit}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>
                        <input type="number" value={r.labour}
                          onChange={e => setRates(prev => prev.map((x, j) => j === i ? { ...x, labour: +e.target.value } : x))}
                          style={{ width: 70, background: "#0F1117", border: `1px solid ${C.subtle}`,
                            borderRadius: 4, padding: "4px 8px", color: C.amber,
                            fontSize: 13, fontFamily: "'DM Mono'", textAlign: "right" }} />
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>
                        <input type="number" value={r.materials}
                          onChange={e => setRates(prev => prev.map((x, j) => j === i ? { ...x, materials: +e.target.value } : x))}
                          style={{ width: 70, background: "#0F1117", border: `1px solid ${C.subtle}`,
                            borderRadius: 4, padding: "4px 8px", color: "#60A5FA",
                            fontSize: 13, fontFamily: "'DM Mono'", textAlign: "right" }} />
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'DM Mono'", color: C.muted, fontSize: 12 }}>
                        £{r.labour + (r.materials || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── TAB: QUOTE ─────────────────────────────────────────────────── */}
          {tab === "quote" && (
            <div style={{ animation: "slideIn 0.2s ease" }}>
              {stage === "transcribing" && (
                <div style={{ padding: "40px 0", textAlign: "center" }}>
                  <Spinner label={`Stage 1/${totalStages} · Transcribing audio with Whisper…`} />
                </div>
              )}
              {stage === "describing" && (
                <div style={{ padding: "40px 0", textAlign: "center" }}>
                  <Spinner label={`Stage ${hasAudio ? "2" : "1"}/${totalStages} · Gemini 2.0 Flash analysing all frames…`} />
                </div>
              )}
              {stage === "scoping" && (
                <div style={{ padding: "40px 0", textAlign: "center" }}>
                  <Spinner label={`Stage ${hasAudio ? "3" : "2"}/${totalStages} · Kimi K2.5 building quantity takeoff…`} />
                </div>
              )}

              {error && (
                <div style={{ background: "#DC262611", border: `1px solid #DC262633`,
                  borderRadius: 6, padding: "12px 16px", color: C.red, fontSize: 13, marginBottom: 16 }}>
                  ⚠ {error}
                </div>
              )}

              {scopeData && stage !== "scoping" && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'",
                    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                    Scope Summary
                  </div>
                  <div style={{ background: "#0F1117", borderRadius: 6, padding: "12px 14px",
                    border: `1px solid ${C.border}`, fontSize: 13, lineHeight: 1.6 }}>
                    {scopeData.scope_summary}
                  </div>
                  {scopeData.assumptions?.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: C.muted,
                        fontFamily: "'DM Mono'", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        Assumptions ({scopeData.assumptions.length})
                      </summary>
                      <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: C.muted, lineHeight: 1.7 }}>
                        {scopeData.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </details>
                  )}
                  {scopeData.site_queries?.length > 0 && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: "#D97706",
                        fontFamily: "'DM Mono'", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        ⚠ Site Queries ({scopeData.site_queries.length})
                      </summary>
                      <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: "#D97706", lineHeight: 1.7 }}>
                        {scopeData.site_queries.map((q, i) => <li key={i}>{q}</li>)}
                      </ul>
                    </details>
                  )}
                  {descriptionData && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: C.muted,
                        fontFamily: "'DM Mono'", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        🔍 Visual Site Description (Gemini)
                      </summary>
                      <div style={{ marginTop: 6, padding: "10px 14px", background: "#0F1117",
                        borderRadius: 5, border: `1px solid ${C.border}`,
                        fontSize: 12, color: C.muted, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                        {descriptionData}
                      </div>
                    </details>
                  )}
                  {transcriptData && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: C.muted,
                        fontFamily: "'DM Mono'", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        🎙 Audio Transcript
                      </summary>
                      <div style={{ marginTop: 6, padding: "10px 14px", background: "#0F1117",
                        borderRadius: 5, border: `1px solid ${C.border}`,
                        fontSize: 12, color: C.muted, lineHeight: 1.8, fontStyle: "italic" }}>
                        {transcriptData}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* ── Refinement panel ── */}
              {scopeData && stage === "done" && (
                <div style={{ marginBottom: 16 }}>
                  {!refinementOpen ? (
                    <button onClick={() => setRefinementOpen(true)}
                      style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                        borderRadius: 5, padding: "6px 14px", color: C.muted,
                        fontFamily: "'DM Mono'", fontSize: 11, cursor: "pointer",
                        letterSpacing: "0.05em" }}>
                      ✏ Refine this quote
                    </button>
                  ) : (
                    <div style={{ background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: "16px 18px" }}>
                      <div style={{ fontSize: 11, fontFamily: "'DM Mono'", color: C.muted,
                        textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                        Refinements &amp; Adjustments
                      </div>
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
                        Respond to site queries, correct assumptions, or add context not visible in the photos.
                        {!descriptionData && (
                          <span style={{ color: "#D97706", display: "block", marginTop: 4 }}>
                            ⚠ No original description found — re-scope will use prior items as context (lower fidelity).
                          </span>
                        )}
                      </div>
                      <textarea
                        value={refinementText}
                        onChange={e => setRefinementText(e.target.value)}
                        rows={5}
                        placeholder={scopeData.site_queries?.length
                          ? `Address these site queries:\n${scopeData.site_queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
                          : "Add corrections, additional context, or scope adjustments…"}
                        style={{ width: "100%", background: "#0F1117", border: `1px solid ${C.subtle}`,
                          borderRadius: 5, padding: "10px 12px", color: C.text, fontSize: 12,
                          fontFamily: "'DM Mono'", lineHeight: 1.6, resize: "vertical",
                          boxSizing: "border-box" }}
                      />
                      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                        <button onClick={runRefinement} disabled={!refinementText.trim()}
                          style={{ background: refinementText.trim() ? C.amber : C.subtle,
                            border: "none", borderRadius: 5, padding: "8px 18px", color: "#000",
                            fontFamily: "'Bebas Neue'", fontSize: 14, letterSpacing: "0.08em",
                            cursor: refinementText.trim() ? "pointer" : "not-allowed" }}>
                          Re-scope with adjustments
                        </button>
                        <button onClick={() => setRefinementOpen(false)}
                          style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                            borderRadius: 5, padding: "8px 14px", color: C.muted,
                            fontFamily: "'DM Mono'", fontSize: 11, cursor: "pointer" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {quoteData && (
                <div>
                  {/* Quote header bar */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: "0.08em", color: C.amber }}>
                      {jobRef}
                      {jobSummary && (
                        <span style={{ fontSize: 12, color: C.text, fontFamily: "'DM Mono'",
                          fontWeight: 400, textTransform: "none", letterSpacing: 0,
                          marginLeft: 10 }}>— {jobSummary}</span>
                      )}
                      {quoteData.complexity && (
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: "'DM Mono'",
                          fontWeight: 400, textTransform: "none", letterSpacing: 0,
                          marginLeft: 10 }}>
                          · {quoteData.complexity}
                        </span>
                      )}
                      {" · Quote Output"}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ display: "flex", border: `1px solid ${C.subtle}`, borderRadius: 5, overflow: "hidden" }}>
                        {["detailed", "summary"].map(mode => (
                          <button key={mode} onClick={() => setQuoteMode(mode)}
                            style={{ padding: "5px 14px", border: "none", cursor: "pointer",
                              background: quoteMode === mode ? C.subtle : "transparent",
                              color: quoteMode === mode ? C.text : C.muted,
                              fontSize: 11, fontFamily: "'DM Mono'", letterSpacing: "0.06em",
                              textTransform: "uppercase" }}>
                            {mode}
                          </button>
                        ))}
                      </div>
                      <button onClick={copyQuote}
                        style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                          borderRadius: 5, padding: "5px 14px", color: C.muted, fontSize: 11,
                          fontFamily: "'DM Mono'", cursor: "pointer", letterSpacing: "0.06em" }}>
                        COPY TEXT
                      </button>
                      {stage === "done" && (
                        <button onClick={saveToHistory}
                          style={{ background: "#059669", border: "none",
                            borderRadius: 5, padding: "5px 14px", color: "#fff", fontSize: 11,
                            fontFamily: "'DM Mono'", cursor: "pointer", letterSpacing: "0.06em" }}>
                          SAVE
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Line items table — detailed mode only */}
                  {quoteMode === "detailed" && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 4 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid #F59E0B33` }}>
                          {["Trade", "Description", "Qty", "Unit", "Rate", "Cost", ""].map(h => (
                            <th key={h} style={{ padding: "8px 10px",
                              textAlign: ["Cost", "Rate", "Qty"].includes(h) ? "right" : "left",
                              color: C.muted, fontFamily: "'DM Mono'", fontSize: 10,
                              textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 400 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {quoteData.line_items.map((l, i) => {
                          const isPS       = l.confidence === "low";
                          const totalRate  = (l.labour_rate || 0) + (l.materials_rate || 0) || l.rate || 0;
                          return (
                            <tr key={i} className="row-hover"
                              style={{ borderBottom: `1px solid ${C.border}55`,
                                background: isPS ? "#F59E0B08" : undefined,
                                transition: "background 0.1s" }}>
                              <td style={{ padding: "8px 10px", fontWeight: 500 }}>
                                {l.trade}
                                {isPS && (
                                  <span style={{ marginLeft: 6, fontSize: 9, fontFamily: "'DM Mono'",
                                    color: C.amber, border: `1px solid ${C.amber}55`,
                                    borderRadius: 3, padding: "1px 5px", verticalAlign: "middle" }}>PS</span>
                                )}
                              </td>
                              <td style={{ padding: "8px 10px", color: C.muted, fontSize: 12 }}>{l.description}</td>
                              <td style={{ padding: "8px 10px", fontFamily: "'DM Mono'", textAlign: "right" }}>{l.quantity}</td>
                              <td style={{ padding: "8px 10px", color: C.muted, fontFamily: "'DM Mono'", fontSize: 11 }}>{l.unit}</td>
                              <td style={{ padding: "8px 10px", color: C.muted, fontFamily: "'DM Mono'", textAlign: "right", fontSize: 12 }}>£{totalRate}</td>
                              <td style={{ padding: "8px 10px", fontFamily: "'DM Mono'", textAlign: "right", fontWeight: 500 }}>{fmt(l.cost)}</td>
                              <td style={{ padding: "8px 6px", textAlign: "right", width: pendingDeleteLineIndex === i ? 140 : 32, whiteSpace: "nowrap" }}>
                                {pendingDeleteLineIndex === i ? (
                                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                    <button onClick={() => { deleteLineItem(i); setPendingDeleteLineIndex(null); }}
                                      style={{ background: C.red, border: "none", borderRadius: 3,
                                        color: "#fff", fontSize: 10, fontFamily: "'DM Mono'",
                                        cursor: "pointer", padding: "3px 8px", letterSpacing: "0.04em" }}>
                                      DELETE
                                    </button>
                                    <button onClick={() => setPendingDeleteLineIndex(null)}
                                      style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                                        borderRadius: 3, color: C.muted, fontSize: 10, fontFamily: "'DM Mono'",
                                        cursor: "pointer", padding: "3px 8px" }}>
                                      Cancel
                                    </button>
                                  </span>
                                ) : (
                                  <button className="del-btn"
                                    onClick={() => setPendingDeleteLineIndex(i)}
                                    title="Remove line item"
                                    style={{ background: "none", border: "none", color: C.red,
                                      cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px" }}>×</button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Totals */}
                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: quoteMode === "summary" ? 0 : 10, paddingTop: 12 }}>
                    {(() => {
                      const q = quoteData;
                      const isNew = q.labour_subtotal !== undefined;
                      if (isNew) {
                        const totalCost = q.subtotal + q.site_prelims_cost + q.overhead_cost;
                        return (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 12, color: C.muted }}>
                              <span>Labour (direct costs)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.labour_subtotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 12, color: C.muted }}>
                              <span>Materials (direct costs)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.materials_subtotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px 2px", fontSize: 13, borderTop: `1px solid ${C.border}44`, marginTop: 2 }}>
                              <span>Direct Costs{q.ps_subtotal > 0 ? <span style={{ fontSize: 11, color: C.amber, fontFamily: "'DM Mono'", marginLeft: 8 }}>incl. {fmt(q.ps_subtotal)} PS</span> : ""}</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.subtotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 12, color: C.muted }}>
                              <span>Site Prelims ({q.site_prelims_pct}%)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.site_prelims_cost)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 12, color: C.muted }}>
                              <span>Company Overhead ({q.overhead_pct}%)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.overhead_cost)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px 2px", fontSize: 13, borderTop: `1px solid ${C.border}44`, marginTop: 2 }}>
                              <span>Total Cost</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(totalCost)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", fontSize: 12, color: C.muted }}>
                              <span>Net Profit ({q.profit_pct}%)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.profit_cost)}</span>
                            </div>
                          </>
                        );
                      } else {
                        // Legacy format (old history entries)
                        return (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: C.muted }}>
                              <span>Subtotal (direct costs)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.subtotal)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: C.muted }}>
                              <span>Prelims / Supervision ({q.prelims_pct}%)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.prelims_cost)}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", fontSize: 13, color: C.muted }}>
                              <span>FBS Margin ({q.margin_pct}%)</span>
                              <span style={{ fontFamily: "'DM Mono'" }}>{fmt(q.margin_cost)}</span>
                            </div>
                          </>
                        );
                      }
                    })()}

                    <div style={{ display: "flex", justifyContent: "space-between",
                      padding: "10px 10px", background: "#F59E0B18",
                      borderRadius: 6, marginTop: 8, border: "1px solid #F59E0B33" }}>
                      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 18, letterSpacing: "0.06em", color: C.amber }}>
                        TOTAL (EX VAT)
                      </span>
                      <span style={{ fontFamily: "'Bebas Neue'", fontSize: 22, color: C.amber }}>
                        {fmt(quoteData.total)}
                      </span>
                    </div>

                    {(quoteData.cis_cost ?? 0) > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between",
                        padding: "8px 10px", marginTop: 8,
                        background: `${C.subtle}22`, borderRadius: 5, border: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: "'DM Mono'" }}>
                          CIS withheld from subbies ({quoteData.cis_pct}%)
                        </span>
                        <span style={{ fontSize: 12, color: C.muted, fontFamily: "'DM Mono'" }}>
                          -{fmt(quoteData.cis_cost)}
                        </span>
                      </div>
                    )}

                    {quoteData.ps_subtotal > 0 && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: "#F59E0B0A",
                        border: `1px solid ${C.amber}33`, borderRadius: 5, fontSize: 11,
                        color: C.amber, fontFamily: "'DM Mono'" }}>
                        ⚠ Includes {fmt(quoteData.ps_subtotal)} provisional sums — subject to site verification
                      </div>
                    )}

                    <div style={{ marginTop: 8, fontSize: 11, color: C.muted, fontFamily: "'DM Mono'", padding: "0 10px" }}>
                      {quoteData.vat_note}
                    </div>
                  </div>
                </div>
              )}

              {stage === "idle" && !quoteData && !error && (
                <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted, fontSize: 13 }}>
                  Upload photos or videos on the Media tab, then click Run Scope + Price
                </div>
              )}
            </div>
          )}

          {/* ── TAB: HISTORY ───────────────────────────────────────────────── */}
          {tab === "history" && (
            <div style={{ animation: "slideIn 0.2s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontFamily: "'Bebas Neue'", fontSize: 16, letterSpacing: "0.08em", color: C.amber }}>
                  Quote History
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'" }}>
                  {history.length} saved quote{history.length !== 1 ? "s" : ""}
                </div>
              </div>

              {history.length === 0 && (
                <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted, fontSize: 13 }}>
                  No saved quotes yet. Run a quote and click SAVE in the Quote Output tab.
                </div>
              )}

              {history.map(entry => (
                <div key={entry.id}>
                  <div className="hist-card"
                    style={{ border: `1px solid ${pendingDeleteId === entry.id ? C.red + "66" : C.border}`,
                      borderRadius: 6, padding: "12px 16px",
                      marginBottom: 6, background: C.bg, transition: "background 0.15s, border-color 0.15s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "'DM Mono'", fontSize: 13, color: C.amber, fontWeight: 500 }}>
                            {entry.jobRef}
                          </span>
                          {entry.complexity && (
                            <span style={{ fontSize: 10, color: C.subtle, fontFamily: "'DM Mono'" }}>
                              {entry.complexity}
                            </span>
                          )}
                          <span style={{ fontSize: 11, color: C.muted, fontFamily: "'DM Mono'" }}>
                            {new Date(entry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span style={{ fontSize: 13, fontFamily: "'DM Mono'", color: C.text }}>
                            {fmt(entry.total)}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.scopeSummary}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => setExpandedHistoryId(expandedHistoryId === entry.id ? null : entry.id)}
                          style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                            borderRadius: 4, padding: "4px 12px", color: C.muted, fontSize: 11,
                            fontFamily: "'DM Mono'", cursor: "pointer", letterSpacing: "0.04em" }}>
                          {expandedHistoryId === entry.id ? "CLOSE" : "VIEW"}
                        </button>
                        {pendingDeleteId === entry.id ? (
                          <>
                            <button onClick={() => deleteHistoryEntry(entry.id)}
                              style={{ background: C.red, border: "none",
                                borderRadius: 4, padding: "4px 12px", color: "#fff", fontSize: 11,
                                fontFamily: "'DM Mono'", cursor: "pointer", letterSpacing: "0.04em" }}>
                              DELETE
                            </button>
                            <button onClick={() => setPendingDeleteId(null)}
                              style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                                borderRadius: 4, padding: "4px 10px", color: C.muted, fontSize: 11,
                                fontFamily: "'DM Mono'", cursor: "pointer" }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setPendingDeleteId(entry.id)}
                            style={{ background: "transparent", border: `1px solid ${C.border}`,
                              borderRadius: 4, padding: "4px 10px", color: C.muted, fontSize: 13,
                              cursor: "pointer" }}>×</button>
                        )}
                      </div>
                    </div>

                    {/* Inline delete confirmation */}
                    {pendingDeleteId === entry.id && (
                      <div style={{ marginTop: 10, padding: "8px 12px", background: "#EF444411",
                        border: `1px solid ${C.red}33`, borderRadius: 5,
                        fontSize: 12, color: C.red, fontFamily: "'DM Mono'" }}>
                        Delete {entry.jobRef}? This cannot be undone.
                      </div>
                    )}
                  </div>

                  {expandedHistoryId === entry.id && (
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 16,
                      marginBottom: 8, background: "#0F1117", animation: "slideIn 0.2s ease" }}>
                      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
                        {entry.scopeSummary}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 10 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid #F59E0B33` }}>
                            {["Trade", "Description", "Qty", "Unit", "Rate", "Cost"].map(h => (
                              <th key={h} style={{ padding: "6px 8px",
                                textAlign: ["Cost", "Rate", "Qty"].includes(h) ? "right" : "left",
                                color: C.muted, fontFamily: "'DM Mono'", fontSize: 9,
                                textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 400 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {entry.quoteData.line_items.map((l, i) => {
                            const isPS      = l.confidence === "low";
                            const totalRate = (l.labour_rate || 0) + (l.materials_rate || 0) || l.rate || 0;
                            return (
                              <tr key={i} style={{ borderBottom: `1px solid ${C.border}44`,
                                background: isPS ? "#F59E0B08" : undefined }}>
                                <td style={{ padding: "6px 8px", fontWeight: 500 }}>
                                  {l.trade}
                                  {isPS && <span style={{ marginLeft: 5, fontSize: 9, fontFamily: "'DM Mono'",
                                    color: C.amber, border: `1px solid ${C.amber}55`, borderRadius: 3,
                                    padding: "1px 4px" }}>PS</span>}
                                </td>
                                <td style={{ padding: "6px 8px", color: C.muted }}>{l.description}</td>
                                <td style={{ padding: "6px 8px", fontFamily: "'DM Mono'", textAlign: "right" }}>{l.quantity}</td>
                                <td style={{ padding: "6px 8px", color: C.muted, fontFamily: "'DM Mono'", fontSize: 10 }}>{l.unit}</td>
                                <td style={{ padding: "6px 8px", color: C.muted, fontFamily: "'DM Mono'", textAlign: "right" }}>£{totalRate}</td>
                                <td style={{ padding: "6px 8px", fontFamily: "'DM Mono'", textAlign: "right" }}>{fmt(l.cost)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                        {(() => {
                          const q = entry.quoteData;
                          const isNew = q.labour_subtotal !== undefined;
                          if (isNew) {
                            return (
                              <>
                                {[
                                  { label: "Labour", val: q.labour_subtotal },
                                  { label: "Materials", val: q.materials_subtotal },
                                  { label: "Direct Costs", val: q.subtotal },
                                  { label: `Site Prelims (${q.site_prelims_pct}%)`, val: q.site_prelims_cost },
                                  { label: `Company Overhead (${q.overhead_pct}%)`, val: q.overhead_cost },
                                  { label: `Net Profit (${q.profit_pct}%)`, val: q.profit_cost },
                                ].map((row, i) => (
                                  <div key={i} style={{ display: "flex", justifyContent: "space-between",
                                    padding: "3px 8px", fontSize: 12, color: C.muted }}>
                                    <span>{row.label}</span>
                                    <span style={{ fontFamily: "'DM Mono'" }}>{fmt(row.val)}</span>
                                  </div>
                                ))}
                              </>
                            );
                          } else {
                            return (
                              <>
                                {[
                                  { label: "Subtotal", val: q.subtotal },
                                  { label: `Prelims (${q.prelims_pct}%)`, val: q.prelims_cost },
                                  { label: `FBS Margin (${q.margin_pct}%)`, val: q.margin_cost },
                                ].map((row, i) => (
                                  <div key={i} style={{ display: "flex", justifyContent: "space-between",
                                    padding: "3px 8px", fontSize: 12, color: C.muted }}>
                                    <span>{row.label}</span>
                                    <span style={{ fontFamily: "'DM Mono'" }}>{fmt(row.val)}</span>
                                  </div>
                                ))}
                              </>
                            );
                          }
                        })()}
                        <div style={{ display: "flex", justifyContent: "space-between",
                          padding: "8px", background: "#F59E0B18", borderRadius: 5,
                          marginTop: 4, border: "1px solid #F59E0B33" }}>
                          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 15, color: C.amber }}>TOTAL (EX VAT)</span>
                          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 17, color: C.amber }}>{fmt(entry.quoteData.total)}</span>
                        </div>
                        {(entry.quoteData.cis_cost ?? 0) > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between",
                            padding: "6px 8px", marginTop: 6, fontSize: 11, color: C.muted, fontFamily: "'DM Mono'" }}>
                            <span>CIS withheld from subbies ({entry.quoteData.cis_pct}%)</span>
                            <span>-{fmt(entry.quoteData.cis_cost)}</span>
                          </div>
                        )}
                        {entry.quoteData.ps_subtotal > 0 && (
                          <div style={{ marginTop: 6, padding: "6px 8px", background: "#F59E0B0A",
                            border: `1px solid ${C.amber}33`, borderRadius: 4, fontSize: 10,
                            color: C.amber, fontFamily: "'DM Mono'" }}>
                            ⚠ Includes {fmt(entry.quoteData.ps_subtotal)} provisional sums
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button onClick={() => loadHistoryEntry(entry)}
                          style={{ background: C.amber, border: "none",
                            borderRadius: 5, padding: "7px 16px", color: "#000",
                            fontFamily: "'DM Mono'", fontSize: 11, cursor: "pointer",
                            letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          Load into Editor
                        </button>
                        <button onClick={() => loadHistoryEntry(entry, true)}
                          style={{ background: "transparent", border: `1px solid ${C.subtle}`,
                            borderRadius: 5, padding: "7px 14px", color: C.muted,
                            fontFamily: "'DM Mono'", fontSize: 11, cursor: "pointer",
                            letterSpacing: "0.06em" }}>
                          ✏ Refine
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── Company Footer ── */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 32,
        padding: "20px 24px 16px", textAlign: "center", color: C.muted,
        fontSize: 11, fontFamily: "'DM Mono'", letterSpacing: "0.02em" }}>
        <div style={{ color: C.amber, fontWeight: 600, letterSpacing: "0.15em",
          fontSize: 10, marginBottom: 6 }}>CONFIDENTIAL</div>
        <div style={{ marginBottom: 6 }}>
          Fallow Business Group Ltd trading as Fallow Building Services &nbsp;·&nbsp; Company No: 16532814
        </div>
        <div style={{ display: "flex", gap: 20, justifyContent: "center" }}>
          <a href="https://fallowbuildingservices.co.uk/terms-conditions" target="_blank"
            rel="noreferrer" style={{ color: C.muted, textDecoration: "underline" }}>
            Terms &amp; Conditions
          </a>
          <a href="https://fallowbuildingservices.co.uk/privacy-policy" target="_blank"
            rel="noreferrer" style={{ color: C.muted, textDecoration: "underline" }}>
            Privacy Policy
          </a>
        </div>
      </div>

    </div>
  );
}
