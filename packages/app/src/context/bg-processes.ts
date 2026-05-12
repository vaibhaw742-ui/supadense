import { createSignal } from "solid-js"

export type BgProcess = {
  id: number
  label: string
  status: "processing" | "done" | "error"
  createdAt: number
}

export type ServerJob = {
  sessionID: string
  title: string
  status: string
  logs: string[]
}

export type ActivityEvent = {
  id: string
  event_type: string
  label: string
  nav_slug: string | null
  nav_resource_id: string | null
  time_created: number
}

const [bgProcesses, setBgProcesses] = createSignal<BgProcess[]>([])
const [serverJobs, setServerJobs] = createSignal<ServerJob[]>([])
const [activityEvents, setActivityEvents] = createSignal<ActivityEvent[]>([])
// Global set of activity event IDs that have pending (unread) notifications
const [notifiedEventIds, setNotifiedEventIds] = createSignal<Set<string>>(new Set())
export { notifiedEventIds, setNotifiedEventIds }

// Persisted dismissed event IDs — loaded once on startup, written on "Clear all"
const DISMISSED_KEY = "supadense_dismissed_event_ids"
function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]) } catch { return new Set() }
}
function saveDismissed(ids: Set<string>) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids])) } catch {}
}
export const dismissedEventIds: Set<string> = loadDismissed()

export function dismissAllNotifications() {
  notifiedEventIds().forEach((id) => dismissedEventIds.add(id))
  saveDismissed(dismissedEventIds)
  setNotifiedEventIds(new Set<string>())
}

// Global signal to drive inline notes-panel navigation from the bg panel
export type NotesNavRequest =
  | { type: "page"; slug: string; label: string; parent?: { slug: string; label: string } }
  | { type: "resource"; resourceId: string; label: string }
  | { type: "resources-list" }
const [notesNavRequest, setNotesNavRequest] = createSignal<NotesNavRequest | null>(null)
// First-seen timestamps for ETA calculation (keyed by sessionID)
export const serverJobSeenAt = new Map<string, number>()
let _counter = 0

export { bgProcesses, serverJobs, setServerJobs, activityEvents, setActivityEvents, notesNavRequest, setNotesNavRequest }

export function bgProcessAdd(label: string): number {
  const id = ++_counter
  setBgProcesses((q) => [...q, { id, label, status: "processing", createdAt: Date.now() }])
  return id
}

export function bgProcessUpdate(id: number, status: "done" | "error") {
  setBgProcesses((q) => q.map((p) => (p.id === id ? { ...p, status } : p)))
}

export function bgProcessClear() {
  setBgProcesses((q) => q.filter((p) => p.status === "processing"))
}
