import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "fbs:materials-library";

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLibrary(items) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  );
}

function Badge({ children, colour = "gray" }) {
  const colours = {
    green: "bg-green-900 text-green-300",
    amber: "bg-yellow-900 text-yellow-300",
    red: "bg-red-900 text-red-300",
    gray: "bg-gray-700 text-gray-300",
    blue: "bg-blue-900 text-blue-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colours[colour] || colours.gray}`}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MaterialCard — one editable row after voice parse
// ─────────────────────────────────────────────────────────────────────────────
function MaterialCard({ item, onChange, onAddToLibrary, inLibrary }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <input
            className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white font-medium"
            value={item.material_name}
            onChange={e => onChange({ ...item, material_name: e.target.value })}
          />
          <input
            className="mt-1 w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300"
            placeholder="Spec (e.g. 600×600mm, matt, R10)"
            value={item.spec}
            onChange={e => onChange({ ...item, spec: e.target.value })}
          />
        </div>
        <Badge colour={item.confidence === "high" ? "green" : item.confidence === "low" ? "red" : "amber"}>
          {item.confidence}
        </Badge>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-gray-400 w-16 shrink-0">Qty</span>
        <input
          type="number"
          min="0"
          step="0.01"
          className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          value={item.quantity_gross ?? ""}
          placeholder="?"
          onChange={e => onChange({ ...item, quantity_gross: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <input
          className="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          placeholder="unit"
          value={item.unit}
          onChange={e => onChange({ ...item, unit: e.target.value })}
        />
        <span className="text-xs text-gray-500 truncate">{item.trade}</span>
      </div>

      {item.notes && (
        <p className="text-xs text-gray-500 italic">{item.notes}</p>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => onAddToLibrary(item)}
          className={`text-xs px-3 py-1 rounded transition-colors ${
            inLibrary
              ? "bg-green-800 text-green-300 cursor-default"
              : "bg-gray-700 hover:bg-gray-600 text-gray-300"
          }`}
          disabled={inLibrary}
        >
          {inLibrary ? "✓ In library" : "+ Save to library"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LibraryPane — browse / insert saved materials
// ─────────────────────────────────────────────────────────────────────────────
function LibraryPane({ onInsert }) {
  const [items, setItems] = useState(loadLibrary);
  const [search, setSearch] = useState("");

  const filtered = items.filter(i =>
    i.material_name.toLowerCase().includes(search.toLowerCase()) ||
    i.trade.toLowerCase().includes(search.toLowerCase())
  );

  const remove = id => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    saveLibrary(updated);
  };

  return (
    <div className="space-y-3">
      <input
        className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white"
        placeholder="Search library…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {filtered.length === 0 && (
        <p className="text-sm text-gray-500">No saved items yet. Source some materials and save them here.</p>
      )}
      {filtered.map(item => (
        <div key={item.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate">{item.material_name}</p>
            <p className="text-xs text-gray-400">{item.trade} · {item.unit}</p>
            {item.last_unit_price && (
              <p className="text-xs text-green-400">Last price: £{item.last_unit_price.toFixed(2)} · {item.last_supplier}</p>
            )}
            {item.last_product_url && (
              <a href={item.last_product_url} target="_blank" rel="noreferrer"
                 className="text-xs text-blue-400 hover:underline truncate block">
                {item.last_product_url.replace(/^https?:\/\//, "").slice(0, 60)}
              </a>
            )}
            <p className="text-xs text-gray-500 mt-0.5">Used {item.use_count}× · last {new Date(item.last_used).toLocaleDateString("en-GB")}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={() => onInsert(item)}
              className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              Insert
            </button>
            <button
              onClick={() => remove(item.id)}
              className="text-xs px-3 py-1 bg-gray-700 hover:bg-red-800 text-gray-300 rounded transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SourcedResultCard — shows one priced material after Perplexity sourcing
// ─────────────────────────────────────────────────────────────────────────────
function SourcedResultCard({ item, onSaveToLibrary }) {
  const [selectedIdx, setSelectedIdx] = useState(item.recommended_option_index ?? 0);
  const opts = item.options || [];
  const selected = opts[selectedIdx];

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-white font-medium">{item.material_name}</p>
          <p className="text-xs text-gray-400">{item.trade} · {item.quantity_gross} {item.unit}</p>
        </div>
        <Badge colour={item.price_confidence === "high" ? "green" : item.price_confidence === "low" ? "red" : "amber"}>
          {item.price_confidence || "medium"}
        </Badge>
      </div>

      {opts.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {opts.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                i === selectedIdx ? "bg-green-700 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {opt.supplier}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-gray-750 rounded p-3 space-y-1 border border-gray-600">
          <p className="text-sm text-green-300 font-semibold">£{(selected.total_cost || 0).toFixed(2)}</p>
          <p className="text-xs text-gray-300">{selected.product_name}</p>
          <p className="text-xs text-gray-400">
            {selected.packs_required} × {selected.unit_description} @ £{(selected.unit_price || 0).toFixed(2)}
          </p>
          {selected.product_url && (
            <a href={selected.product_url} target="_blank" rel="noreferrer"
               className="text-xs text-blue-400 hover:underline block truncate">
              {selected.product_url.replace(/^https?:\/\//, "").slice(0, 70)}
            </a>
          )}
          {selected.in_stock === false && <Badge colour="red">Out of stock</Badge>}
          {selected.notes && <p className="text-xs text-gray-500 italic">{selected.notes}</p>}
        </div>
      )}

      {selected && (
        <div className="flex justify-end">
          <button
            onClick={() =>
              onSaveToLibrary({
                ...item,
                last_unit_price: selected.unit_price,
                last_supplier: selected.supplier,
                last_product_url: selected.product_url,
              })
            }
            className="text-xs px-3 py-1 bg-gray-700 hover:bg-green-800 text-gray-300 rounded transition-colors"
          >
            Save to library
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function MaterialsVoice({ apiBase = "", secret = "", onClose }) {
  // Recording
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  // Pipeline state
  const [pipelineStage, setPipelineStage] = useState("idle"); // idle | transcribing | parsing | sourcing | complete | error
  const [transcript, setTranscript] = useState("");
  const [materials, setMaterials] = useState([]);
  const [sourcedItems, setSourcedItems] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [budget, setBudget] = useState("standard");
  const [error, setError] = useState("");
  const [parseNotes, setParseNotes] = useState("");

  // Library
  const [libraryPane, setLibraryPane] = useState(false);
  const [library, setLibrary] = useState(loadLibrary);

  // Tab: "voice" | "transcript" | "results" | "library"
  const [activeTab, setActiveTab] = useState("voice");

  const headers = {
    "Content-Type": "application/json",
    ...(secret ? { "x-fbs-secret": secret } : {}),
  };

  // ── Recording ──────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    setError("");
    setAudioBlob(null);
    setAudioUrl(null);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch (e) {
      setError("Microphone access denied: " + e.message);
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRef.current?.stop();
    setRecording(false);
  }, []);

  // Convert webm blob to wav-like base64 (Groq accepts webm too)
  const blobToBase64 = blob =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  // ── Step 1: Transcribe + Parse ─────────────────────────────────────────────
  const runVoicePipeline = useCallback(async (overrideTranscript) => {
    setError("");
    setPipelineStage("transcribing");
    setActiveTab("transcript");

    try {
      let finalTranscript = overrideTranscript || transcript;

      if (!overrideTranscript && audioBlob) {
        // Send audio for transcription + parse in one call to /api/materials-voice
        setPipelineStage("transcribing");
        const audioB64 = await blobToBase64(audioBlob);
        const res = await fetch(`${apiBase}/api/materials-voice`, {
          method: "POST",
          headers,
          body: JSON.stringify({ audio: audioB64 }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `API error ${res.status}`);
        }
        const data = await res.json();
        setTranscript(data.transcript || "");
        setMaterials(data.materials || []);
        setParseNotes(data.parse_notes || "");
        setPipelineStage("identified");
        setActiveTab("transcript");
        return;
      }

      // Transcript-only path
      if (finalTranscript.trim()) {
        setPipelineStage("parsing");
        const res = await fetch(`${apiBase}/api/materials-voice`, {
          method: "POST",
          headers,
          body: JSON.stringify({ transcript: finalTranscript }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `API error ${res.status}`);
        }
        const data = await res.json();
        setMaterials(data.materials || []);
        setParseNotes(data.parse_notes || "");
        setPipelineStage("identified");
        setActiveTab("transcript");
      } else {
        throw new Error("No audio or transcript to process");
      }
    } catch (e) {
      setError(e.message);
      setPipelineStage("error");
    }
  }, [audioBlob, transcript, apiBase, headers]);

  // ── Step 2: Source Prices ──────────────────────────────────────────────────
  const runSource = useCallback(async () => {
    if (!materials.length) return;
    setError("");
    setPipelineStage("sourcing");
    setActiveTab("results");

    try {
      const res = await fetch(`${apiBase}/api/materials-source`, {
        method: "POST",
        headers,
        body: JSON.stringify({ materials, budget }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error ${res.status}`);
      }
      const data = await res.json();
      setSourcedItems(data.sourced || []);
      setGrandTotal(data.grand_total || 0);
      setPipelineStage("complete");
    } catch (e) {
      setError(e.message);
      setPipelineStage("error");
    }
  }, [materials, budget, apiBase, headers]);

  // ── Library helpers ────────────────────────────────────────────────────────
  const addToLibrary = useCallback(item => {
    setLibrary(prev => {
      const existing = prev.find(l => l.material_name.toLowerCase() === item.material_name.toLowerCase());
      let updated;
      if (existing) {
        updated = prev.map(l =>
          l.id === existing.id
            ? { ...existing, use_count: (existing.use_count || 1) + 1, last_used: new Date().toISOString(),
                last_unit_price: item.last_unit_price ?? existing.last_unit_price,
                last_supplier: item.last_supplier ?? existing.last_supplier,
                last_product_url: item.last_product_url ?? existing.last_product_url }
            : l
        );
      } else {
        const newItem = {
          id: `lib_${Date.now()}`,
          trade: item.trade || "General",
          material_name: item.material_name,
          spec: item.spec || "",
          unit: item.unit || "item",
          preferred_suppliers: item.preferred_suppliers || [],
          search_query: item.search_query || item.material_name,
          last_unit_price: item.last_unit_price ?? null,
          last_supplier: item.last_supplier || "",
          last_product_url: item.last_product_url || "",
          use_count: 1,
          last_used: new Date().toISOString(),
          notes: item.notes || "",
        };
        updated = [newItem, ...prev];
      }
      saveLibrary(updated);
      return updated;
    });
  }, []);

  const insertFromLibrary = useCallback(item => {
    setMaterials(prev => {
      const mat = {
        id: `mat_${Date.now()}`,
        trade: item.trade,
        material_name: item.material_name,
        spec: item.spec,
        quantity_gross: null,
        unit: item.unit,
        search_query: item.search_query,
        preferred_suppliers: item.preferred_suppliers,
        confidence: "high",
        notes: "Inserted from library",
      };
      return [...prev, mat];
    });
    setActiveTab("transcript");
  }, []);

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    if (!sourcedItems.length) return;
    const rows = [
      ["Material", "Trade", "Qty", "Unit", "Spec", "Supplier", "Product", "Unit Price (£)", "Total (£)", "URL", "Stock", "Confidence"].join(","),
      ...sourcedItems.map(item => {
        const opt = item.options?.[item.recommended_option_index ?? 0] || {};
        return [
          `"${item.material_name}"`,
          `"${item.trade}"`,
          item.quantity_gross,
          item.unit,
          `"${item.spec || ""}"`,
          `"${opt.supplier || ""}"`,
          `"${opt.product_name || ""}"`,
          (opt.unit_price || 0).toFixed(2),
          (opt.total_cost || 0).toFixed(2),
          `"${opt.product_url || ""}"`,
          opt.in_stock === false ? "Out of stock" : "In stock",
          item.price_confidence || "medium",
        ].join(",");
      }),
      "",
      `,,,,,,,"TOTAL (ex VAT)",${grandTotal.toFixed(2)}`,
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `FBS_VoiceMaterials_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }, [sourcedItems, grandTotal]);

  // ── Upload audio file ──────────────────────────────────────────────────────
  const handleFileUpload = useCallback(e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
  }, []);

  const isLoading = ["transcribing", "parsing", "sourcing"].includes(pipelineStage);
  const libIds = new Set(library.map(l => l.material_name.toLowerCase()));

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Voice Materials List</h2>
            <p className="text-xs text-gray-400">Record or type a materials list, then source live UK prices</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b border-gray-800 shrink-0">
          {[
            { id: "voice", label: "🎙 Record" },
            { id: "transcript", label: "📋 Materials" + (materials.length ? ` (${materials.length})` : "") },
            { id: "results", label: "💷 Prices" + (sourcedItems.length ? ` (${sourcedItems.length})` : "") },
            { id: "library", label: `📚 Library (${library.length})` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-sm rounded-t transition-colors ${
                activeTab === t.id
                  ? "bg-gray-800 text-white border-b-2 border-green-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── VOICE TAB ─────────────────────────────────────────────────── */}
          {activeTab === "voice" && (
            <div className="space-y-5">
              <div className="bg-gray-800 rounded-xl p-5 text-center space-y-4">
                {!recording ? (
                  <button
                    onClick={startRecording}
                    disabled={isLoading}
                    className="w-24 h-24 rounded-full bg-red-600 hover:bg-red-500 text-white text-3xl flex items-center justify-center mx-auto transition-transform hover:scale-105 disabled:opacity-40"
                    title="Start recording"
                  >
                    🎙
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="w-24 h-24 rounded-full bg-red-800 hover:bg-red-700 text-white text-3xl flex items-center justify-center mx-auto animate-pulse"
                    title="Stop recording"
                  >
                    ⏹
                  </button>
                )}
                <p className="text-sm text-gray-400">
                  {recording ? "Recording… tap to stop" : "Tap to record your materials list"}
                </p>

                {audioUrl && (
                  <div className="mt-2 space-y-2">
                    <audio controls src={audioUrl} className="w-full" />
                    <button
                      onClick={() => runVoicePipeline()}
                      disabled={isLoading}
                      className="w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                    >
                      {isLoading ? "Processing…" : "Transcribe and parse →"}
                    </button>
                  </div>
                )}
              </div>

              <div className="text-center text-xs text-gray-500">— or upload an audio file —</div>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600"
              />

              <div className="text-center text-xs text-gray-500">— or paste / type a list —</div>
              <textarea
                className="w-full h-32 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white resize-none"
                placeholder="e.g. 20 metres of 2.5mm twin and earth cable, 2 boxes of 10-amp sockets, a tube of grab adhesive…"
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
              />
              {transcript.trim() && (
                <button
                  onClick={() => runVoicePipeline(transcript)}
                  disabled={isLoading}
                  className="w-full py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                >
                  {isLoading ? "Processing…" : "Parse materials list →"}
                </button>
              )}

              {isLoading && (
                <Spinner label={
                  pipelineStage === "transcribing" ? "Transcribing audio…"
                  : pipelineStage === "parsing" ? "Parsing materials…"
                  : "Sourcing prices…"
                } />
              )}
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          )}

          {/* ── TRANSCRIPT / MATERIALS TAB ────────────────────────────────── */}
          {activeTab === "transcript" && (
            <div className="space-y-4">
              {transcript && (
                <div className="bg-gray-800 rounded-lg p-3">
                  <p className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Transcript</p>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{transcript}</p>
                </div>
              )}

              {parseNotes && (
                <p className="text-xs text-amber-400 italic">{parseNotes}</p>
              )}

              {materials.length === 0 && !isLoading && (
                <p className="text-sm text-gray-500 text-center py-8">
                  No materials yet. Record a voice note or paste a list on the Record tab.
                </p>
              )}

              {materials.map((item, idx) => (
                <MaterialCard
                  key={item.id}
                  item={item}
                  onChange={updated => setMaterials(prev => prev.map((m, i) => i === idx ? updated : m))}
                  onAddToLibrary={addToLibrary}
                  inLibrary={libIds.has(item.material_name.toLowerCase())}
                />
              ))}

              {materials.length > 0 && (
                <div className="pt-2 space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-400 shrink-0">Budget level</label>
                    <select
                      value={budget}
                      onChange={e => setBudget(e.target.value)}
                      className="bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-white"
                    >
                      <option value="standard">Standard (Screwfix / Toolstation)</option>
                      <option value="mid">Mid (B&Q / Topps Tiles)</option>
                      <option value="premium">Premium (Fired Earth / Duravit)</option>
                    </select>
                  </div>
                  <button
                    onClick={runSource}
                    disabled={isLoading}
                    className="w-full py-2.5 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors"
                  >
                    {isLoading && pipelineStage === "sourcing" ? "Sourcing prices…" : `Source prices for ${materials.length} items →`}
                  </button>
                  {isLoading && pipelineStage === "sourcing" && <Spinner label="Searching UK suppliers…" />}
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          )}

          {/* ── RESULTS TAB ───────────────────────────────────────────────── */}
          {activeTab === "results" && (
            <div className="space-y-4">
              {pipelineStage === "sourcing" && <Spinner label="Sourcing prices from UK suppliers…" />}

              {sourcedItems.length === 0 && pipelineStage !== "sourcing" && (
                <p className="text-sm text-gray-500 text-center py-8">
                  No results yet. Parse a materials list and tap Source prices.
                </p>
              )}

              {sourcedItems.map(item => (
                <SourcedResultCard
                  key={item.id}
                  item={item}
                  onSaveToLibrary={addToLibrary}
                />
              ))}

              {sourcedItems.length > 0 && (
                <div className="bg-gray-800 border border-green-700 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">Total material cost (ex VAT)</p>
                    <p className="text-2xl font-bold text-green-400">£{grandTotal.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={exportCSV}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors"
                  >
                    Export CSV
                  </button>
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>
          )}

          {/* ── LIBRARY TAB ───────────────────────────────────────────────── */}
          {activeTab === "library" && (
            <LibraryPane onInsert={insertFromLibrary} />
          )}

        </div>
      </div>
    </div>
  );
}
