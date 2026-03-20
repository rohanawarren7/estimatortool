// MaterialsSourcing.jsx — Materials Cost Sourcing modal
// Two-stage pipeline: Gemini 2.5 Pro identifies materials → Perplexity sources UK prices
//
// NEW in this version:
//  - Project Store: after identify/source completes, analysis is auto-saved to Vercel KV
//  - Load Previous: if a saved analysis exists for this jobRef, a banner offers to reload it
//  - syncKey prop added (passed from FBSQuoteScoper) for per-user KV storage
//  - Chunked identify is handled server-side (materials-identify.js now auto-chunks > 12 items)
//  - chunks_processed shown in identified header for transparency

import React, { useState, useCallback, useEffect } from "react";

const C = {
  bg: "#0A0D14", card: "#0F1117", inner: "#161B27",
  border: "#1E2535", subtle: "#374151", muted: "#6B7280",
  text: "#E5E7EB", dim: "#9CA3AF", green: "#10B981",
  amber: "#F59E0B", red: "#EF4444", emerald: "#059669",
  blue: "#3B82F6", purple: "#8B5CF6", teal: "#14B8A6",
};

const BUDGET_OPTIONS = [
  { value: "standard", label: "Standard (Trade)",  desc: "Screwfix / Toolstation / Jewson" },
  { value: "mid",      label: "Mid-market",         desc: "B&Q / Topps Tiles / Karndean"  },
  { value: "premium",  label: "Premium",             desc: "Fired Earth / Hansgrohe / Duravit" },
];

function fmtGBP(v) {
  return `£${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: 10, padding: "2px 7px", borderRadius: 10,
      background: color + "22", color, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{children}</span>
  );
}

function Spinner({ label }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 0" }}>
      <div style={{
        width: 36, height: 36, border: `3px solid ${C.border}`,
        borderTopColor: C.blue, borderRadius: "50%",
        animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
      }} />
      <p style={{ color: C.dim, fontSize: 13, margin: 0 }}>{label}</p>
    </div>
  );
}

// ── Material identify card ────────────────────────────────────────────────────
function IdentifyCard({ material, index, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(material);

  function save() { onEdit(index, local); setEditing(false); }
  function cancel() { setLocal(material); setEditing(false); }

  const inp = (field, placeholder) => (
    <input
      value={local[field] || ""}
      placeholder={placeholder}
      onChange={e => setLocal(m => ({ ...m, [field]: e.target.value }))}
      style={{
        width: "100%", background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 4, padding: "5px 8px", color: C.text, fontSize: 12,
        outline: "none", boxSizing: "border-box", marginBottom: 5,
      }}
    />
  );

  return (
    <div style={{
      background: C.inner, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "10px 12px", marginBottom: 6,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {local.trade}
            </span>
            <Badge color={local.confidence === "high" ? C.green : C.amber}>
              {local.confidence}
            </Badge>
          </div>
          {editing ? (
            <>
              {inp("material_name", "Material name")}
              {inp("spec", "Specification (dimensions, grade, finish)")}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="number"
                  value={local.quantity_gross}
                  onChange={e => setLocal(m => ({ ...m, quantity_gross: parseFloat(e.target.value) || 0 }))}
                  style={{
                    width: 80, background: C.bg, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: "5px 8px", color: C.text, fontSize: 12,
                    outline: "none", marginBottom: 5,
                  }}
                />
                {inp("unit", "Unit")}
              </div>
              {inp("search_query", "Search query for sourcing")}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button onClick={save} style={{
                  padding: "4px 12px", background: C.blue, color: "#fff",
                  border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12,
                }}>Save</button>
                <button onClick={cancel} style={{
                  padding: "4px 12px", background: C.subtle, color: C.text,
                  border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12,
                }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: "0 0 2px", color: C.text, fontSize: 13, fontWeight: 500 }}>
                {local.material_name}
              </p>
              {local.spec && (
                <p style={{ margin: "0 0 2px", color: C.muted, fontSize: 11 }}>{local.spec}</p>
              )}
              <p style={{ margin: 0, color: C.dim, fontSize: 11 }}>
                Qty: <strong style={{ color: C.text }}>{local.quantity_gross} {local.unit}</strong>
                {local.quantity_net ? ` · net ${local.quantity_net}` : ""}
                {local.waste_factor ? ` · waste ×${local.waste_factor}` : ""}
              </p>
              {local.notes && (
                <p style={{
                  margin: "5px 0 0", padding: "4px 8px",
                  background: C.amber + "15", borderRadius: 4,
                  color: C.amber, fontSize: 11,
                }}>⚠ {local.notes}</p>
              )}
            </>
          )}
        </div>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{
            background: "none", border: "none", color: C.muted,
            cursor: "pointer", fontSize: 11, flexShrink: 0, padding: "2px 0",
          }}>Edit</button>
        )}
      </div>
    </div>
  );
}

// ── Sourced item card ─────────────────────────────────────────────────────────
function SourcedCard({ item }) {
  const [sel, setSel] = useState(item.recommended_option_index || 0);
  const options = item.options || [];
  const opt = options[sel] || options[0];
  if (!opt) return null;

  return (
    <div style={{
      background: C.inner, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: "10px 12px", marginBottom: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {item.trade}
          </span>
          <p style={{ margin: "2px 0", color: C.text, fontSize: 13, fontWeight: 500 }}>
            {item.material_name}
          </p>
          {item.spec && (
            <p style={{ margin: 0, color: C.muted, fontSize: 11 }}>{item.spec}</p>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ margin: 0, color: C.text, fontWeight: 700, fontSize: 14 }}>
            {fmtGBP(opt.total_cost)}
          </p>
          <p style={{ margin: 0, color: C.muted, fontSize: 11 }}>
            {item.quantity_gross} {item.unit}
          </p>
          {item.price_confidence === "low" && (
            <Badge color={C.amber}>estimated</Badge>
          )}
        </div>
      </div>

      {/* Supplier option buttons */}
      {options.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
          {options.map((o, i) => (
            <button key={i} onClick={() => setSel(i)} style={{
              padding: "2px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
              border: `1px solid ${i === sel ? C.blue : C.border}`,
              background: i === sel ? C.blue + "33" : "transparent",
              color: i === sel ? C.blue : C.muted,
            }}>{o.supplier}</button>
          ))}
        </div>
      )}

      {/* Selected option detail */}
      <div style={{
        background: C.bg, borderRadius: 5, padding: "8px 10px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {opt.product_url && opt.product_url.startsWith("http") ? (
            <a href={opt.product_url} target="_blank" rel="noopener noreferrer"
               style={{ color: C.blue, fontSize: 12, textDecoration: "none", fontWeight: 500 }}>
              {opt.product_name || opt.supplier} ↗
            </a>
          ) : (
            <span style={{ color: C.text, fontSize: 12, fontWeight: 500 }}>
              {opt.product_name || opt.supplier}
            </span>
          )}
          <p style={{ margin: "3px 0 0", color: C.dim, fontSize: 11 }}>
            {opt.unit_price ? fmtGBP(opt.unit_price) : ""}
            {opt.unit_description ? ` ${opt.unit_description}` : ""}
            {opt.pack_coverage ? ` · ${opt.pack_coverage} ${opt.pack_coverage_unit || "per pack"}` : ""}
            {opt.packs_required ? ` · ${opt.packs_required} packs` : ""}
          </p>
          {opt.in_stock === true && (
            <span style={{ color: C.green, fontSize: 11 }}>✓ In stock</span>
          )}
          {opt.notes && (
            <p style={{ margin: "3px 0 0", color: C.amber, fontSize: 11 }}>⚠ {opt.notes}</p>
          )}
        </div>
        <span style={{ color: C.text, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
          {fmtGBP(opt.total_cost)}
        </span>
      </div>
    </div>
  );
}

// ── Saved project banner ──────────────────────────────────────────────────────
function SavedBanner({ project, onLoad, onDismiss }) {
  return (
    <div style={{
      background: C.teal + "18", border: `1px solid ${C.teal}44`,
      borderRadius: 8, padding: "12px 16px", marginBottom: 16,
      display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
    }}>
      <div>
        <p style={{ margin: "0 0 2px", fontSize: 12, fontWeight: 600, color: C.teal }}>
          💾 Saved analysis found for {project.jobRef}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: C.muted }}>
          {project.materialCount} materials identified
          {project.sourcedCount ? `, ${project.sourcedCount} sourced` : ""}
          {project.imageCount ? ` · ${project.imageCount} images` : ""}
          {" · "}saved {fmtDate(project.savedAt)}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button onClick={onLoad} style={{
          padding: "5px 14px", background: C.teal, color: "#fff",
          border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12, fontWeight: 600,
        }}>Load</button>
        <button onClick={onDismiss} style={{
          padding: "5px 10px", background: "none", color: C.muted,
          border: `1px solid ${C.border}`, borderRadius: 5, cursor: "pointer", fontSize: 12,
        }}>Ignore</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MaterialsSourcing({
  scopeItems = [],
  description = "",
  images = [],
  jobRef = "",
  jobDescription = "",
  apiBase = "",
  secret = "",
  syncKey = "",
  onClose,
  initialMaterials = null, // pre-loaded from pipeline — skips identify step
}) {
  const [stage, setStage] = useState(initialMaterials ? "identified" : "idle");
  const [budget, setBudget] = useState("standard");
  const [identified, setIdentified] = useState(initialMaterials);
  const [sourced, setSourced] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [editedMaterials, setEditedMaterials] = useState(initialMaterials?.materials || []);
  const [savedProject, setSavedProject] = useState(null);   // summary from KV index
  const [savedBannerDismissed, setSavedBannerDismissed] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");     // idle | saving | saved | error

  const headers = {
    "Content-Type": "application/json",
    ...(secret ? { "x-fbs-secret": secret } : {}),
  };

  // ── Check if a saved analysis exists for this jobRef ───────────────────────
  useEffect(() => {
    if (!syncKey || !jobRef || !apiBase) return;
    fetch(`${apiBase}/api/project-store/list?syncKey=${encodeURIComponent(syncKey)}`, {
      headers: secret ? { "x-fbs-secret": secret } : {},
    })
      .then(r => r.json())
      .then(data => {
        const match = (data.projects || []).find(p => p.jobRef === jobRef);
        if (match) setSavedProject(match);
      })
      .catch(() => {}); // non-fatal — project store check is best-effort
  }, [syncKey, jobRef, apiBase, secret]);

  // ── Load a previously saved project from KV ────────────────────────────────
  const loadSavedProject = useCallback(async () => {
    if (!syncKey || !jobRef) return;
    try {
      const r = await fetch(`${apiBase}/api/project-store?syncKey=${encodeURIComponent(syncKey)}&jobRef=${encodeURIComponent(jobRef)}`, {
        headers: secret ? { "x-fbs-secret": secret } : {},
      });
      if (!r.ok) throw new Error("Not found");
      const { project } = await r.json();
      if (project.identified) {
        setIdentified(project.identified);
        setEditedMaterials(project.identified.materials || []);
        setStage("identified");
      }
      if (project.sourced) {
        setSourced(project.sourced);
        setStage("complete");
      }
      setSavedBannerDismissed(true);
    } catch {
      // silently ignore — user can proceed normally
    }
  }, [syncKey, jobRef, apiBase, secret]);

  // ── Auto-save to project store ─────────────────────────────────────────────
  const saveToStore = useCallback(async (identifiedResult, sourcedResult) => {
    if (!syncKey || !jobRef || !apiBase) return;
    setSaveStatus("saving");
    try {
      await fetch(`${apiBase}/api/project-store`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-fbs-secret": secret } : {}),
        },
        body: JSON.stringify({
          syncKey,
          jobRef,
          jobDescription,
          description,
          scopeItems,
          identified: identifiedResult,
          sourced: sourcedResult || null,
          imageCount: images.length,
        }),
      });
      setSaveStatus("saved");
      console.log(`Project ${jobRef} auto-saved to store.`);
    } catch {
      setSaveStatus("error");
    }
  }, [syncKey, jobRef, apiBase, secret, jobDescription, description, scopeItems, images.length]);

  const runIdentify = useCallback(async () => {
    setStage("identifying");
    setErrorMsg("");
    try {
      const resp = await fetch(`${apiBase}/api/materials-identify`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          images: images.slice(0, 20),
          scopeItems,
          description,
          jobDescription,
          jobRef,
        }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${resp.status}`);
      }
      const result = await resp.json();
      setIdentified(result);
      setEditedMaterials(result.materials || []);
      setStage("identified");
      // Auto-save identify result (sourced will be null at this point)
      await saveToStore(result, null);
    } catch (err) {
      setErrorMsg(err.message);
      setStage("error");
    }
  }, [apiBase, images, scopeItems, description, jobDescription, jobRef, secret, saveToStore]);

  const runSource = useCallback(async () => {
    setStage("sourcing");
    setErrorMsg("");
    try {
      const resp = await fetch(`${apiBase}/api/materials-source`, {
        method: "POST",
        headers,
        body: JSON.stringify({ materials: editedMaterials, budget }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${resp.status}`);
      }
      const result = await resp.json();
      setSourced(result);
      setStage("complete");
      // Auto-save complete results
      await saveToStore(identified, result);
    } catch (err) {
      setErrorMsg(err.message);
      setStage("error");
    }
  }, [apiBase, editedMaterials, budget, secret, saveToStore, identified]);

  function handleEditMaterial(index, updated) {
    setEditedMaterials(prev => prev.map((m, i) => (i === index ? updated : m)));
  }

  function exportCSV() {
    if (!sourced) return;
    const rows = [
      ["Trade", "Material", "Spec", "Qty", "Unit", "Supplier", "Product", "Unit Price (£)", "Total (£)", "URL"],
      ...sourced.sourced.map(item => {
        const opt = item.options?.[item.recommended_option_index || 0] || {};
        return [
          item.trade, item.material_name, item.spec || "",
          item.quantity_gross, item.unit,
          opt.supplier || "", opt.product_name || "",
          opt.unit_price || "", opt.total_cost || "", opt.product_url || "",
        ];
      }),
      ["", "", "", "", "", "", "TOTAL", "", sourced.grand_total, ""],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FBS_Materials_${jobRef || "Quote"}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const btn = (label, onClick, color = C.blue, disabled = false) => (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "10px 20px", background: disabled ? C.subtle : color,
      color: "#fff", border: "none", borderRadius: 6,
      cursor: disabled ? "not-allowed" : "pointer",
      fontWeight: 600, fontSize: 13, transition: "opacity 0.15s",
      opacity: disabled ? 0.5 : 1,
    }}>{label}</button>
  );

  // Save status chip shown in header when KV store is available
  const SaveChip = () => {
    if (!syncKey || saveStatus === "idle") return null;
    const chipMap = {
      saving: { color: C.muted, label: "Saving…" },
      saved:  { color: C.teal,  label: "✓ Saved to project store" },
      error:  { color: C.amber, label: "⚠ Save failed" },
    };
    const chip = chipMap[saveStatus];
    return (
      <span style={{ fontSize: 11, color: chip.color, marginLeft: 8 }}>{chip.label}</span>
    );
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      zIndex: 1000, display: "flex", alignItems: "flex-start",
      justifyContent: "center", padding: 20, overflowY: "auto",
    }}>
      <div style={{
        background: C.card, borderRadius: 12, width: "100%", maxWidth: 680,
        margin: "20px auto", boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        border: `1px solid ${C.border}`, overflow: "hidden",
      }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: `1px solid ${C.border}`,
          background: C.inner,
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>
                Material Cost Sourcing
              </h2>
              <SaveChip />
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: C.muted }}>
              {jobRef ? `Job: ${jobRef} · ` : ""}{scopeItems.length} scope items · Live UK supplier pricing
            </p>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: C.muted,
            cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 0,
          }}>×</button>
        </div>

        <div style={{ padding: 20 }}>

          {/* Saved project banner (shown on idle screen when a previous save exists) */}
          {savedProject && !savedBannerDismissed && stage === "idle" && (
            <SavedBanner
              project={savedProject}
              onLoad={loadSavedProject}
              onDismiss={() => setSavedBannerDismissed(true)}
            />
          )}

          {/* ── IDLE ──────────────────────────────────────────────────── */}
          {stage === "idle" && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏗</div>
              <h3 style={{ margin: "0 0 6px", color: C.text, fontSize: 15 }}>Source Material Costs</h3>
              <p style={{ margin: "0 0 24px", color: C.muted, fontSize: 13, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
                Analyse your scope items and site photos to identify every material required
                (including first-fix items), then search UK suppliers for live prices and product links.
              </p>

              {images.length > 0 && (
                <p style={{ color: C.teal, fontSize: 12, marginBottom: 16 }}>
                  📸 {images.length} image{images.length > 1 ? "s" : ""} will be analysed for material specs and site context
                </p>
              )}

              {/* Budget selector */}
              <p style={{ color: C.dim, fontSize: 12, marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Budget / quality level
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 24 }}>
                {BUDGET_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setBudget(opt.value)} style={{
                    padding: "8px 16px", borderRadius: 8,
                    border: `1px solid ${budget === opt.value ? C.blue : C.border}`,
                    background: budget === opt.value ? C.blue + "22" : C.inner,
                    color: budget === opt.value ? C.blue : C.text,
                    cursor: "pointer", fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 600 }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{opt.desc}</div>
                  </button>
                ))}
              </div>

              {btn("Identify Materials →", runIdentify, C.blue)}
              <p style={{ color: C.muted, fontSize: 11, marginTop: 10 }}>
                Step 1 of 2 · Gemini 2.5 Pro analyses scope + photos · large jobs split into chunks automatically
              </p>
            </div>
          )}

          {/* ── IDENTIFYING ───────────────────────────────────────────── */}
          {stage === "identifying" && (
            <Spinner label={`Gemini 2.5 Pro identifying materials across ${scopeItems.length} scope items…`} />
          )}

          {/* ── IDENTIFIED — review ────────────────────────────────────── */}
          {stage === "identified" && identified && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14, color: C.text }}>
                  {editedMaterials.length} materials identified
                  {identified.chunks_processed > 1
                    ? <span style={{ fontSize: 11, color: C.teal, marginLeft: 8 }}>({identified.chunks_processed} chunks)</span>
                    : null}
                </h3>
                <span style={{ fontSize: 11, color: C.muted }}>Edit any item before sourcing</span>
              </div>

              {identified.assumptions?.length > 0 && (
                <div style={{
                  background: C.amber + "15", border: `1px solid ${C.amber}44`,
                  borderRadius: 6, padding: "8px 12px", marginBottom: 12,
                }}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: C.amber }}>
                    Assumptions made:
                  </p>
                  {identified.assumptions.map((a, i) => (
                    <p key={i} style={{ margin: "1px 0", fontSize: 11, color: C.amber + "cc" }}>• {a}</p>
                  ))}
                </div>
              )}

              <div style={{ maxHeight: 360, overflowY: "auto", paddingRight: 4, marginBottom: 12 }}>
                {editedMaterials.map((mat, i) => (
                  <IdentifyCard key={mat.id || i} material={mat} index={i} onEdit={handleEditMaterial} />
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {btn(`Source Prices (${budget}) →`, runSource, C.emerald)}
                {btn("← Back", () => setStage("idle"), C.subtle)}
              </div>
              <p style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>
                Step 2 of 2 · Perplexity Sonar Pro searches UK suppliers in real time
              </p>
            </div>
          )}

          {/* ── SOURCING ──────────────────────────────────────────────── */}
          {stage === "sourcing" && (
            <Spinner label={`Perplexity searching UK suppliers for ${editedMaterials.length} materials… (30–90 sec)`} />
          )}

          {/* ── COMPLETE ──────────────────────────────────────────────── */}
          {stage === "complete" && sourced && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <h3 style={{ margin: "0 0 2px", fontSize: 14, color: C.text }}>
                    {sourced.sourced.length} materials sourced
                  </h3>
                  <span style={{ fontSize: 11, color: C.muted }}>{sourced.budget_level} grade · ex-VAT</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ margin: 0, fontSize: 11, color: C.muted }}>Total material cost</p>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.green }}>
                      {fmtGBP(sourced.grand_total)}
                    </p>
                  </div>
                  <button onClick={exportCSV} style={{
                    padding: "8px 14px", background: C.inner,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    color: C.text, cursor: "pointer", fontSize: 12, fontWeight: 600,
                  }}>Export CSV</button>
                </div>
              </div>

              <div style={{ maxHeight: 460, overflowY: "auto", paddingRight: 4 }}>
                {sourced.sourced.map((item, i) => (
                  <SourcedCard key={item.id || i} item={item} />
                ))}
              </div>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    Searched: {new Date(sourced.search_timestamp).toLocaleString("en-GB")}
                  </span>
                  {saveStatus === "saved" && (
                    <span style={{ fontSize: 11, color: C.teal, marginLeft: 12 }}>
                      💾 Results saved — reload from project store next visit
                    </span>
                  )}
                </div>
                <button onClick={() => setStage("identified")} style={{
                  background: "none", border: "none", color: C.blue,
                  cursor: "pointer", fontSize: 12,
                }}>Re-source with different options</button>
              </div>
              {sourced.notes && (
                <p style={{ fontSize: 11, color: C.muted, marginTop: 6, fontStyle: "italic" }}>
                  {sourced.notes}
                </p>
              )}
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────── */}
          {stage === "error" && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚠</div>
              <p style={{ color: C.red, fontWeight: 600, margin: "0 0 6px" }}>Something went wrong</p>
              <p style={{ color: C.muted, fontSize: 13, margin: "0 0 20px", maxWidth: 340, marginLeft: "auto", marginRight: "auto" }}>
                {errorMsg}
              </p>
              {btn("Try again", () => setStage("idle"), C.subtle)}
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
