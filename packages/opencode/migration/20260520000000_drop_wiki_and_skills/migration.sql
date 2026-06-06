-- Drop skill pipeline tables (dead code, never used)
DROP TABLE IF EXISTS learning_resource_skill_results;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_skills;
--> statement-breakpoint

-- Drop wiki/placement tables (wiki system removed)
DROP TABLE IF EXISTS learning_page_blocks;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_concept_wiki_placements;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_wiki_cross_refs;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_resource_wiki_placements;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_wiki_pages;
--> statement-breakpoint

-- Drop category tables (category system removed)
DROP TABLE IF EXISTS learning_categories;
--> statement-breakpoint

-- Drop other removed tables
DROP TABLE IF EXISTS learning_gaps;
--> statement-breakpoint
DROP TABLE IF EXISTS learning_roadmap_items;
