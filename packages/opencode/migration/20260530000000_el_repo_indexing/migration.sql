-- Add repo indexing columns to el_projects
ALTER TABLE el_projects ADD COLUMN repo_local_path TEXT;
ALTER TABLE el_projects ADD COLUMN repo_branch TEXT;
ALTER TABLE el_projects ADD COLUMN clone_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE el_projects ADD COLUMN clone_error TEXT;
ALTER TABLE el_projects ADD COLUMN supadense_init TEXT NOT NULL DEFAULT 'none';
ALTER TABLE el_projects ADD COLUMN cloned_at INTEGER;
ALTER TABLE el_projects ADD COLUMN indexed_at INTEGER;

-- Directory nodes indexed from the cloned repo
CREATE TABLE IF NOT EXISTS el_project_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES el_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  parent_path TEXT,
  node_type TEXT NOT NULL DEFAULT 'directory',
  file_count INTEGER NOT NULL DEFAULT 0,
  total_file_count INTEGER NOT NULL DEFAULT 0,
  files_json TEXT NOT NULL DEFAULT '[]',
  key_files TEXT NOT NULL DEFAULT '[]',
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS el_project_nodes_project_idx ON el_project_nodes(project_id);
CREATE INDEX IF NOT EXISTS el_project_nodes_depth_idx ON el_project_nodes(project_id, depth);
