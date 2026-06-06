-- Add AI cluster suggestion column to resources
ALTER TABLE learning_resources ADD COLUMN ai_cluster_suggestion text;
--> statement-breakpoint

-- Cluster entity table
CREATE TABLE IF NOT EXISTS learning_clusters (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES learning_kb_workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_clusters_workspace_idx ON learning_clusters(workspace_id);
--> statement-breakpoint

-- Resource ↔ Cluster join table
CREATE TABLE IF NOT EXISTS learning_resource_clusters (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  cluster_id text NOT NULL REFERENCES learning_clusters(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'user',
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_rc_resource_idx ON learning_resource_clusters(resource_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_rc_cluster_idx ON learning_resource_clusters(cluster_id);
