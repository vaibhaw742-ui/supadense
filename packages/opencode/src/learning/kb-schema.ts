/**
 * kb-schema.ts — Per-workspace schema management.
 *
 * The schema defines the full structure of a KB:
 *   categories → subcategories → sections (with extraction guidance)
 *
 * Source of truth: learning_categories + learning_wiki_pages.sections (DB)
 * Generated artifact: schema.json (on disk, git-tracked, chat-only edits)
 *
 * schema.json is rebuilt whenever the structure changes — same contract as
 * supadense.md and log.md.
 */
import path from "path"
import { writeFileSync } from "fs"
import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningKbSchemaTable,
  LearningKbWorkspaceTable,
  LearningCategoryTable,
  LearningWikiPageTable,
} from "./schema.sql"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchemaSection {
  slug: string
  heading: string
  description: string // extraction guidance for KBCurator
}

export interface SchemaSubcategory {
  slug: string
  name: string
  sections: SchemaSection[]
}

export interface SchemaCategory {
  slug: string
  name: string
  depth: string
  icon?: string
  sections: SchemaSection[]
  subcategories: SchemaSubcategory[]
}

export interface SchemaContent {
  version: number
  generated_at: string
  categories: SchemaCategory[]
}

// ─── Default sections ────────────────────────────────────────────────────────
// Applied to every new category and subcategory page automatically.

export const DEFAULT_SECTIONS: SchemaSection[] = [
  {
    slug: "key-concepts",
    heading: "## Key Concepts",
    description:
      "Core concepts, definitions, and terminology introduced by this resource. Use bullet points: **Term** — definition.",
  },
]

// ─── Default subcategory structure ───────────────────────────────────────────
// Applied to every category during onboarding. Can be evolved per-workspace
// via chat after setup.

export const DEFAULT_SUBCATEGORIES: SchemaSubcategory[] = [
  {
    slug: "key-concepts",
    name: "Key Concepts",
    sections: [
      {
        slug: "overview",
        heading: "## Overview",
        description:
          "High-level summary of what this resource covers in this topic area. 1-3 sentences. What is the main idea and why does it matter?",
      },
      {
        slug: "definitions",
        heading: "## Definitions",
        description:
          "Define key terms, concepts, and techniques introduced. Use bullet points: **Term** — definition.",
      },
      {
        slug: "mental-models",
        heading: "## Mental Models",
        description:
          "Intuitions, analogies, and ways to think about this topic. How does it connect to things already known?",
      },
    ],
  },
  {
    slug: "papers",
    name: "Papers & Research",
    sections: [
      {
        slug: "summary",
        heading: "## Summary",
        description: "Main contribution in 3-5 sentences. What problem does it solve? What is the key result?",
      },
      {
        slug: "findings",
        heading: "## Key Findings",
        description: "Bullet the most important results, numbers, and insights from this work.",
      },
      {
        slug: "limitations",
        heading: "## Limitations",
        description: "Known limitations, caveats, or open questions raised by this work.",
      },
    ],
  },
  {
    slug: "examples",
    name: "Examples & Implementations",
    sections: [
      {
        slug: "walkthrough",
        heading: "## Walkthrough",
        description: "Step-by-step explanation of a concrete implementation or use case.",
      },
      {
        slug: "code",
        heading: "## Code Snippets",
        description: "Relevant code examples. Use fenced code blocks with language tags.",
      },
    ],
  },
  {
    slug: "tools",
    name: "Tools & Frameworks",
    sections: [
      {
        slug: "overview",
        heading: "## Overview",
        description: "What this tool does, when to use it, and how it compares to alternatives.",
      },
      {
        slug: "usage",
        heading: "## Usage",
        description: "How to install, configure, and use this tool. Include minimal working examples.",
      },
    ],
  },
]

// ─── KbSchema namespace ───────────────────────────────────────────────────────

export namespace KbSchema {
  type SchemaRow = typeof LearningKbSchemaTable.$inferSelect

  /** Get the schema metadata row for a workspace (null if not yet created). */
  export function get(workspaceId: string): SchemaRow | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbSchemaTable).where(eq(LearningKbSchemaTable.workspace_id, workspaceId)).get(),
    )
  }

  /** Ensure the schema metadata row exists. Idempotent. */
  export function ensure(workspaceId: string): SchemaRow {
    const existing = get(workspaceId)
    if (existing) return existing
    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningKbSchemaTable).values({ id, workspace_id: workspaceId, version: 1, time_created: now, time_updated: now }).run(),
    )
    return get(workspaceId)!
  }

  /** Bump the version counter (call after any structural change). */
  export function bumpVersion(workspaceId: string): void {
    const schema = get(workspaceId)
    if (!schema) return
    Database.use((db) =>
      db
        .update(LearningKbSchemaTable)
        .set({ version: schema.version + 1, time_updated: Date.now() })
        .where(eq(LearningKbSchemaTable.workspace_id, workspaceId))
        .run(),
    )
  }

  /**
   * Assemble the full schema content from the DB tables.
   * Reads learning_categories + learning_wiki_pages (category + subcategory pages with sections).
   */
  export function buildContent(workspaceId: string): SchemaContent {
    const schema = get(workspaceId)
    const categories = Database.use((db) =>
      db
        .select()
        .from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.workspace_id, workspaceId))
        .all(),
    )
    const allPages = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(
          and(
            eq(LearningWikiPageTable.workspace_id, workspaceId),
            // include both category and subcategory pages
          ),
        )
        .all(),
    )
    const catPages = allPages.filter((p) => p.page_type === "category")
    const subcatPages = allPages.filter((p) => p.page_type === "subcategory")

    return {
      version: schema?.version ?? 1,
      generated_at: new Date().toISOString(),
      categories: categories
        .sort((a, b) => a.position - b.position)
        .map((cat) => {
          const catPage = catPages.find((p) => p.category_slug === cat.slug)
          return {
            slug: cat.slug,
            name: cat.name,
            depth: cat.depth,
            icon: cat.icon ?? undefined,
            sections: (catPage?.sections ?? []).map((s) => ({
              slug: s.slug,
              heading: s.heading,
              description: s.description ?? "",
            })),
            subcategories: subcatPages
              .filter((p) => p.category_slug === cat.slug)
              .map((p) => ({
                slug: p.subcategory_slug!,
                name: p.title.split(" — ")[1] ?? p.subcategory_slug!,
                sections: (p.sections ?? []).map((s) => ({
                  slug: s.slug,
                  heading: s.heading,
                  description: s.description ?? "",
                })),
              })),
          }
        }),
    }
  }

  /**
   * Render schema.json to disk from current DB state.
   * Call after any structural change (add/remove category, subcategory, section).
   */
  export function renderToFile(workspaceId: string): void {
    const workspace = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, workspaceId)).get(),
    )
    if (!workspace) return

    const schema = ensure(workspaceId)
    const content = buildContent(workspaceId)
    const filePath = path.join(workspace.kb_path, schema.schema_path)
    writeFileSync(
      filePath,
      JSON.stringify(content, null, 2) + "\n",
      "utf8",
    )
  }
}
