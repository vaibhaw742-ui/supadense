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

// Increment to signal the graph to refetch immediately (e.g. after a resource is deleted)
export const [graphRefreshTick, setGraphRefreshTick] = createSignal(0)
export function triggerGraphRefresh() { setGraphRefreshTick((n) => n + 1) }

// Cluster filter — when set, the graph panel shows only that cluster + its resources
export const [activeClusterFilter, setActiveClusterFilter] = createSignal<{ id: string; name: string; color: string } | null>(null)
