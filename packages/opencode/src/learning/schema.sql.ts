import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

// ─── Resources ───────────────────────────────────────────────────────────────
// Every ingested resource — URL, PDF, YouTube, text paste, image, LinkedIn post.
// Primary input table. modality-specific extra data stored in metadata JSON.

export const LearningResourceTable = sqliteTable(
  "learning_resources",
  {
    id: text().primaryKey(),
    workspace_id: text(),
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
    added_at: integer()
      .notNull()
      .$default(() => Date.now()),
    ...Timestamps,
  },
  (t) => [
    index("learning_resources_workspace_idx").on(t.workspace_id),
    index("learning_resources_status_idx").on(t.status),
  ],
)


