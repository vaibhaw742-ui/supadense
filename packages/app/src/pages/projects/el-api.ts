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
  clone_status?: "none" | "cloning" | "indexing" | "done" | "failed"
  clone_error?: string | null
  supadense_init?: "none" | "local" | "pushed"
  repo_branch?: string | null
  repo_local_path?: string | null
  is_default?: boolean
}

export interface ProjectNode {
  id: string
  project_id: string
  path: string
  name: string
  depth: number
  parent_path: string | null
  node_type: string
  file_count: number
  total_file_count: number
  files_json: Array<{ name: string; path: string; ext: string; size_bytes: number }>
  key_files: string[]
  time_created: number
  time_updated: number
}

export interface CloneStatus {
  clone_status: "none" | "cloning" | "indexing" | "done" | "failed"
  clone_error: string | null
  supadense_init: "none" | "local" | "pushed"
  repo_branch: string | null
  node_count: number
  total_file_count: number
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
  type: "project" | "resource" | "concept" | "category" | "github" | "source"
  label: string
  url?: string
  resource_id?: string
  status?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GitHubRepo {
  id: number
  full_name: string
  private: boolean
  description: string | null
  language: string | null
  pushed_at: string
}

export interface GitHubStatus {
  configured: boolean
  connected: boolean
  login: string | null
}

export interface TreeEntry {
  name: string
  path: string
  type: "file" | "dir"
  children?: TreeEntry[]
}

export interface LocalProject {
  id: string
  name: string
  local_path: string
  brain_dir: string
  sources_dir: string
  source_id: string
  github_repo?: string | null
  time_created: number
  time_updated: number
  brain_files?: string[]
}

export interface GithubPR {
  number: number
  title: string
  author: string
  state: "open" | "draft"
  reviews: "approved" | "changes_requested" | "pending" | "none"
  comments: number
  updated_at: string
  url: string
  labels: string[]
}

export interface GithubIssue {
  number: number
  title: string
  author: string
  labels: string[]
  comments: number
  updated_at: string
  url: string
}

export interface GithubActivity {
  repo: string
  prs: GithubPR[]
  issues: GithubIssue[]
  fetched_at: number
  cached: boolean
}

export const elApi = {
  async listProjects(): Promise<ElProject[]> {
    const res = await fetch(`${apiBase()}/el/projects`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to list projects")
    return res.json()
  },

  async getProject(id: string): Promise<{ project: ElProject; resources: ElResource[] } | null> {
    try {
      const res = await fetch(`${apiBase()}/el/projects/${id}`, { headers: authHeaders() })
      if (!res.ok) return null
      return res.json()
    } catch {
      return null
    }
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
    try {
      const res = await fetch(`${apiBase()}/el/projects/${id}/graph`, { headers: authHeaders() })
      if (!res.ok) return { nodes: [], edges: [] }
      return res.json()
    } catch {
      return { nodes: [], edges: [] }
    }
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

  async cloneRepo(id: string, branch?: string): Promise<{ status: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/clone`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ branch }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to start clone")
    }
    return res.json()
  },

  async getCloneStatus(id: string): Promise<CloneStatus> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/clone-status`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to get clone status")
    return res.json()
  },

  async pullRepo(id: string): Promise<{ status: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/pull`, {
      method: "POST",
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error("Failed to pull")
    return res.json()
  },

  async getNodes(id: string, maxDepth?: number): Promise<ProjectNode[]> {
    const qs = maxDepth != null ? `?max_depth=${maxDepth}` : ""
    const res = await fetch(`${apiBase()}/el/projects/${id}/nodes${qs}`, { headers: authHeaders() })
    if (!res.ok) return []
    return res.json()
  },

  async getNodeFiles(id: string, nodePath: string): Promise<ProjectNode & { children: ProjectNode[] }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/nodes/${encodeURIComponent(nodePath)}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Node not found")
    return res.json()
  },

  async initSupadense(id: string): Promise<{ status: string; pushed: boolean; message?: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/init-supadense`, {
      method: "POST",
      headers: authHeaders(),
    })
    if (!res.ok) throw new Error("Failed to init supadense")
    return res.json()
  },

  async getGitHubStatus(): Promise<GitHubStatus> {
    const res = await fetch(`${apiBase()}/el/github/status`, { headers: authHeaders() })
    if (!res.ok) return { configured: false, connected: false, login: null }
    return res.json()
  },

  async getGitHubConnectUrl(): Promise<{ url: string }> {
    const res = await fetch(`${apiBase()}/el/github/connect`, { headers: authHeaders() })
    if (!res.ok) throw new Error("GitHub OAuth not configured on this server")
    return res.json()
  },

  async listGitHubRepos(q?: string): Promise<GitHubRepo[]> {
    const qs = q ? `?q=${encodeURIComponent(q)}` : ""
    const res = await fetch(`${apiBase()}/el/github/repos${qs}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to list repos")
    return res.json()
  },

  async disconnectGitHub(): Promise<void> {
    await fetch(`${apiBase()}/el/github/disconnect`, { method: "DELETE", headers: authHeaders() })
  },

  async listBranches(id: string): Promise<{ branches: string[]; commit_count: number }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/branches`, { headers: authHeaders() })
    if (!res.ok) return { branches: [], commit_count: 0 }
    return res.json()
  },

  async getTree(id: string): Promise<{ entries: TreeEntry[] }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/tree`, { headers: authHeaders() })
    if (!res.ok) return { entries: [] }
    return res.json()
  },

  async getSupadenseTree(id: string): Promise<{ entries: TreeEntry[] }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/supadense-tree`, { headers: authHeaders() })
    if (!res.ok) return { entries: [] }
    return res.json()
  },

  async getFileContent(id: string, filePath: string): Promise<{ content: string; path: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/file-content?path=${encodeURIComponent(filePath)}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to read file")
    return res.json()
  },

  async getSupadenseFileContent(id: string, filePath: string): Promise<{ content: string; path: string }> {
    const res = await fetch(`${apiBase()}/el/projects/${id}/supadense-file-content?path=${encodeURIComponent(filePath)}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to read file")
    return res.json()
  },

  async deleteProject(id: string): Promise<void> {
    await fetch(`${apiBase()}/el/projects/${id}`, { method: "DELETE", headers: authHeaders() })
  },

  async getGithubActivity(id: string, force?: boolean): Promise<GithubActivity> {
    const qs = force ? "?force=true" : ""
    const res = await fetch(`${apiBase()}/local-projects/${id}/github-activity${qs}`, { headers: authHeaders() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to fetch GitHub activity")
    }
    return res.json()
  },

  async setGithubRepo(id: string, githubRepo: string): Promise<void> {
    const res = await fetch(`${apiBase()}/local-projects/${id}/github-repo`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ github_repo: githubRepo }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to set GitHub repo")
    }
  },

  async deleteLocalProject(id: string, options?: { deleteDisk?: boolean }): Promise<void> {
    const qs = options?.deleteDisk ? "?deleteDisk=true" : ""
    const res = await fetch(`${apiBase()}/local-projects/${id}${qs}`, {
      method: "DELETE",
      headers: authHeaders(),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(err.error ?? "Failed to delete local project")
    }
  },

  async getResourceProjects(): Promise<Array<{ url: string; project_id: string; project_name: string; join_id: string }>> {
    const res = await fetch(`${apiBase()}/el/resource-projects`, { headers: authHeaders() })
    if (!res.ok) return []
    return res.json()
  },

  async getResource(id: string): Promise<{
    id: string; url: string | null; title: string | null; author: string | null
    modality: string; status: string; content: string | null
    metadata: Record<string, unknown>; time_created: number
    asset_map: Record<string, { localPath: string; width?: number | null; height?: number | null }>
  }> {
    const res = await fetch(`${apiBase()}/el/resources/${id}`, { headers: authHeaders() })
    if (!res.ok) throw new Error(`Failed to load resource: ${res.status}`)
    return res.json()
  },

  async listAllResources(): Promise<Array<{
    id: string; url: string | null; title: string | null; author: string | null
    modality: string; status: string; metadata: Record<string, unknown>; time_created: number
  }>> {
    const res = await fetch(`${apiBase()}/el/resources`, { headers: authHeaders() })
    if (!res.ok) return []
    return res.json()
  },

  async listCommits(id: string, branch?: string, limit?: number): Promise<{ commits: Array<{ sha: string; sha_full: string; message: string; author_name: string; author_email: string; date: string }> }> {
    const qs = new URLSearchParams()
    if (branch) qs.set("branch", branch)
    if (limit) qs.set("limit", String(limit))
    const res = await fetch(`${apiBase()}/el/projects/${id}/commits?${qs}`, { headers: authHeaders() })
    if (!res.ok) return { commits: [] }
    return res.json()
  },

  async listLocalProjects(): Promise<LocalProject[]> {
    const res = await fetch(`${apiBase()}/local-projects`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json() as { projects: LocalProject[] }
    return data.projects
  },

  async getLocalProject(id: string): Promise<LocalProject & { brain_files: string[] }> {
    const res = await fetch(`${apiBase()}/local-projects/${id}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Local project not found")
    return res.json()
  },

  async getLocalProjectSources(id: string): Promise<Array<{ name: string; size: number; title: string; url: string | null; source_type: string; status: "processing" | "done" | "failed" }>> {
    const res = await fetch(`${apiBase()}/local-projects/${id}/sources`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json() as { sources: Array<{ name: string; size: number; title: string; url: string | null; source_type: string; status: "processing" | "done" | "failed" }> }
    return data.sources
  },

  async getLocalProjectBrainFile(id: string, path: string): Promise<{ content: string; path: string }> {
    const res = await fetch(`${apiBase()}/local-projects/${id}/brain-file?path=${encodeURIComponent(path)}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to read brain file")
    return res.json()
  },

  watchLocalProject(projectId: string, onChange: () => void): () => void {
    const token = getAuthToken()
    const url = `${apiBase()}/local-projects/${projectId}/watch${token ? `?auth_token=${encodeURIComponent(token)}` : ""}`
    const es = new EventSource(url)
    es.addEventListener("change", onChange)
    return () => es.close()
  },

  async deleteLocalSource(projectId: string, filename: string): Promise<void> {
    await fetch(`${apiBase()}/local-projects/${projectId}/sources/${encodeURIComponent(filename)}`, {
      method: "DELETE",
      headers: authHeaders(),
    })
  },

  async getLocalSourceFileContent(projectId: string, filename: string): Promise<string> {
    const res = await fetch(`${apiBase()}/local-projects/${projectId}/sources/${encodeURIComponent(filename)}`, { headers: authHeaders() })
    if (!res.ok) throw new Error("Failed to read source file")
    return res.text()
  },

  async getApiRequests(params?: { range?: string; type?: string; status?: string }): Promise<{
    requests: Array<{ id: string; type: string; status: number; duration_ms: number; document_id: string | null; time_created: number; project_id: string | null }>
    stats: { total: number; successful: number; avg_latency_ms: number | null; type_counts: Record<string, number> }
  }> {
    const q = new URLSearchParams()
    if (params?.range) q.set("range", params.range)
    if (params?.type) q.set("type", params.type)
    if (params?.status) q.set("status", params.status)
    const res = await fetch(`${apiBase()}/local-projects/api-requests?${q}`, { headers: authHeaders() })
    if (!res.ok) return { requests: [], stats: { total: 0, successful: 0, avg_latency_ms: null, type_counts: {} } }
    return res.json()
  },

  async listAllLocalSources(): Promise<Array<{
    id: string; project_id: string; project_name: string; filename: string
    title: string; url: string | null; status: "processing" | "done" | "failed"
    size: number; time_created: number; source_type?: string
  }>> {
    const res = await fetch(`${apiBase()}/local-projects/all-sources`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json() as { sources: any[] }
    return data.sources
  },

  async getLocalProjectGraph(id: string): Promise<{ nodes: Array<{ id: string; type: string; label: string; layer: string }>; edges: Array<{ source: string; target: string }> }> {
    const res = await fetch(`${apiBase()}/local-projects/${id}/graph`, { headers: authHeaders() })
    if (!res.ok) return { nodes: [], edges: [] }
    return res.json()
  },
}
