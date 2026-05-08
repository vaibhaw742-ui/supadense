CREATE TABLE IF NOT EXISTS learning_page_blocks (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES learning_kb_workspaces(id) ON DELETE CASCADE,
  wiki_page_id text NOT NULL REFERENCES learning_wiki_pages(id) ON DELETE CASCADE,
  parent_id text REFERENCES learning_page_blocks(id),
  content text NOT NULL DEFAULT '',
  block_type text NOT NULL DEFAULT 'paragraph',
  source text NOT NULL DEFAULT 'ai',
  placement_id text REFERENCES learning_resource_wiki_placements(id) ON DELETE SET NULL,
  order_index integer NOT NULL DEFAULT 0,
  depth integer NOT NULL DEFAULT 0,
  properties text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_page_blocks_page_idx ON learning_page_blocks(wiki_page_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_page_blocks_workspace_idx ON learning_page_blocks(workspace_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_page_blocks_order_idx ON learning_page_blocks(wiki_page_id, parent_id, order_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS learning_page_blocks_content_idx ON learning_page_blocks(workspace_id, content);
