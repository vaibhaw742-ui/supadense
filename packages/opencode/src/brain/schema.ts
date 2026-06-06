export const BRAIN_SCHEMA_SQL = /* sql */ `

-- 1. Sources
CREATE TABLE IF NOT EXISTS brain_sources (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  local_path   TEXT,
  last_sync_at TIMESTAMPTZ,
  config       JSONB NOT NULL DEFAULT '{}'
);

-- 2. Pages (one per .md file)
CREATE TABLE IF NOT EXISTS brain_pages (
  id                SERIAL PRIMARY KEY,
  source_id         TEXT NOT NULL REFERENCES brain_sources(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  layer             INT  NOT NULL DEFAULT 0,
  type              TEXT NOT NULL DEFAULT 'note',
  title             TEXT,
  compiled_truth    TEXT,
  frontmatter       JSONB NOT NULL DEFAULT '{}',
  content_hash      TEXT,
  last_retrieved_at TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, slug)
);
CREATE INDEX IF NOT EXISTS brain_pages_layer_idx       ON brain_pages(layer) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS brain_pages_type_idx        ON brain_pages(type)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS brain_pages_source_idx      ON brain_pages(source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS brain_pages_hash_idx        ON brain_pages(content_hash) WHERE deleted_at IS NULL;

-- 3. Chunks (text + pgvector embeddings)
CREATE TABLE IF NOT EXISTS brain_chunks (
  id          SERIAL PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text  TEXT    NOT NULL,
  embedding   vector(1536),
  search_vec  TSVECTOR,
  embedded_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS brain_chunks_embedding_idx
  ON brain_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
CREATE INDEX IF NOT EXISTS brain_chunks_search_idx
  ON brain_chunks USING GIN (search_vec)
  WHERE search_vec IS NOT NULL;
CREATE INDEX IF NOT EXISTS brain_chunks_stale_idx
  ON brain_chunks(page_id) WHERE embedding IS NULL;

-- Auto-build search_vec trigger
CREATE OR REPLACE FUNCTION brain_chunks_search_vec_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vec := to_tsvector('english', COALESCE(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_chunks_search_vec_trg ON brain_chunks;
CREATE TRIGGER brain_chunks_search_vec_trg
  BEFORE INSERT OR UPDATE OF chunk_text ON brain_chunks
  FOR EACH ROW EXECUTE FUNCTION brain_chunks_search_vec_update();

-- 4. Links (typed edges)
CREATE TABLE IF NOT EXISTS brain_links (
  id           SERIAL PRIMARY KEY,
  from_page_id INTEGER NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  to_page_id   INTEGER NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  link_type    TEXT NOT NULL DEFAULT 'mentions',
  link_source  TEXT NOT NULL DEFAULT 'markdown',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_links_from_idx ON brain_links(from_page_id);
CREATE INDEX IF NOT EXISTS brain_links_to_idx   ON brain_links(to_page_id);

-- 5. Tags
CREATE TABLE IF NOT EXISTS brain_tags (
  id      SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  UNIQUE(page_id, tag)
);

-- 6. Timeline entries
CREATE TABLE IF NOT EXISTS brain_timeline (
  id         SERIAL PRIMARY KEY,
  page_id    INTEGER NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  date       DATE    NOT NULL,
  source     TEXT    NOT NULL DEFAULT 'manual',
  summary    TEXT,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(page_id, date, summary, source)
);

-- 7. Aliases (for alias-hop in search)
CREATE TABLE IF NOT EXISTS brain_aliases (
  id         SERIAL PRIMARY KEY,
  source_id  TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  slug       TEXT NOT NULL,
  UNIQUE(source_id, alias_norm, slug)
);
CREATE INDEX IF NOT EXISTS brain_aliases_lookup_idx ON brain_aliases(source_id, alias_norm);

-- 8. Query cache
CREATE TABLE IF NOT EXISTS brain_query_cache (
  id         SERIAL PRIMARY KEY,
  query_hash TEXT        NOT NULL,
  source_id  TEXT        NOT NULL,
  knobs_hash TEXT        NOT NULL,
  layer_mode TEXT,
  results    JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(query_hash, source_id, knobs_hash)
);
CREATE INDEX IF NOT EXISTS brain_query_cache_lookup_idx
  ON brain_query_cache(query_hash, source_id, knobs_hash, expires_at);

-- 9. Generation clock (cache invalidation)
CREATE TABLE IF NOT EXISTS brain_gen_clock (
  id    INT  PRIMARY KEY DEFAULT 1,
  value BIGINT NOT NULL DEFAULT 0
);
INSERT INTO brain_gen_clock VALUES (1, 0) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION bump_brain_gen_clock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE brain_gen_clock SET value = value + 1 WHERE id = 1;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS brain_page_change_trg ON brain_pages;
CREATE TRIGGER brain_page_change_trg
  AFTER INSERT OR UPDATE OR DELETE ON brain_pages
  FOR EACH STATEMENT EXECUTE FUNCTION bump_brain_gen_clock();

-- 11. Session→Brain bridge (links SQLite session IDs to Postgres brain nodes)
--     session_id is a foreign key by convention only (lives in SQLite, not Postgres)
CREATE TABLE IF NOT EXISTS session_brain_contributions (
  id                SERIAL PRIMARY KEY,
  session_id        TEXT        NOT NULL,
  brain_page_id     INTEGER     NOT NULL REFERENCES brain_pages(id) ON DELETE CASCADE,
  contribution_type TEXT        NOT NULL DEFAULT 'capture',
  -- 'capture'    → user captured a note during session
  -- 'synthesis'  → session triggered LLM synthesis (L1/L2 node)
  -- 'git_event'  → session ran capture-git-events
  -- 'analyze'    → session ran analyze-repo
  contributed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS session_brain_unique_idx
  ON session_brain_contributions(session_id, brain_page_id);
CREATE INDEX IF NOT EXISTS session_brain_session_idx  ON session_brain_contributions(session_id);
CREATE INDEX IF NOT EXISTS session_brain_page_idx     ON session_brain_contributions(brain_page_id);

-- 10. Access log (recency boost + promote signal)
CREATE TABLE IF NOT EXISTS brain_access_log (
  id          SERIAL PRIMARY KEY,
  slug        TEXT        NOT NULL,
  query       TEXT,
  layer       INT         NOT NULL DEFAULT 0,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brain_access_log_slug_idx ON brain_access_log(slug, accessed_at);

`
