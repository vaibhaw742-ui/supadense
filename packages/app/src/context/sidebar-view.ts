import { createSignal } from "solid-js"

export const [activeSidebarView, setActiveSidebarView] = createSignal<{
  section: string
  view: string
  label: string
}>({ section: "workspace", view: "practice", label: "Practice" })

// Slug to show when switching to the Notes tab from the graph
export const [activeNotesSlug, setActiveNotesSlug] = createSignal<string | null>(null)

// Resource ID to open in the Read panel when switching to it from the graph
export const [activeReadResourceId, setActiveReadResourceId] = createSignal<string | null>(null)

// Resource URL to open in the Read panel (used when KB resource ID is unknown, e.g. EL graph clicks)
export const [activeReadResourceUrl, setActiveReadResourceUrl] = createSignal<string | null>(null)

// Increment to signal the graph to refetch immediately (e.g. after a resource is deleted)
export const [graphRefreshTick, setGraphRefreshTick] = createSignal(0)
export function triggerGraphRefresh() { setGraphRefreshTick((n) => n + 1) }

// Active project in the Graph tab — null = show project list, set = show that project's graph
export const [activeGraphProjectId, setActiveGraphProjectId] = createSignal<string | null>(null)
export const [activeGraphProjectName, setActiveGraphProjectName] = createSignal<string | null>(null)

// Source name shown in the nav when a source is opened from the project graph
export const [activeSourceName, setActiveSourceName] = createSignal<string | null>(null)

// ── Project view mode — "graph" | "brain" (.supadense files) | "code" (repo source)
export type ProjectViewMode = "graph" | "brain" | "code"
export const [projectViewMode, setProjectViewMode] = createSignal<ProjectViewMode>("graph")

// ── Session view mode — controls which right-rail panel is shown in the session ──
// "code"    → default file/diff panel (opencode behaviour)
// "brain"   → brain search + results panel
// "sources" → .supadense/sources/ manager
// "layers"  → L0 / L1 / L2 brain node explorer
export type SessionViewMode = "code" | "brain" | "sources" | "layers"
export const [sessionViewMode, setSessionViewMode] = createSignal<SessionViewMode>("code")

// ── Brain graph overlay open (local project view) ──
export const [brainGraphOpen, setBrainGraphOpen] = createSignal(false)

// ── Brain view mode: "graph" | "files" ──
export type BrainViewMode = "graph" | "files"
export const [brainViewMode, setBrainViewMode] = createSignal<BrainViewMode>("graph")
