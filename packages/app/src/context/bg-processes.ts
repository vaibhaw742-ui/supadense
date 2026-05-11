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
}

const [bgProcesses, setBgProcesses] = createSignal<BgProcess[]>([])
const [serverJobs, setServerJobs] = createSignal<ServerJob[]>([])
// First-seen timestamps for ETA calculation (keyed by sessionID)
export const serverJobSeenAt = new Map<string, number>()
let _counter = 0

export { bgProcesses, serverJobs, setServerJobs }

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
