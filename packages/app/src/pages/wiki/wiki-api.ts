/**
 * wiki-api.ts — Fetch helpers for the KB wiki backend routes (/wiki/*)
 */
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"

export function useWikiApi() {
  const server = useServer()
  const params = useParams<{ dir: string }>()

  function headers(): Record<string, string> {
    const dir = decode64(params.dir) ?? ""
    const token = getAuthToken()
    return {
      "x-opencode-directory": dir,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  function baseUrl(): string {
    const http = server.current?.http
    if (!http) return "http://localhost:4096"
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl()}${path}`, { headers: headers() })
    if (!res.ok) throw new Error(`Wiki API ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  return {
    home: () => get<WikiHomeData>("/wiki/home"),
    page: (slug: string) => get<WikiPageData>(`/wiki/page/${slug}`),
    concepts: () => get<WikiConcept[]>("/wiki/concepts"),
    search: (q: string) => get<WikiSearchResult>(`/wiki/search?q=${encodeURIComponent(q)}`),
    pages: () => get<WikiPageSummary[]>("/wiki/pages"),
    roadmapList: () => get<{ docs: WikiRoadmapDoc[] }>("/wiki/roadmap"),
    roadmapDoc: (slug: string) => get<WikiRoadmapDocFull>(`/wiki/roadmap/${slug}`),
    dirSlug: () => params.dir,
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  type: "category" | "subcategory" | "resource" | "group"
  label: string
  color?: string
  slug?: string
  category_slug?: string
  url?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface WikiHomeData {
  workspace: {
    id: string
    kb_path: string
    learning_intent: string | null
    kb_initialized: boolean
    goals: string[]
  }
  stats: {
    total_pages: number
    total_categories: number
    total_sources: number
    total_concepts: number
  }
  categories: WikiCategory[]
  recent_events: WikiEvent[]
  graph_data: GraphData
}

export interface WikiCategory {
  id: string
  slug: string
  name: string
  description: string | null
  depth: "deep" | "working" | "awareness"
  icon: string | null
  color: string | null
  parent_category_id: string | null
  resource_count: number
  pages: WikiPageSummary[]
}

export interface WikiPageSummary {
  id: string
  slug: string
  title: string
  page_type: "index" | "category" | "subcategory"
  file_path: string
  resource_count: number
  subcategory_slug: string | null
  category_slug?: string | null
}

export interface WikiImage {
  id: string
  src_path: string
  caption: string | null
  description: string | null
  alt_text: string | null
  asset_type: string
  time_created: number
}

export interface WikiResource {
  id: string
  title: string | null
  url: string | null
  modality: string
  section_heading: string | null
  placed_at: number
}

export interface WikiPageData {
  page: {
    id: string
    slug: string
    title: string
    description: string | null
    type: string
    page_type: string
    file_path: string
    resource_count: number
    word_count: number
    category_slug: string | null
    subcategory_slug: string | null
    time_updated: number
  }
  category: {
    id: string
    slug: string
    name: string
    depth: string
    icon: string | null
  } | null
  parent_category: {
    id: string
    slug: string
    name: string
  } | null
  content: string
  category_tabs: {
    nav_slug: string
    title: string
    type: string
  }[]
  subcategories: {
    id: string
    slug: string
    title: string
    file_path: string
    subcategory_slug: string | null
    resource_count: number
  }[]
  concepts: WikiConcept[]
  resources: WikiResource[]
  images: WikiImage[]
}

export interface WikiConcept {
  name: string
  slug: string
  definition: string | null
  aliases?: string[]
  related_slugs?: string[]
}

export interface WikiEvent {
  id: string
  event_type: string
  summary: string
  time_created: number
}

export interface WikiRoadmapDoc {
  slug: string
  title: string
  type: "roadmap" | "blog"
  created: string | null
}

export interface WikiRoadmapDocFull extends WikiRoadmapDoc {
  content: string
}

export interface WikiSearchResult {
  locations: { file_path: string; abs_path: string; section_heading: string | null; summary: string; match_type: string; relevance: number }[]
  concepts: WikiConcept[]
  sources: { title: string | null; url: string | null; author: string | null; modality: string }[]
}
