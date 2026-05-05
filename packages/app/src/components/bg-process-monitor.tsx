import { createMemo, For, Show } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { bgProcesses, bgProcessClear } from "@/context/bg-processes"

export function BgProcessMonitor() {
  const hasAny = createMemo(() => bgProcesses().length > 0)
  const hasActive = createMemo(() => bgProcesses().some((p) => p.status === "processing"))
  const hasError = createMemo(() => bgProcesses().some((p) => p.status === "error"))

  return (
    <Show when={hasAny()}>
      <Popover
        placement="right-end"
        triggerAs="button"
        triggerProps={{
          "aria-label": "Background processes",
          style: {
            position: "relative",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            width: "40px",
            height: "40px",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-icon-base)",
            "border-radius": "8px",
          },
        }}
        trigger={
          <>
            {/* Activity / pulse icon */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ color: hasActive() ? "var(--color-blue-500, #3b82f6)" : "var(--color-icon-base)" }}
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            {/* Status dot */}
            <span
              style={{
                position: "absolute",
                top: "6px",
                right: "6px",
                width: "6px",
                height: "6px",
                "border-radius": "50%",
                background: hasActive()
                  ? "#3b82f6"
                  : hasError()
                  ? "#ef4444"
                  : "#22c55e",
              }}
            />
          </>
        }
      >
        {/* Popover content */}
        <div style={{ width: "280px", "border-radius": "10px", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            padding: "10px 12px",
            "border-bottom": "1px solid var(--border-weaker-base)",
          }}>
            <span style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-strong)" }}>
              Background Processes
            </span>
            <Show when={!hasActive()}>
              <button
                style={{
                  "font-size": "11px",
                  color: "var(--text-weak)",
                  padding: "2px 6px",
                  "border-radius": "4px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
                onClick={() => bgProcessClear()}
              >
                Clear
              </button>
            </Show>
          </div>
          {/* List */}
          <div style={{ "max-height": "240px", "overflow-y": "auto" }}>
            <For each={[...bgProcesses()].reverse()}>
              {(p) => (
                <div style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  padding: "8px 12px",
                  "border-bottom": "1px solid var(--border-weaker-base)",
                }}>
                  {/* Icon */}
                  <div style={{ "flex-shrink": "0", width: "14px", display: "flex", "align-items": "center", "justify-content": "center" }}>
                    <Show when={p.status === "processing"}>
                      <svg style={{ animation: "spin 1s linear infinite", color: "#3b82f6" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                    </Show>
                    <Show when={p.status === "done"}>
                      <svg style={{ color: "#22c55e" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </Show>
                    <Show when={p.status === "error"}>
                      <svg style={{ color: "#ef4444" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </Show>
                  </div>
                  {/* Text */}
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div style={{ "font-size": "12px", color: "var(--text-base)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} title={p.label}>
                      {p.label}
                    </div>
                    <div style={{
                      "font-size": "11px",
                      color: p.status === "processing" ? "#60a5fa" : p.status === "done" ? "#22c55e" : "#f87171",
                    }}>
                      {p.status === "processing" ? "Adding…" : p.status === "done" ? "Added successfully" : "Failed"}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Popover>
    </Show>
  )
}
