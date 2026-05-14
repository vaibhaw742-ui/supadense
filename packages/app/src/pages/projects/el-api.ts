import { getAuthToken } from "@/utils/server"

function apiBase(): string {
  return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
    : `${location.origin}/api`
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
}

export interface ElProject {
  id: string
  name: string
  status: "onboarding" | "active" | "paused"
  context_json: Record<string, string> | null
  time_created: number
  resource_count?: number
}

export interface ElResource {
  join_id: string
  resource_id: string
  role: "primary" | "supplementary" | "archived"
  url: string | null
  title: string | null
  status: string
  resource_type: "github" | "arxiv" | "url"
  metadata: Record<string, unknown>
  time_created: number
}

export interface GraphNode {
  id: string
  type: "project" | "resource" | "concept" | "category"
  label: string
  url?: string
  resource_id?: string
  status?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export const elApi = {
  async listProjects(): Promise<ElProject[]> {
    const res = await fetch(`${apiBase()}/el/projects`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to list projects")
    return res.json()
  },

  async createProject(data: { name: string; github_url?: string; arxiv_url?: string }): Promise<ElProject> {
    const res = await fetch(`${apiBase()}/el/projects`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to create project")
    }
    return res.json()
  },

  async getProject(id: string): Promise<{ project: ElProject; resources: ElResource[] }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Project not found")
    return res.json()
  },

  async updateContext(id: string, context: Record<string, string>, status?: ElProject["status"]): Promise<ElProject> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/context`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ context, ...(status ? { status } : {}) }),
    })
    if (!res.ok) throw new Error("Failed to update context")
    return res.json()
  },

  async addResource(id: string, url: string, role: "primary" | "supplementary" = "primary"): Promise<ElResource> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/resources`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url, role }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to add resource")
    }
    return res.json()
  },

  async removeResource(projectId: string, joinId: string): Promise<void> {
    await fetch(`${apiBase()}/el/projects/${projectId}/resources/${joinId}`, {
      method: "DELETE",
      headers: authHeaders(),
    })
  },

  async getGraph(id: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/graph`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to load graph")
    return res.json()
  },

  async memorize(id: string, url: string): Promise<ElResource> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/memorize`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url }),
    })
    if (!res.ok) throw new Error("Failed to memorize resource")
    return res.json()
  },

  async listSessions(id: string): Promise<Array<{ id: string; title: string; time_created: number; time_updated: number }>> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/sessions`, { headers: authHeaders() })
    if (!res.ok) return []
    return res.json()
  },

  async provisionDirectory(id: string): Promise<{ directory: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/provision`, {
      method: "POST",
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error("Failed to provision project directory")
    return res.json()
  },

  async search(query: string, projectId?: string, filters?: { type?: string; role?: string }) {
    const res = await fetch(`${apiBase()}/el/search`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ q: query, project_id: projectId, filters }),
    })
    if (!res.ok) throw new Error("Search failed")
    return res.json()
  },
}
