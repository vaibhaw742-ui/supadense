ALTER TABLE learning_categories ADD COLUMN parent_category_id text REFERENCES learning_categories(id);
--> statement-breakpoint
ALTER TABLE learning_wiki_pages ADD COLUMN type text NOT NULL DEFAULT 'section';
--> statement-breakpoint
UPDATE learning_wiki_pages SET type = 'overview' WHERE page_type IN ('category', 'index');
