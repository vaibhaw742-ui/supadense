-- Make workspace_id nullable on learning_resources so EL project resources
-- don't need a virtual learning_kb_workspaces row.
-- SQLite does not support DROP NOT NULL directly; recreate the table.
CREATE TABLE IF NOT EXISTS learning_resources_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES learning_kb_workspaces(id) ON DELETE CASCADE,
  url TEXT,
  title TEXT,
  author TEXT,
  modality TEXT NOT NULL,
  raw_content TEXT,
  raw_content_path TEXT,
  summary TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_step TEXT,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  published_at INTEGER,
  added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  time_created INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
INSERT INTO learning_resources_new SELECT * FROM learning_resources;
DROP TABLE learning_resources;
ALTER TABLE learning_resources_new RENAME TO learning_resources;
CREATE INDEX IF NOT EXISTS learning_resources_workspace_idx ON learning_resources(workspace_id);
CREATE INDEX IF NOT EXISTS learning_resources_status_idx ON learning_resources(status);
