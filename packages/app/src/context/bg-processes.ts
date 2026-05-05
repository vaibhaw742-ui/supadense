import { createSignal } from "solid-js"

export type BgProcess = {
  id: number
  label: string
  status: "processing" | "done" | "error"
  createdAt: number
}

const [bgProcesses, setBgProcesses] = createSignal<BgProcess[]>([])
let _counter = 0

export { bgProcesses }

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
