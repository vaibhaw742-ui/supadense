const TERMINUS_URL  = process.env.BRAIN_TERMINUSDB_URL  ?? "http://localhost:6363"
const TERMINUS_USER = process.env.BRAIN_TERMINUSDB_USER ?? "admin"
const TERMINUS_PASS = process.env.BRAIN_TERMINUSDB_PASS ?? "admin"
const DB_ORG  = "admin"
const DB_NAME = "supadense_brain"

const AUTH = "Basic " + Buffer.from(`${TERMINUS_USER}:${TERMINUS_PASS}`).toString("base64")

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${TERMINUS_URL}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    const text = await res.text().catch(() => "")
    throw new Error(`TerminusDB ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return null as T
  return res.json().catch(() => null) as T
}

// ── Schema ────────────────────────────────────────────────────────────────

const BRAIN_SCHEMA = [
  {
    "@id":   "BrainPage",
    "@type": "Class",
    "@key":  { "@type": "Lexical", "@fields": ["slug", "source_id"] },
    slug:       "xsd:string",
    title:      "xsd:string",
    page_type:  "xsd:string",
    source_id:  "xsd:string",
    layer:      "xsd:integer",
    updated_at: "xsd:string",
    active:     "xsd:boolean",
  },
  {
    "@id":   "BrainLink",
    "@type": "Class",
    "@key":  { "@type": "Lexical", "@fields": ["from_slug", "to_slug", "link_type", "source_id"] },
    from_slug:  "xsd:string",
    to_slug:    "xsd:string",
    from_title: "xsd:string",
    to_title:   "xsd:string",
    link_type:  "xsd:string",
    source_id:  "xsd:string",
  },
]

// ── Bootstrap ─────────────────────────────────────────────────────────────

export async function ensureDatabase(): Promise<void> {
  const dbs = await req<{ "@id"?: string }[]>("GET", "/").catch(() => [])
  const exists = Array.isArray(dbs) && dbs.some((d) => String(d["@id"] ?? "").includes(DB_NAME))
  if (exists) return

  await req("POST", `/db/${DB_ORG}/${DB_NAME}`, {
    label:   "Supadense Brain",
    comment: "Versioned knowledge graph for supadense brain module",
    schema:  true,
    public:  false,
  }).catch((e: unknown) => {
    if (String(e).includes("DatabaseAlreadyExists")) return  // idempotent
    throw e
  })
  console.log("[brain/terminus] database created")
}

export async function ensureSchema(): Promise<void> {
  const existing = await req<{ "@id"?: string }[]>(
    "GET",
    `/document/${DB_ORG}/${DB_NAME}?graph_type=schema&as_list=true`,
  ).catch(() => [])

  const hasClasses = Array.isArray(existing) &&
    existing.some((d) => d["@id"] === "BrainPage" || d["@id"] === "BrainLink")

  if (hasClasses) return

  await req("POST",
    `/document/${DB_ORG}/${DB_NAME}?graph_type=schema&author=brain-bridge&message=init`,
    BRAIN_SCHEMA,
  )
  console.log("[brain/terminus] schema ready")
}

// ── Document helpers ──────────────────────────────────────────────────────

type PageRow = { slug: string; title: string; type: string; source_id: string; layer: number; updated_at: string; deleted_at: string | null }
type LinkRow = { from_slug: string; to_slug: string; from_title: string; to_title: string; link_type: string; source_id: string }

function pageDoc(p: PageRow) {
  return { "@type": "BrainPage", slug: p.slug, title: p.title ?? "", page_type: p.type, source_id: p.source_id, layer: p.layer, updated_at: String(p.updated_at), active: !p.deleted_at }
}
function linkDoc(l: LinkRow) {
  return { "@type": "BrainLink", from_slug: l.from_slug, to_slug: l.to_slug, from_title: l.from_title ?? "", to_title: l.to_title ?? "", link_type: l.link_type, source_id: l.source_id }
}

function docId(type: "BrainPage" | "BrainLink", slug: string, sourceId: string): string {
  return `${type}/${encodeURIComponent(slug)}+${sourceId}`
}

async function upsertDocs(docs: unknown[], msg: string): Promise<void> {
  if (!docs.length) return
  const qs = `author=brain-bridge&message=${encodeURIComponent(msg)}`
  await req("POST", `/document/${DB_ORG}/${DB_NAME}?${qs}`, docs).catch(async (e) => {
    if (String(e).includes("DocumentIdAlreadyExists")) {
      await req("PUT", `/document/${DB_ORG}/${DB_NAME}?${qs}`, docs)
    } else throw e
  })
}

// ── Sync ──────────────────────────────────────────────────────────────────

export async function fetchTerminusPageSlugs(): Promise<Set<string>> {
  const docs = await req<{ slug?: string; source_id?: string }[]>(
    "GET", `/document/${DB_ORG}/${DB_NAME}?type=BrainPage&as_list=true&count=10000`,
  ).catch(() => [])
  const set = new Set<string>()
  for (const d of Array.isArray(docs) ? docs : []) {
    if (d.slug && d.source_id) set.add(`${d.source_id}::${d.slug}`)
  }
  return set
}

export async function pushFullSync(pages: PageRow[], links: LinkRow[], sourceIds: string[]): Promise<void> {
  // Clean stale entries
  const terminusSlugs = await fetchTerminusPageSlugs()
  const postgresSlugs = new Set(pages.filter((p) => !p.deleted_at).map((p) => `${p.source_id}::${p.slug}`))
  const stale = [...terminusSlugs].filter((s) => !postgresSlugs.has(s))

  for (const key of stale) {
    const [sid, ...rest] = key.split("::")
    const slug = rest.join("::")
    await req("DELETE",
      `/document/${DB_ORG}/${DB_NAME}?id=${encodeURIComponent(docId("BrainPage", slug, sid))}&author=brain-bridge&message=cleanup`,
    ).catch(() => null)
    console.log(`[brain/terminus] removed stale: ${slug}`)
  }

  for (const sourceId of sourceIds) {
    const sourcePages = pages.filter((p) => p.source_id === sourceId && !p.deleted_at)
    const sourceLinks = links.filter((l) => l.source_id === sourceId)
    if (!sourcePages.length && !sourceLinks.length) continue

    const docs = [...sourcePages.map(pageDoc), ...sourceLinks.map(linkDoc)]
    const msg  = `initial sync: ${sourcePages.length} pages, ${sourceLinks.length} links`
    await upsertDocs(docs, msg)
    console.log(`[brain/terminus] source ${sourceId}: pushed ${docs.length} documents`)
  }
}

export async function pushDiff(diff: {
  added_pages: PageRow[]; updated_pages: PageRow[]; removed_page_slugs: string[]
  added_links: LinkRow[]; removed_links: LinkRow[]
}, sourceId: string): Promise<void> {
  const { added_pages, updated_pages, removed_page_slugs, added_links, removed_links } = diff
  const total = added_pages.length + updated_pages.length + removed_page_slugs.length + added_links.length + removed_links.length
  if (!total) return

  const msg = [
    added_pages.length   && `+${added_pages.length} pages`,
    updated_pages.length && `~${updated_pages.length} pages`,
    removed_page_slugs.length && `-${removed_page_slugs.length} pages`,
    added_links.length   && `+${added_links.length} links`,
  ].filter(Boolean).join(", ")

  const toUpsert = [...added_pages.map(pageDoc), ...updated_pages.map(pageDoc), ...added_links.map(linkDoc)]
  if (toUpsert.length) await upsertDocs(toUpsert, `sync: ${msg}`)

  for (const key of removed_page_slugs) {
    const [sid, ...rest] = key.split("::")
    if (sid !== sourceId) continue
    const slug = rest.join("::")
    await req("DELETE",
      `/document/${DB_ORG}/${DB_NAME}?id=${encodeURIComponent(docId("BrainPage", slug, sid))}&author=brain-bridge&message=remove+${encodeURIComponent(slug)}`,
    ).catch(() => null)
  }

  console.log(`[brain/terminus] source ${sourceId}: committed — ${msg}`)
}

export async function fetchLog(count = 20): Promise<unknown[]> {
  const res = await req<unknown[]>("GET", `/log/${DB_ORG}/${DB_NAME}?count=${count}`).catch(() => [])
  return Array.isArray(res) ? res : []
}
