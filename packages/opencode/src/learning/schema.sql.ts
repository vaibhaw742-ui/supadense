import { sqliteTable, text, integer, real, index, primaryKey } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

// ─── KB Schema ───────────────────────────────────────────────────────────────
// Per-workspace schema metadata. One row per workspace.
// The full structure (categories → subcategories → sections) lives in:
//   learning_categories + learning_wiki_pages.sections
// This table tracks the schema version and the path to the generated schema.json.

export const LearningKbSchemaTable = sqliteTable("learning_kb_schema", {
  id: text().primaryKey(),
  workspace_id: text()
    .notNull()
    .unique()
    .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
  schema_path: text().notNull().default("schema.json"), // relative to kb_path
  version: integer().notNull().default(1), // bumped on every structural change
  ...Timestamps,
})

// ─── KB Workspaces ───────────────────────────────────────────────────────────
// One row per project folder. Root anchor for everything in the learning schema.
// Every other table filters by workspace_id from here.
// Corresponds to supadense.md in the project folder.

export const LearningKbWorkspaceTable = sqliteTable("learning_kb_workspaces", {
  id: text().primaryKey(),
  project_id: text().notNull().unique(), // matches opencode project id
  kb_path: text().notNull(), // absolute path to project folder on disk
  kb_initialized: integer({ mode: "boolean" }).notNull().default(false),
  learning_intent: text(), // "Build production-grade AI agent systems"
  goals: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  gaps: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  depth_prefs: text({ mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  trusted_sources: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  scout_platforms: text({ mode: "json" }).$type<string[]>().notNull().default([]),
  extra_folders: text({ mode: "json" }).$type<string[]>().notNull().default([]), // ["papers", "experiments"]
  onboarded_at: integer(), // unix ms, null until onboarding complete
  ...Timestamps,
})

// ─── Categories ──────────────────────────────────────────────────────────────
// Top-level knowledge domains chosen during onboarding.
// Each row = wiki/<slug>.md category page on disk.

export const LearningCategoryTable = sqliteTable(
  "learning_categories",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    slug: text().notNull(), // "agents", "rag", "engineering"
    name: text().notNull(), // "Agents", "RAG", "Engineering"
    description: text(),
    depth: text().notNull().default("working"), // "deep" | "working" | "awareness"
    color: text(), // "#6366f1" — optional UI color
    icon: text(), // "🤖" — optional emoji
    position: integer().notNull().default(0),
    ...Timestamps,
  },
  (t) => [index("learning_categories_workspace_idx").on(t.workspace_id)],
)

// ─── Wiki Pages ───────────────────────────────────────────────────────────────
// Every .md file in the wiki/ folder has exactly one row here.
// page_type: "index"      → wiki/index.md
// page_type: "category"   → wiki/agents.md
// page_type: "subcategory"→ wiki/agents--key-concepts.md
// The -- separator appears ONLY in file_path, nowhere else in the DB.

export const LearningWikiPageTable = sqliteTable(
  "learning_wiki_pages",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    category_id: text().references(() => LearningCategoryTable.id, { onDelete: "cascade" }),
    parent_page_id: text(), // self-ref: NULL for index/category, points to category page for subcategory
    page_type: text().notNull(), // "index" | "category" | "subcategory"
    category_slug: text(), // "agents" — clean, no separator
    subcategory_slug: text(), // "key-concepts" — NULL for index/category pages
    slug: text().notNull(), // "index" | "agents" | "key-concepts" (clean, no --)
    title: text().notNull(), // "Knowledge Base Index" | "Agents" | "Agents — Key Concepts"
    file_path: text().notNull(), // "wiki/index.md" | "wiki/agents.md" | "wiki/agents--key-concepts.md"
    description: text(),
    sections: text({ mode: "json" })
      .$type<{ slug: string; heading: string; description?: string; updated_at?: number }[]>()
      .notNull()
      .default([]),
    resource_count: integer().notNull().default(0),
    word_count: integer().notNull().default(0),
    last_built_at: integer(), // unix ms
    ...Timestamps,
  },
  (t) => [
    index("learning_wiki_pages_workspace_idx").on(t.workspace_id),
    index("learning_wiki_pages_category_idx").on(t.category_id),
    index("learning_wiki_pages_parent_idx").on(t.parent_page_id),
  ],
)

// ─── Resources ───────────────────────────────────────────────────────────────
// Every ingested resource — URL, PDF, YouTube, text paste, image, LinkedIn post.
// Primary input table. modality-specific extra data stored in metadata JSON.

export const LearningResourceTable = sqliteTable(
  "learning_resources",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    url: text(), // NULL for text pastes or local uploads
    title: text(),
    author: text(),
    modality: text().notNull(), // "url"|"pdf"|"youtube"|"text"|"image"|"linkedin"
    raw_content: text(), // legacy: full text stored in DB (kept for backward compat)
    raw_content_path: text(), // path to raw content file relative to kb_path, e.g. "raw/01KP....txt"
    summary: text(), // LLM-generated 3-5 sentence summary
    quality_score: real().notNull().default(0),
    relevance_score: real().notNull().default(0),
    status: text().notNull().default("pending"), // "pending"|"processing"|"done"|"failed"
    processing_step: text(), // current pipeline step name
    error: text(), // error message if status=failed
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    // stores modality-specific data:
    // linkedin → { author_name, author_title, likes, is_thread, thread_parts, ... }
    // youtube  → { channel, duration_seconds, transcript_available }
    // pdf      → { page_count, doi }
    // url      → { domain, estimated_read_time }
    published_at: integer(), // original publication date unix ms
    memorized_at: integer()
      .notNull()
      .$default(() => Date.now()),
    ...Timestamps,
  },
  (t) => [
    index("learning_resources_workspace_idx").on(t.workspace_id),
    index("learning_resources_status_idx").on(t.status),
  ],
)

// ─── Media Assets ─────────────────────────────────────────────────────────────
// Images, diagrams, charts extracted from resources.
// Saved locally in wiki/assets/. Each row = one image file on disk.

export const LearningMediaAssetTable = sqliteTable(
  "learning_media_assets",
  {
    id: text().primaryKey(),
    resource_id: text()
      .notNull()
      .references(() => LearningResourceTable.id, { onDelete: "cascade" }),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    asset_type: text().notNull(), // "image"|"diagram"|"chart"|"thumbnail"|"video_frame"
    source_url: text(), // original URL in source resource
    local_path: text().notNull(), // "wiki/assets/a1b2c3.png" relative to kb_path
    caption: text(),
    description: text(), // LLM-generated description of what image shows
    alt_text: text(),
    is_diagram: integer({ mode: "boolean" }).notNull().default(false),
    width: integer(),
    height: integer(),
    mime_type: text(), // "image/png" | "image/jpeg"
    ...Timestamps,
  },
  (t) => [index("learning_media_assets_resource_idx").on(t.resource_id)],
)

// ─── Resource Wiki Placements ─────────────────────────────────────────────────
// Most critical table. Records exactly what content from which resource was
// placed into which section of which wiki page.
// Source of truth for provenance, citations, and avoiding duplicate placements.

export const LearningResourceWikiPlacementTable = sqliteTable(
  "learning_resource_wiki_placements",
  {
    id: text().primaryKey(),
    resource_id: text()
      .notNull()
      .references(() => LearningResourceTable.id, { onDelete: "cascade" }),
    wiki_page_id: text()
      .notNull()
      .references(() => LearningWikiPageTable.id, { onDelete: "cascade" }),
    section_slug: text().notNull(), // "definitions" | "examples" | "key-papers"
    section_heading: text().notNull(), // "## Definitions" — exact heading in .md file
    extracted_content: text().notNull(), // the text chunk written into the .md file
    media_asset_ids: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    placement_position: integer().notNull().default(0), // ordering within section
    confidence: real().notNull().default(1.0), // 0.0–1.0 LLM confidence
    group_assignments: text("group_assignments"), // JSON GroupAssignment[] | null — null = ungrouped
    placed_at: integer()
      .notNull()
      .$default(() => Date.now()),
    ...Timestamps,
  },
  (t) => [
    index("learning_rwp_resource_idx").on(t.resource_id),
    index("learning_rwp_wiki_page_idx").on(t.wiki_page_id),
  ],
)

// ─── Wiki Cross References ─────────────────────────────────────────────────────
// Relationships between wiki pages.
// Written by cross_ref skill, rendered as ## Related Concepts sections.

export const LearningWikiCrossRefTable = sqliteTable(
  "learning_wiki_cross_refs",
  {
    id: text().primaryKey(),
    source_page_id: text()
      .notNull()
      .references(() => LearningWikiPageTable.id, { onDelete: "cascade" }),
    target_page_id: text()
      .notNull()
      .references(() => LearningWikiPageTable.id, { onDelete: "cascade" }),
    ref_type: text().notNull(), // "related"|"prerequisite"|"see-also"|"contrasts-with"
    description: text(), // why these pages are connected
    strength: real().notNull().default(1.0), // 0.0–1.0 relationship strength
    ...Timestamps,
  },
  (t) => [
    index("learning_wiki_cross_refs_source_idx").on(t.source_page_id),
    index("learning_wiki_cross_refs_target_idx").on(t.target_page_id),
  ],
)

// ─── Concepts ─────────────────────────────────────────────────────────────────
// Atomic knowledge units extracted by key_concepts skill.
// One row per concept, reused across resources — no duplication.

export const LearningConceptTable = sqliteTable(
  "learning_concepts",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    category_id: text().references(() => LearningCategoryTable.id), // primary category
    name: text().notNull(), // "ReAct Prompting"
    slug: text().notNull(), // "react-prompting"
    definition: text(), // one-line definition — sharpest version
    explanation: text(), // 2-5 sentence explanation
    aliases: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    related_slugs: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    first_seen_at: integer()
      .notNull()
      .$default(() => Date.now()),
    ...Timestamps,
  },
  (t) => [
    index("learning_concepts_workspace_idx").on(t.workspace_id),
    index("learning_concepts_category_idx").on(t.category_id),
  ],
)

// ─── Concept Wiki Placements ───────────────────────────────────────────────────
// Junction: concept ↔ wiki page. Which concepts appear on which pages.

export const LearningConceptWikiPlacementTable = sqliteTable(
  "learning_concept_wiki_placements",
  {
    concept_id: text()
      .notNull()
      .references(() => LearningConceptTable.id, { onDelete: "cascade" }),
    wiki_page_id: text()
      .notNull()
      .references(() => LearningWikiPageTable.id, { onDelete: "cascade" }),
    section_slug: text(), // which section this concept appears in
    introduced_by_resource_id: text().references(() => LearningResourceTable.id),
    ...Timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.concept_id, t.wiki_page_id] }),
    index("learning_cwp_wiki_page_idx").on(t.wiki_page_id),
  ],
)

// ─── Gaps ─────────────────────────────────────────────────────────────────────
// Knowledge gaps — declared during onboarding or auto-detected by find_gaps skill.
// Rendered into wiki/<category>--gaps.md

export const LearningGapTable = sqliteTable(
  "learning_gaps",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    category_id: text()
      .notNull()
      .references(() => LearningCategoryTable.id),
    title: text().notNull(), // "Multi-agent coordination not covered"
    description: text(),
    gap_type: text().notNull().default("declared"), // "declared"|"detected"|"resolved"
    detected_by: text().notNull(), // "onboarding"|"chat"|"find_gaps_skill"
    detected_from_resource_id: text().references(() => LearningResourceTable.id),
    resolved_at: integer(), // unix ms, NULL = still active gap
    ...Timestamps,
  },
  (t) => [
    index("learning_gaps_workspace_idx").on(t.workspace_id),
    index("learning_gaps_category_idx").on(t.category_id),
  ],
)

// ─── Roadmap Items ────────────────────────────────────────────────────────────
// Ordered learning roadmap per category.
// Generated by roadmap skill, rendered into wiki/<category>--roadmap.md

export const LearningRoadmapItemTable = sqliteTable(
  "learning_roadmap_items",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    category_id: text()
      .notNull()
      .references(() => LearningCategoryTable.id),
    title: text().notNull(), // "Read: Attention Is All You Need"
    description: text(),
    level: text().notNull(), // "beginner"|"intermediate"|"advanced"
    status: text().notNull().default("pending"), // "pending"|"in-progress"|"done"
    resource_id: text().references(() => LearningResourceTable.id),
    position: integer().notNull().default(0),
    ...Timestamps,
  },
  (t) => [
    index("learning_roadmap_workspace_idx").on(t.workspace_id),
    index("learning_roadmap_category_idx").on(t.category_id),
  ],
)

// ─── Skills ───────────────────────────────────────────────────────────────────
// Pipeline processing functions that run on resources.
// Built-in skills ship with the platform. Custom skills are user-created.
// Position determines execution order in the pipeline.

export const LearningSkillTable = sqliteTable("learning_skills", {
  id: text().primaryKey(),
  workspace_id: text().references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
  // NULL = global builtin, set = custom skill for specific workspace
  slug: text().notNull(), // "categorize" | "quality" | "fill_wiki"
  name: text().notNull(), // "Categorize" | "Quality Score" | "Fill Wiki"
  description: text(),
  skill_type: text().notNull(), // "builtin" | "custom"
  prompt_template: text(), // LLM prompt with {resource_content} placeholders
  output_schema: text({ mode: "json" }).$type<Record<string, unknown>>(),
  runs_on_modalities: text({ mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(["url", "pdf", "youtube", "text", "linkedin", "image"]),
  is_enabled: integer({ mode: "boolean" }).notNull().default(true),
  position: integer().notNull().default(0), // pipeline execution order
  ...Timestamps,
})

// ─── Resource Skill Results ───────────────────────────────────────────────────
// Immutable audit log of every skill run on every resource.
// Allows pipeline to skip already-completed skills and enables debugging.

export const LearningResourceSkillResultTable = sqliteTable(
  "learning_resource_skill_results",
  {
    id: text().primaryKey(),
    resource_id: text()
      .notNull()
      .references(() => LearningResourceTable.id, { onDelete: "cascade" }),
    skill_id: text()
      .notNull()
      .references(() => LearningSkillTable.id),
    status: text().notNull().default("pending"), // "pending"|"running"|"done"|"failed"|"skipped"
    input_snapshot: text({ mode: "json" }).$type<Record<string, unknown>>(),
    output: text({ mode: "json" }).$type<Record<string, unknown>>(),
    error: text(),
    tokens_used: integer().notNull().default(0),
    duration_ms: integer().notNull().default(0),
    ran_at: integer()
      .notNull()
      .$default(() => Date.now()),
    ...Timestamps,
  },
  (t) => [
    index("learning_rsr_resource_idx").on(t.resource_id),
    index("learning_rsr_skill_idx").on(t.skill_id),
  ],
)

// ─── KB Events ────────────────────────────────────────────────────────────────
// Machine-readable activity log. Every meaningful action gets a row.
// log.md is a human-readable render of this table — fully generated from it.

export const LearningKbEventTable = sqliteTable(
  "learning_kb_events",
  {
    id: text().primaryKey(),
    workspace_id: text()
      .notNull()
      .references(() => LearningKbWorkspaceTable.id, { onDelete: "cascade" }),
    event_type: text().notNull(),
    // "project_init"|"onboarding"|"memorize"|"wiki_update"|"wiki_build"
    // |"gap_detected"|"gap_resolved"|"concept_added"|"concept_merged"
    // |"roadmap_update"|"note_added"|"category_added"
    resource_id: text().references(() => LearningResourceTable.id),
    wiki_page_id: text().references(() => LearningWikiPageTable.id),
    payload: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    summary: text().notNull(), // human-readable → written into log.md
    ...Timestamps,
  },
  (t) => [
    index("learning_kb_events_workspace_idx").on(t.workspace_id),
    index("learning_kb_events_type_idx").on(t.event_type),
  ],
)
