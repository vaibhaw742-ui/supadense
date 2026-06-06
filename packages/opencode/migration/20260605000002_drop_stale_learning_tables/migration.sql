DROP TABLE IF EXISTS learning_resource_clusters;
DROP TABLE IF EXISTS learning_clusters;
DROP TABLE IF EXISTS learning_concepts;
DROP TABLE IF EXISTS learning_media_assets;
DROP TABLE IF EXISTS learning_resources_new;
DROP TABLE IF EXISTS learning_kb_workspaces_real_bak;

-- Recreate learning_resources without FK to dropped learning_kb_workspaces
PRAGMA foreign_keys=OFF;
CREATE TABLE IF NOT EXISTS learning_resources_clean (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  url TEXT, title TEXT, author TEXT,
  modality TEXT NOT NULL,
  raw_content TEXT, summary TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  relevance_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_step TEXT, error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  published_at INTEGER,
  added_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  time_created INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  time_updated INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  raw_content_path TEXT,
  ai_cluster_suggestion TEXT
);
INSERT OR IGNORE INTO learning_resources_clean SELECT * FROM learning_resources;
DROP TABLE IF EXISTS learning_resources;
ALTER TABLE learning_resources_clean RENAME TO learning_resources;
CREATE INDEX IF NOT EXISTS learning_resources_workspace_idx ON learning_resources(workspace_id);
CREATE INDEX IF NOT EXISTS learning_resources_status_idx ON learning_resources(status);
PRAGMA foreign_keys=ON;
