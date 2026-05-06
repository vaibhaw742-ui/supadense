import { createResource, createMemo, For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi, type WikiCategory, type WikiPageSummary } from "./wiki-api"
import { WikiGraph } from "./wiki-graph"
import "./wiki.css"

// Rotate through a palette so each top-level category's sub-cats get a distinct accent
const SUBCAT_PALETTES = [
  { bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.25)", text: "#6366f1" },
  { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.25)", text: "#059669" },
  { bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.25)", text: "#d97706" },
  { bg: "rgba(236,72,153,0.10)", border: "rgba(236,72,153,0.25)", text: "#db2777" },
  { bg: "rgba(14,165,233,0.10)", border: "rgba(14,165,233,0.25)", text: "#0284c7" },
  { bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.25)", text: "#9333ea" },
]

const TEMPLATES = {
  ml: {
    label: "ML / AI",
    icon: "🤖",
    desc: "Agents, RAG, LLM Inference, LLM Training",
    categories: [
      { slug: "agents", name: "Agents", icon: "🤖", description: "Autonomous AI systems that reason, plan, and act using tools, memory, and environment feedback." },
      { slug: "rag", name: "RAG", icon: "🔍", description: "Retrieval-Augmented Generation — grounding LLM outputs with external knowledge retrieval." },
      { slug: "llm-inference", name: "LLM Inference", icon: "⚡", description: "Serving large language models efficiently — latency, throughput, quantization, and hardware trade-offs." },
      { slug: "llm-training", name: "LLM Training", icon: "🧠", description: "Pre-training, fine-tuning, RLHF, and alignment techniques." },
    ],
  },
  software: {
    label: "Software Engineering",
    icon: "🏗️",
    desc: "Database, Frontend, System Design",
    categories: [
      { slug: "database", name: "Database", icon: "🗄️", description: "Relational and non-relational databases — schema design, indexing, query optimization, transactions." },
      { slug: "frontend", name: "Frontend", icon: "🖥️", description: "UI engineering — component architecture, state management, rendering strategies, performance." },
      { slug: "software-system-design", name: "System Design", icon: "🏗️", description: "Distributed systems, scalability patterns, API design, caching, and architectural trade-offs." },
    ],
  },
  custom: {
    label: "Custom",
    icon: "✏️",
    desc: "Define your own categories",
    categories: [],
  },
} as const

type TemplateKey = keyof typeof TEMPLATES

// ── Onboarding Wizard ─────────────────────────────────────────────────────────

function OnboardingWizard(props: { onComplete: () => void }) {
  const api = useWikiApi()

  const [step, setStep] = createSignal<1 | 2 | 3>(1)
  const [template, setTemplate] = createSignal<TemplateKey>("ml")
  const [intent, setIntent] = createSignal("")
  const [goals, setGoals] = createSignal(["", "", ""])
  const [customCats, setCustomCats] = createSignal([
    { name: "", icon: "" },
    { name: "", icon: "" },
    { name: "", icon: "" },
  ])
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal("")

  const updateGoal = (i: number, val: string) =>
    setGoals((g) => g.map((v, idx) => (idx === i ? val : v)))

  const updateCat = (i: number, field: "name" | "icon", val: string) =>
    setCustomCats((cats) => cats.map((c, idx) => idx === i ? { ...c, [field]: val } : c))

  const addCat = () => setCustomCats((cats) => [...cats, { name: "", icon: "" }])

  const removeCat = (i: number) => setCustomCats((cats) => cats.filter((_, idx) => idx !== i))

  const canProceedStep1 = () => template() !== undefined
  const canProceedStep2 = () => intent().trim().length > 0
  const canSubmit = () => {
    if (template() === "custom") {
      return customCats().some((c) => c.name.trim().length > 0)
    }
    return true
  }

  const submit = async () => {
    if (submitting()) return
    setSubmitting(true)
    setError("")
    try {
      const filledGoals = goals().filter((g) => g.trim())
      const cats = template() === "custom"
        ? customCats()
            .filter((c) => c.name.trim())
            .map((c) => ({
              slug: c.name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
              name: c.name.trim(),
              icon: c.icon.trim() || undefined,
            }))
        : undefined

      await api.onboard({
        template: template(),
        learning_intent: intent().trim(),
        goals: filledGoals,
        ...(cats ? { categories: cats } : {}),
      })
      props.onComplete()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="wk-wizard-overlay" onClick={(e) => e.target === e.currentTarget && undefined}>
      <div class="wk-wizard">
        {/* Header */}
        <div class="wk-wizard-header">
          <div class="wk-wizard-steps">
            {([1, 2, 3] as const).map((s) => (
              <div
                class="wk-wizard-step-dot"
                classList={{ active: step() === s, done: step() > s }}
                onClick={() => step() > s && setStep(s)}
              />
            ))}
          </div>
        </div>

        {/* Step 1 — Template */}
        <Show when={step() === 1}>
          <div class="wk-wizard-body">
            <h2 class="wk-wizard-title">Choose a knowledge template</h2>
            <p class="wk-wizard-subtitle">Select a starting structure for your KB. You can add or change categories anytime.</p>
            <div class="wk-wizard-templates">
              <For each={Object.entries(TEMPLATES) as [TemplateKey, typeof TEMPLATES[TemplateKey]][]} >
                {([key, tpl]) => (
                  <button
                    class="wk-wizard-tpl-card"
                    classList={{ selected: template() === key }}
                    onClick={() => setTemplate(key)}
                  >
                    <div class="wk-wizard-tpl-icon">{tpl.icon}</div>
                    <div class="wk-wizard-tpl-label">{tpl.label}</div>
                    <div class="wk-wizard-tpl-desc">{tpl.desc}</div>
                    <Show when={key !== "custom" && template() === key}>
                      <div class="wk-wizard-tpl-cats">
                        <For each={(tpl as typeof TEMPLATES["ml"]).categories}>
                          {(cat) => <span class="wk-wizard-tpl-cat">{cat.icon} {cat.name}</span>}
                        </For>
                      </div>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="wk-wizard-footer">
            <button class="wk-wizard-btn-primary" disabled={!canProceedStep1()} onClick={() => setStep(2)}>
              Continue →
            </button>
          </div>
        </Show>

        {/* Step 2 — Intent */}
        <Show when={step() === 2}>
          <div class="wk-wizard-body">
            <h2 class="wk-wizard-title">What are you learning?</h2>
            <p class="wk-wizard-subtitle">One sentence describing your goal. This helps the AI curate content for you.</p>
            <textarea
              class="wk-wizard-textarea"
              placeholder="e.g. Master LLM agent architectures for building production-grade AI systems"
              rows={3}
              value={intent()}
              onInput={(e) => setIntent(e.currentTarget.value)}
              autofocus
            />
            <div class="wk-wizard-goals-label">Your goals <span class="wk-wizard-optional">(optional)</span></div>
            <For each={goals()}>
              {(g, i) => (
                <input
                  class="wk-wizard-input"
                  placeholder={`Goal ${i() + 1}…`}
                  value={g}
                  onInput={(e) => updateGoal(i(), e.currentTarget.value)}
                />
              )}
            </For>
          </div>
          <div class="wk-wizard-footer">
            <button class="wk-wizard-btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button class="wk-wizard-btn-primary" disabled={!canProceedStep2()} onClick={() => setStep(3)}>
              Continue →
            </button>
          </div>
        </Show>

        {/* Step 3 — Confirm / Custom categories */}
        <Show when={step() === 3}>
          <div class="wk-wizard-body">
            <Show when={template() === "custom"} fallback={
              <>
                <h2 class="wk-wizard-title">Ready to go!</h2>
                <p class="wk-wizard-subtitle">Your knowledge base will be created with these categories:</p>
                <div class="wk-wizard-confirm-cats">
                  <For each={(TEMPLATES[template()] as typeof TEMPLATES["ml"]).categories ?? []}>
                    {(cat) => (
                      <div class="wk-wizard-confirm-cat">
                        <span class="wk-wizard-confirm-icon">{cat.icon}</span>
                        <div>
                          <div class="wk-wizard-confirm-name">{cat.name}</div>
                          <div class="wk-wizard-confirm-desc">{cat.description}</div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </>
            }>
              <h2 class="wk-wizard-title">Define your categories</h2>
              <p class="wk-wizard-subtitle">Add the knowledge areas you want to track.</p>
              <div class="wk-wizard-custom-cats">
                <For each={customCats()}>
                  {(cat, i) => (
                    <div class="wk-wizard-custom-row">
                      <input
                        class="wk-wizard-input wk-wizard-input--icon"
                        placeholder="emoji"
                        maxLength={2}
                        value={cat.icon}
                        onInput={(e) => updateCat(i(), "icon", e.currentTarget.value)}
                      />
                      <input
                        class="wk-wizard-input wk-wizard-input--grow"
                        placeholder={`Category name…`}
                        value={cat.name}
                        onInput={(e) => updateCat(i(), "name", e.currentTarget.value)}
                      />
                      <Show when={customCats().length > 1}>
                        <button class="wk-wizard-remove-btn" onClick={() => removeCat(i())}>✕</button>
                      </Show>
                    </div>
                  )}
                </For>
                <button class="wk-wizard-add-cat" onClick={addCat}>+ Add category</button>
              </div>
            </Show>

            <Show when={error()}>
              <div class="wk-wizard-error">{error()}</div>
            </Show>
          </div>
          <div class="wk-wizard-footer">
            <button class="wk-wizard-btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <button
              class="wk-wizard-btn-primary"
              disabled={!canSubmit() || submitting()}
              onClick={submit}
            >
              {submitting() ? "Creating…" : "Set up Knowledge Base ✓"}
            </button>
          </div>
        </Show>
      </div>
    </div>
  )
}

// ── Empty state for graph panel ───────────────────────────────────────────────

function GraphEmptyState(props: { onGetStarted: () => void }) {
  return (
    <div class="wk-graph-empty">
      <div class="wk-graph-empty-icon">🧠</div>
      <div class="wk-graph-empty-title">Your knowledge graph is empty</div>
      <div class="wk-graph-empty-desc">Set up your KB structure to start organising what you learn</div>
      <button class="wk-graph-empty-btn" onClick={props.onGetStarted}>
        Get Started
      </button>
    </div>
  )
}

// ── Navigation helpers ────────────────────────────────────────────────────────

function pageNavSlug(page: WikiPageSummary): string {
  if (!page.subcategory_slug) return page.category_slug ?? page.slug
  return `${page.category_slug}--${page.subcategory_slug}`
}

function pageLabel(page: WikiPageSummary): string {
  if (!page.subcategory_slug) return "Overview"
  return page.title
}

function sortedPages(pages: WikiPageSummary[]): WikiPageSummary[] {
  return [...pages]
    .filter((p) => p.page_type !== "index")
    .sort((a, b) => {
      if (!a.subcategory_slug) return -1
      if (!b.subcategory_slug) return 1
      return a.title.localeCompare(b.title)
    })
}

// ── Collapsible sub-category row ─────────────────────────────────────────────
function SidebarSubcat(props: {
  cat: WikiCategory
  openIds: Set<string>
  onToggle: (id: string) => void
  onNavigate: (slug: string) => void
  indent: number
}) {
  const isOpen = () => props.openIds.has(props.cat.id)
  const pages = () => sortedPages(props.cat.pages)

  return (
    <div class="wk-tree-subcat" style={{ "padding-left": `${props.indent}px` }}>
      <div class="wk-tree-row wk-tree-row--subcat">
        <span class="wk-tree-toggle" onClick={() => props.onToggle(props.cat.id)}>
          {isOpen() ? "▾" : "▸"}
        </span>
        <span class="wk-tree-label wk-tree-label--subcat" onClick={() => props.onNavigate(props.cat.slug)}>
          {props.cat.name || props.cat.slug}
        </span>
      </div>
      <Show when={isOpen()}>
        <div class="wk-tree-children">
          <For each={pages()}>
            {(page) => (
              <div
                class="wk-tree-leaf"
                style={{ "padding-left": `${props.indent + 16}px` }}
                onClick={() => props.onNavigate(pageNavSlug(page))}
              >
                {pageLabel(page)}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Collapsible top-level category row ───────────────────────────────────────
function SidebarCategory(props: {
  cat: WikiCategory
  subcats: WikiCategory[]
  openIds: Set<string>
  onToggle: (id: string) => void
  onNavigate: (slug: string) => void
}) {
  const isOpen = () => props.openIds.has(props.cat.id)
  const pages = () => sortedPages(props.cat.pages)

  return (
    <div class="wk-tree-cat">
      <div class="wk-tree-row">
        <span class="wk-tree-toggle" onClick={() => props.onToggle(props.cat.id)}>
          {isOpen() ? "▾" : "▸"}
        </span>
        <span class="wk-tree-label" onClick={() => props.onNavigate(props.cat.slug)}>
          {props.cat.name || props.cat.slug}
        </span>
      </div>
      <Show when={isOpen()}>
        <div class="wk-tree-children">
          <For each={pages()}>
            {(page) => (
              <div class="wk-tree-leaf" style={{ "padding-left": "16px" }} onClick={() => props.onNavigate(pageNavSlug(page))}>
                {pageLabel(page)}
              </div>
            )}
          </For>
          <For each={props.subcats}>
            {(sub) => (
              <SidebarSubcat
                cat={sub}
                openIds={props.openIds}
                onToggle={props.onToggle}
                onNavigate={props.onNavigate}
                indent={16}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Category card (main grid) ─────────────────────────────────────────────────
function CategoryCard(props: {
  cat: WikiCategory
  subcats: WikiCategory[]
  paletteIndex: number
  onNavigate: (slug: string) => void
}) {
  const palette = () => SUBCAT_PALETTES[props.paletteIndex % SUBCAT_PALETTES.length]

  return (
    <div class="wk-card">
      <div class="wk-card-header" onClick={() => props.onNavigate(props.cat.slug)}>
        <div class="wk-card-title">{props.cat.name || props.cat.slug}</div>
        <div class="wk-card-desc">{props.cat.description}</div>
      </div>
      <Show when={props.subcats.length > 0}>
        <div class="wk-card-subcats">
          <For each={props.subcats}>
            {(sub) => (
              <span
                class="wk-card-subcat-chip"
                style={{
                  background: palette().bg,
                  border: `1px solid ${palette().border}`,
                  color: palette().text,
                }}
                onClick={(e) => { e.stopPropagation(); props.onNavigate(sub.slug) }}
              >
                {sub.name || sub.slug}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WikiHome() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [graphWidth, setGraphWidth] = createSignal(45)
  const [openIds, setOpenIds] = createSignal<Set<string>>(new Set())
  const [showWizard, setShowWizard] = createSignal(false)
  let contentAreaRef: HTMLDivElement | undefined

  const [data, { refetch }] = createResource(() => api.home())

  const go = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const toggleId = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const topLevelCats = createMemo(() =>
    (data()?.categories ?? []).filter((c) => !c.parent_category_id)
  )

  const subcatsByParent = createMemo(() => {
    const map = new Map<string, WikiCategory[]>()
    for (const c of data()?.categories ?? []) {
      if (!c.parent_category_id) continue
      const list = map.get(c.parent_category_id) ?? []
      list.push(c)
      map.set(c.parent_category_id, list)
    }
    return map
  })

  const isEmpty = createMemo(() => !data.loading && (data.error || (data()?.categories ?? []).length === 0))

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })

  const updatedDate = () => {
    const events = data()?.recent_events
    if (!events || events.length === 0) return "—"
    return formatDate(events[0].time_created)
  }

  const onDividerMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (e: MouseEvent) => {
      if (!contentAreaRef) return
      const rect = contentAreaRef.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const gw = ((rect.width - mouseX) / rect.width) * 100
      setGraphWidth(Math.max(35, Math.min(55, gw)))
    }

    const onMouseUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  const handleOnboardComplete = () => {
    setShowWizard(false)
    refetch()
  }

  return (
    <div class="wk-root">
      {/* Onboarding wizard overlay */}
      <Show when={showWizard()}>
        <OnboardingWizard onComplete={handleOnboardComplete} />
      </Show>

      <div class="wk-layout">

        {/* ── Sidebar ── */}
        <aside class={`wk-sidebar${sidebarOpen() ? "" : " wk-sidebar--collapsed"}`}>
          <div class="wk-sb-top">
            <Show when={sidebarOpen()}>
              <span class="wk-logo wk-sb-logo" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
            </Show>
            <button
              class="wk-sb-collapse-btn"
              title={sidebarOpen() ? "Collapse sidebar" : "Expand sidebar"}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              {sidebarOpen() ? "◀" : "▶"}
            </button>
          </div>

          <Show when={sidebarOpen()}>
            <div class="wk-sb-nav">
              <Show when={data()}>
                {(_d) => (
                  <>
                    <div class="wk-sb-label" style={{ "margin-top": "4px" }}>Categories</div>
                    <div class="wk-tree">
                      <For each={topLevelCats()}>
                        {(cat) => (
                          <SidebarCategory
                            cat={cat}
                            subcats={subcatsByParent().get(cat.id) ?? []}
                            openIds={openIds()}
                            onToggle={toggleId}
                            onNavigate={go}
                          />
                        )}
                      </For>
                    </div>
                  </>
                )}
              </Show>
            </div>

            <div class="wk-sb-bottom">
              <div class="wk-sb-label">Docs</div>
              <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>
              <Show when={data()}>
                <>
                  <div class="wk-sb-label" style={{ "margin-top": "6px" }}>Stats</div>
                  <div class="wk-sb-stat">{data()!.stats.total_pages} pages</div>
                  <div class="wk-sb-stat">{data()!.stats.total_sources} sources</div>
                  <div class="wk-sb-stat">Updated {updatedDate()}</div>
                </>
              </Show>
            </div>
          </Show>
        </aside>

        {/* ── Content area ── */}
        <div class="wk-content-area" ref={contentAreaRef}>

          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading…</div>
            </Show>

            <Show when={!data.loading}>
              <>
                <h1 class="wk-title">Welcome to Supadense Wiki</h1>
                <p class="wk-subtitle">Your Knowledge base for Tech</p>

                <Show when={topLevelCats().length > 0} fallback={
                  <div class="wk-empty-main">
                    <div class="wk-empty-main-icon">📚</div>
                    <div class="wk-empty-main-title">No categories yet</div>
                    <div class="wk-empty-main-desc">
                      Use the Get Started button in the graph panel, or click below to set up your knowledge base.
                    </div>
                    <button class="wk-empty-main-btn" onClick={() => setShowWizard(true)}>
                      Get Started
                    </button>
                  </div>
                }>
                  <div class="wk-section-label">Browse by category</div>
                  <div class="wk-grid">
                    <For each={topLevelCats()}>
                      {(cat, i) => (
                        <CategoryCard
                          cat={cat}
                          subcats={subcatsByParent().get(cat.id) ?? []}
                          paletteIndex={i()}
                          onNavigate={go}
                        />
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={(data()?.recent_events?.length ?? 0) > 0}>
                  <div class="wk-section-label" style={{ "margin-top": "28px" }}>Recent activity</div>
                  <ul class="wk-activity-list">
                    <For each={data()!.recent_events.slice(0, 5)}>
                      {(ev) => (
                        <li class="wk-activity-item">
                          <span class="wk-activity-dot" data-type={ev.event_type} />
                          <span class="wk-activity-summary">{ev.summary}</span>
                          <span class="wk-activity-date">{formatDate(ev.time_created)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </>
            </Show>
          </main>

          <Show when={!data.loading}>
            <div class="wk-resize-divider" onMouseDown={onDividerMouseDown} />
          </Show>

          {/* Graph panel — shown once initial load completes (whether data or error) */}
          <Show when={!data.loading}>
            <aside class="wk-graph-panel" style={{ width: `${graphWidth()}%` }}>
              <div class="wk-graph-header">
                <span class="wk-graph-title">Knowledge Graph</span>
                <Show when={isEmpty()}>
                  <button class="wk-graph-header-btn" onClick={() => setShowWizard(true)}>
                    Get Started
                  </button>
                </Show>
              </div>
              <div class="wk-graph-body">
                <Show when={isEmpty()} fallback={
                  <WikiGraph data={data()!.graph_data} onNavigate={go} />
                }>
                  <GraphEmptyState onGetStarted={() => setShowWizard(true)} />
                </Show>
              </div>
              <Show when={!isEmpty()}>
                <div class="wk-graph-legend">
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#6366f1" }} />Category</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#a5b4fc" }} />Section</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#f59e0b" }} />Group</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#cbd5e1" }} />Resource</span>
                </div>
              </Show>
            </aside>
          </Show>

        </div>
      </div>
    </div>
  )
}
