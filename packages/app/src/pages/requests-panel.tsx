import { createResource, createSignal, For, Show } from "solid-js"
import { elApi } from "@/pages/projects/el-api"

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function DonutChart(props: { counts: Record<string, number> }) {
  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#6366f1"]
  const entries = () => Object.entries(props.counts)
  const total = () => entries().reduce((s, [, v]) => s + v, 0)

  const segments = () => {
    let offset = 0
    return entries().map(([label, count], i) => {
      const pct = total() > 0 ? (count / total()) * 100 : 0
      const seg = { label, count, pct, offset, color: COLORS[i % COLORS.length] }
      offset += pct
      return seg
    })
  }

  // SVG circle approach: circumference = 2π×r = ~251 for r=40
  const C = 251.2
  const r = 40
  const cx = 50, cy = 50

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "16px" }}>
      <svg width="72" height="72" viewBox="0 0 100 100">
        <Show when={segments().length === 0}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" stroke-width="14" />
        </Show>
        <For each={segments()}>
          {(seg) => (
            <circle
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              stroke-width="14"
              stroke-dasharray={`${(seg.pct / 100) * C} ${C}`}
              stroke-dashoffset={`${-((seg.offset / 100) * C - C / 4)}`}
              style={{ transform: "rotate(-90deg)", "transform-origin": "50% 50%" }}
            />
          )}
        </For>
      </svg>
      <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
        <For each={segments()}>
          {(seg) => (
            <div style={{ display: "flex", "align-items": "center", gap: "6px", "font-size": "12px" }}>
              <span style={{ width: "8px", height: "8px", "border-radius": "50%", background: seg.color, "flex-shrink": "0" }} />
              <span style={{ color: "#374151" }}>{seg.label}</span>
              <span style={{ color: "#9ca3af", "margin-left": "2px" }}>{seg.count}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function RequestsPanel() {
  const [range, setRange] = createSignal<"1d" | "7d" | "30d" | "all">("30d")
  const [typeFilter, setTypeFilter] = createSignal<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = createSignal<string | undefined>(undefined)
  const [typeDropOpen, setTypeDropOpen] = createSignal(false)
  const [statusDropOpen, setStatusDropOpen] = createSignal(false)

  const [data, { refetch }] = createResource(
    () => ({ range: range(), type: typeFilter(), status: statusFilter() }),
    ({ range, type, status }) => elApi.getApiRequests({ range, type, status }),
  )

  const statusBadge = (code: number) => {
    const ok = code >= 200 && code < 300
    return (
      <span style={{
        display: "inline-block",
        padding: "2px 10px", "border-radius": "5px",
        "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
        background: ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
        color: ok ? "#059669" : "#dc2626",
        border: `1px solid ${ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
      }}>{code}</span>
    )
  }

  const allTypes = () => Object.keys(data()?.stats.type_counts ?? {})

  const RangeBtn = (p: { label: string; value: "1d" | "7d" | "30d" | "all" }) => (
    <button
      type="button"
      onClick={() => setRange(p.value)}
      style={{
        padding: "5px 14px", "border-radius": "6px", border: "1px solid #e5e7eb", cursor: "pointer",
        "font-family": "'Geist Mono', monospace", "font-size": "12px", "font-weight": range() === p.value ? "700" : "500",
        background: range() === p.value ? "#111827" : "#ffffff",
        color: range() === p.value ? "#ffffff" : "#6b7280",
        transition: "all 120ms",
      }}
    >{p.label}</button>
  )

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", background: "#ffffff", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ "flex-shrink": "0", padding: "28px 32px 20px", "border-bottom": "1px solid #f3f4f6" }}>
        <div style={{ display: "flex", "align-items": "flex-start", "justify-content": "space-between", "margin-bottom": "4px" }}>
          <div>
            <h1 style={{ margin: "0 0 4px", "font-size": "22px", "font-weight": "700", color: "#111827", "font-family": "inherit" }}>Requests</h1>
            <p style={{ margin: "0", "font-size": "13px", color: "#6b7280", "font-family": "'Geist Mono', monospace" }}>View API request history and details</p>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <RangeBtn label="1d" value="1d" />
            <RangeBtn label="7d" value="7d" />
            <RangeBtn label="30d" value="30d" />
            <RangeBtn label="All" value="all" />

            {/* Type dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => { setTypeDropOpen(v => !v); setStatusDropOpen(false) }}
                style={{
                  display: "flex", "align-items": "center", gap: "6px",
                  padding: "5px 12px", "border-radius": "6px", border: "1px solid #e5e7eb",
                  background: "#ffffff", cursor: "pointer", "font-size": "12px",
                  "font-family": "'Geist Mono', monospace", color: "#374151",
                }}
              >
                {typeFilter() ? typeFilter() : "All types"}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <Show when={typeDropOpen()}>
                <div style={{
                  position: "absolute", right: "0", top: "calc(100% + 4px)", "z-index": "50",
                  background: "#ffffff", border: "1px solid #e5e7eb", "border-radius": "8px",
                  "box-shadow": "0 4px 16px rgba(0,0,0,0.08)", "min-width": "140px", padding: "4px",
                }}>
                  {(["", ...allTypes()] as string[]).map(t => (
                    <button
                      type="button"
                      onClick={() => { setTypeFilter(t || undefined); setTypeDropOpen(false) }}
                      style={{
                        display: "block", width: "100%", "text-align": "left",
                        padding: "7px 12px", background: typeFilter() === (t || undefined) ? "#f9fafb" : "transparent",
                        border: "none", cursor: "pointer", "font-size": "12px",
                        "font-family": "'Geist Mono', monospace", color: "#374151", "border-radius": "5px",
                      }}
                    >{t || "All types"}</button>
                  ))}
                </div>
              </Show>
            </div>

            {/* Status dropdown */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => { setStatusDropOpen(v => !v); setTypeDropOpen(false) }}
                style={{
                  display: "flex", "align-items": "center", gap: "6px",
                  padding: "5px 12px", "border-radius": "6px", border: "1px solid #e5e7eb",
                  background: "#ffffff", cursor: "pointer", "font-size": "12px",
                  "font-family": "'Geist Mono', monospace", color: "#374151",
                }}
              >
                {statusFilter() ? statusFilter() : "All statuses"}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <Show when={statusDropOpen()}>
                <div style={{
                  position: "absolute", right: "0", top: "calc(100% + 4px)", "z-index": "50",
                  background: "#ffffff", border: "1px solid #e5e7eb", "border-radius": "8px",
                  "box-shadow": "0 4px 16px rgba(0,0,0,0.08)", "min-width": "140px", padding: "4px",
                }}>
                  {(["", "2xx", "4xx", "5xx", "error"] as string[]).map(s => (
                    <button
                      type="button"
                      onClick={() => { setStatusFilter(s || undefined); setStatusDropOpen(false) }}
                      style={{
                        display: "block", width: "100%", "text-align": "left",
                        padding: "7px 12px", background: statusFilter() === (s || undefined) ? "#f9fafb" : "transparent",
                        border: "none", cursor: "pointer", "font-size": "12px",
                        "font-family": "'Geist Mono', monospace", color: "#374151", "border-radius": "5px",
                      }}
                    >{s || "All statuses"}</button>
                  ))}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: "1", "overflow-y": "auto" }}>

        {/* Stats cards */}
        <div style={{ display: "grid", "grid-template-columns": "1fr 1fr 1fr", gap: "16px", padding: "20px 32px" }}>
          {/* By request type */}
          <div style={{ border: "1px solid #e5e7eb", "border-radius": "10px", padding: "18px 20px", background: "#ffffff" }}>
            <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af", "margin-bottom": "14px" }}>By request type</div>
            <Show when={Object.keys(data()?.stats.type_counts ?? {}).length > 0} fallback={
              <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                <div style={{ width: "72px", height: "72px", "border-radius": "50%", border: "14px solid #e5e7eb" }} />
                <span style={{ "font-size": "12px", color: "#9ca3af" }}>No data yet</span>
              </div>
            }>
              <DonutChart counts={data()!.stats.type_counts} />
            </Show>
          </div>

          {/* Successful requests */}
          <div style={{ border: "1px solid #e5e7eb", "border-radius": "10px", padding: "18px 20px", background: "#ffffff" }}>
            <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af", "margin-bottom": "12px" }}>Successful requests (2xx)</div>
            <div style={{ display: "flex", "align-items": "baseline", gap: "8px" }}>
              <span style={{ "font-size": "40px", "font-weight": "700", color: "#111827", "line-height": "1" }}>{data()?.stats.successful ?? 0}</span>
              <span style={{ "font-size": "13px", color: "#9ca3af" }}>of {data()?.stats.total ?? 0}</span>
            </div>
          </div>

          {/* Average latency */}
          <div style={{ border: "1px solid #e5e7eb", "border-radius": "10px", padding: "18px 20px", background: "#ffffff" }}>
            <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af", "margin-bottom": "12px" }}>Average latency (search queries)</div>
            <Show when={data()?.stats.avg_latency_ms != null} fallback={
              <span style={{ "font-size": "40px", "font-weight": "700", color: "#d1d5db", "line-height": "1" }}>—</span>
            }>
              <div style={{ display: "flex", "align-items": "baseline", gap: "6px" }}>
                <span style={{ "font-size": "40px", "font-weight": "700", color: "#111827", "line-height": "1" }}>{data()!.stats.avg_latency_ms}</span>
                <span style={{ "font-size": "13px", color: "#9ca3af" }}>ms</span>
              </div>
            </Show>
          </div>
        </div>

        {/* Table */}
        <div style={{ padding: "0 32px 32px" }}>
          <div style={{ border: "1px solid #e5e7eb", "border-radius": "8px", overflow: "hidden" }}>
            <table style={{ width: "100%", "border-collapse": "collapse" }}>
              <thead>
                <tr style={{ background: "#f9fafb", "border-bottom": "1px solid #e5e7eb" }}>
                  {(["TYPE", "STATUS", "DURATION", "TIME", "DOCUMENT"] as const).map(col => (
                    <th style={{
                      "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                      "letter-spacing": "0.08em", color: "#9ca3af", "text-align": "left",
                      padding: "10px 20px", "white-space": "nowrap",
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Show when={data.loading}>
                  <For each={[1,2,3,4]}>
                    {() => (
                      <tr style={{ "border-bottom": "1px solid #f3f4f6" }}>
                        <td style={{ padding: "14px 20px" }}><div style={{ width: "60px", height: "24px", background: "#f3f4f6", "border-radius": "4px" }} /></td>
                        <td style={{ padding: "14px 20px" }}><div style={{ width: "44px", height: "24px", background: "#f3f4f6", "border-radius": "4px" }} /></td>
                        <td style={{ padding: "14px 20px" }}><div style={{ width: "60px", height: "14px", background: "#f3f4f6", "border-radius": "3px" }} /></td>
                        <td style={{ padding: "14px 20px" }}><div style={{ width: "60px", height: "14px", background: "#f3f4f6", "border-radius": "3px" }} /></td>
                        <td style={{ padding: "14px 20px" }}><div style={{ width: "40px", height: "14px", background: "#f3f4f6", "border-radius": "3px" }} /></td>
                      </tr>
                    )}
                  </For>
                </Show>

                <Show when={!data.loading && (data()?.requests.length ?? 0) === 0}>
                  <tr>
                    <td colspan="5" style={{ padding: "60px 20px", "text-align": "center" }}>
                      <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#9ca3af" }}>No requests yet</div>
                      <div style={{ "font-size": "12px", color: "#d1d5db", "margin-top": "4px" }}>API requests will appear here once you start using the brain tools</div>
                    </td>
                  </tr>
                </Show>

                <For each={data()?.requests ?? []}>
                  {(req) => (
                    <tr style={{ "border-bottom": "1px solid #f3f4f6" }}>
                      {/* TYPE */}
                      <td style={{ padding: "14px 20px", "vertical-align": "middle" }}>
                        <span style={{
                          display: "inline-block", padding: "3px 10px", "border-radius": "5px",
                          border: "1px solid #e5e7eb", background: "#ffffff",
                          "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#374151",
                        }}>{req.type}</span>
                      </td>
                      {/* STATUS */}
                      <td style={{ padding: "14px 20px", "vertical-align": "middle" }}>
                        {statusBadge(req.status)}
                      </td>
                      {/* DURATION */}
                      <td style={{ padding: "14px 20px", "vertical-align": "middle" }}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#374151" }}>
                          {Math.round(req.duration_ms)}ms
                        </span>
                      </td>
                      {/* TIME */}
                      <td style={{ padding: "14px 20px", "vertical-align": "middle" }}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#6b7280" }}>
                          {timeAgo(req.time_created)}
                        </span>
                      </td>
                      {/* DOCUMENT */}
                      <td style={{ padding: "14px 20px", "vertical-align": "middle" }}>
                        <Show when={req.document_id} fallback={
                          <span style={{ color: "#d1d5db", "font-size": "13px" }}>—</span>
                        }>
                          <a
                            href="#"
                            style={{ display: "inline-flex", "align-items": "center", gap: "5px", "font-size": "13px", color: "#2563eb", "text-decoration": "none" }}
                            onClick={(e) => e.preventDefault()}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View
                          </a>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <Show when={!data.loading && (data()?.requests.length ?? 0) > 0}>
            <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "10px" }}>
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af" }}>
                {data()?.requests.length} total requests
              </span>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
