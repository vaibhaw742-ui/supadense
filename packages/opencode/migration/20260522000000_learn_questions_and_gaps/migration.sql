-- AI-generated learn questions cache per resource
CREATE TABLE IF NOT EXISTS learning_resource_questions (
  id text PRIMARY KEY,
  resource_id text NOT NULL REFERENCES learning_resources(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES learning_kb_workspaces(id) ON DELETE CASCADE,
  questions text NOT NULL DEFAULT '[]',
  content_hash text NOT NULL,
  generated_at integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_rq_resource_idx ON learning_resource_questions(resource_id);
--> statement-breakpoint

-- Gaps & goals living document per resource
CREATE TABLE IF NOT EXISTS learning_resource_gaps (
  id text PRIMARY KEY,
  resource_id text NOT NULL UNIQUE REFERENCES learning_resources(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES learning_kb_workspaces(id) ON DELETE CASCADE,
  understood text NOT NULL DEFAULT '[]',
  gaps text NOT NULL DEFAULT '[]',
  goals text NOT NULL DEFAULT '[]',
  sessions_analyzed text NOT NULL DEFAULT '[]',
  wiki_page_slug text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_rg_resource_idx ON learning_resource_gaps(resource_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_rg_workspace_idx ON learning_resource_gaps(workspace_id);
--> statement-breakpoint

-- Add learn_resource_id to session to track which resource a learn session is tied to
ALTER TABLE session ADD COLUMN learn_resource_id text REFERENCES learning_resources(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS session_learn_resource_idx ON session(learn_resource_id);
