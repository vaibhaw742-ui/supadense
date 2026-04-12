CREATE TABLE `learning_categories` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`depth` text DEFAULT 'working' NOT NULL,
	`color` text,
	`icon` text,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_categories_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_concepts` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`definition` text,
	`explanation` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	`related_slugs` text DEFAULT '[]' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_concepts_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_concepts_category_id_learning_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `learning_categories`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_concept_wiki_placements` (
	`concept_id` text NOT NULL,
	`wiki_page_id` text NOT NULL,
	`section_slug` text,
	`introduced_by_resource_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `learning_concept_wiki_placements_pk` PRIMARY KEY(`concept_id`, `wiki_page_id`),
	CONSTRAINT `fk_learning_concept_wiki_placements_concept_id_learning_concepts_id_fk` FOREIGN KEY (`concept_id`) REFERENCES `learning_concepts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_concept_wiki_placements_wiki_page_id_learning_wiki_pages_id_fk` FOREIGN KEY (`wiki_page_id`) REFERENCES `learning_wiki_pages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_concept_wiki_placements_introduced_by_resource_id_learning_resources_id_fk` FOREIGN KEY (`introduced_by_resource_id`) REFERENCES `learning_resources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_gaps` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`gap_type` text DEFAULT 'declared' NOT NULL,
	`detected_by` text NOT NULL,
	`detected_from_resource_id` text,
	`resolved_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_gaps_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_gaps_category_id_learning_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `learning_categories`(`id`),
	CONSTRAINT `fk_learning_gaps_detected_from_resource_id_learning_resources_id_fk` FOREIGN KEY (`detected_from_resource_id`) REFERENCES `learning_resources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_kb_events` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`event_type` text NOT NULL,
	`resource_id` text,
	`wiki_page_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`summary` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_kb_events_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_kb_events_resource_id_learning_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`),
	CONSTRAINT `fk_learning_kb_events_wiki_page_id_learning_wiki_pages_id_fk` FOREIGN KEY (`wiki_page_id`) REFERENCES `learning_wiki_pages`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_kb_workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL UNIQUE,
	`template_id` text,
	`kb_path` text NOT NULL,
	`kb_initialized` integer DEFAULT false NOT NULL,
	`learning_intent` text,
	`goals` text DEFAULT '[]' NOT NULL,
	`gaps` text DEFAULT '[]' NOT NULL,
	`depth_prefs` text DEFAULT '{}' NOT NULL,
	`trusted_sources` text DEFAULT '[]' NOT NULL,
	`scout_platforms` text DEFAULT '[]' NOT NULL,
	`extra_folders` text DEFAULT '[]' NOT NULL,
	`onboarded_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_kb_workspaces_template_id_learning_schema_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `learning_schema_templates`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_media_assets` (
	`id` text PRIMARY KEY,
	`resource_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`asset_type` text NOT NULL,
	`source_url` text,
	`local_path` text NOT NULL,
	`caption` text,
	`description` text,
	`alt_text` text,
	`is_diagram` integer DEFAULT false NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_media_assets_resource_id_learning_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_media_assets_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_resource_skill_results` (
	`id` text PRIMARY KEY,
	`resource_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input_snapshot` text,
	`output` text,
	`error` text,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`ran_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_resource_skill_results_resource_id_learning_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_resource_skill_results_skill_id_learning_skills_id_fk` FOREIGN KEY (`skill_id`) REFERENCES `learning_skills`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_resources` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`url` text,
	`title` text,
	`author` text,
	`modality` text NOT NULL,
	`raw_content` text,
	`summary` text,
	`quality_score` real DEFAULT 0 NOT NULL,
	`relevance_score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`processing_step` text,
	`error` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`published_at` integer,
	`memorized_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_resources_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_resource_wiki_placements` (
	`id` text PRIMARY KEY,
	`resource_id` text NOT NULL,
	`wiki_page_id` text NOT NULL,
	`section_slug` text NOT NULL,
	`section_heading` text NOT NULL,
	`extracted_content` text NOT NULL,
	`media_asset_ids` text DEFAULT '[]' NOT NULL,
	`placement_position` integer DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`placed_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_resource_wiki_placements_resource_id_learning_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_resource_wiki_placements_wiki_page_id_learning_wiki_pages_id_fk` FOREIGN KEY (`wiki_page_id`) REFERENCES `learning_wiki_pages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_roadmap_items` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`level` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`resource_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_roadmap_items_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_roadmap_items_category_id_learning_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `learning_categories`(`id`),
	CONSTRAINT `fk_learning_roadmap_items_resource_id_learning_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`)
);
--> statement-breakpoint
CREATE TABLE `learning_schema_sections` (
	`id` text PRIMARY KEY,
	`subcategory_id` text NOT NULL,
	`slug` text NOT NULL,
	`heading` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_schema_sections_subcategory_id_learning_schema_subcategories_id_fk` FOREIGN KEY (`subcategory_id`) REFERENCES `learning_schema_subcategories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_schema_subcategories` (
	`id` text PRIMARY KEY,
	`template_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_schema_subcategories_template_id_learning_schema_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `learning_schema_templates`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_schema_templates` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL UNIQUE,
	`description` text,
	`is_builtin` integer DEFAULT true NOT NULL,
	`created_by` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `learning_skills` (
	`id` text PRIMARY KEY,
	`workspace_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`skill_type` text NOT NULL,
	`prompt_template` text,
	`output_schema` text,
	`runs_on_modalities` text DEFAULT '["url","pdf","youtube","text","linkedin","image"]' NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_skills_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_wiki_cross_refs` (
	`id` text PRIMARY KEY,
	`source_page_id` text NOT NULL,
	`target_page_id` text NOT NULL,
	`ref_type` text NOT NULL,
	`description` text,
	`strength` real DEFAULT 1 NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_wiki_cross_refs_source_page_id_learning_wiki_pages_id_fk` FOREIGN KEY (`source_page_id`) REFERENCES `learning_wiki_pages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_wiki_cross_refs_target_page_id_learning_wiki_pages_id_fk` FOREIGN KEY (`target_page_id`) REFERENCES `learning_wiki_pages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `learning_wiki_pages` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`category_id` text,
	`parent_page_id` text,
	`page_type` text NOT NULL,
	`category_slug` text,
	`subcategory_slug` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`file_path` text NOT NULL,
	`description` text,
	`sections` text DEFAULT '[]' NOT NULL,
	`resource_count` integer DEFAULT 0 NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`last_built_at` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_wiki_pages_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_wiki_pages_category_id_learning_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `learning_categories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `learning_categories_workspace_idx` ON `learning_categories` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_concepts_workspace_idx` ON `learning_concepts` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_concepts_category_idx` ON `learning_concepts` (`category_id`);--> statement-breakpoint
CREATE INDEX `learning_cwp_wiki_page_idx` ON `learning_concept_wiki_placements` (`wiki_page_id`);--> statement-breakpoint
CREATE INDEX `learning_gaps_workspace_idx` ON `learning_gaps` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_gaps_category_idx` ON `learning_gaps` (`category_id`);--> statement-breakpoint
CREATE INDEX `learning_kb_events_workspace_idx` ON `learning_kb_events` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_kb_events_type_idx` ON `learning_kb_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `learning_media_assets_resource_idx` ON `learning_media_assets` (`resource_id`);--> statement-breakpoint
CREATE INDEX `learning_rsr_resource_idx` ON `learning_resource_skill_results` (`resource_id`);--> statement-breakpoint
CREATE INDEX `learning_rsr_skill_idx` ON `learning_resource_skill_results` (`skill_id`);--> statement-breakpoint
CREATE INDEX `learning_resources_workspace_idx` ON `learning_resources` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_resources_status_idx` ON `learning_resources` (`status`);--> statement-breakpoint
CREATE INDEX `learning_rwp_resource_idx` ON `learning_resource_wiki_placements` (`resource_id`);--> statement-breakpoint
CREATE INDEX `learning_rwp_wiki_page_idx` ON `learning_resource_wiki_placements` (`wiki_page_id`);--> statement-breakpoint
CREATE INDEX `learning_roadmap_workspace_idx` ON `learning_roadmap_items` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_roadmap_category_idx` ON `learning_roadmap_items` (`category_id`);--> statement-breakpoint
CREATE INDEX `learning_schema_sections_subcategory_idx` ON `learning_schema_sections` (`subcategory_id`);--> statement-breakpoint
CREATE INDEX `learning_schema_subcategories_template_idx` ON `learning_schema_subcategories` (`template_id`);--> statement-breakpoint
CREATE INDEX `learning_wiki_cross_refs_source_idx` ON `learning_wiki_cross_refs` (`source_page_id`);--> statement-breakpoint
CREATE INDEX `learning_wiki_cross_refs_target_idx` ON `learning_wiki_cross_refs` (`target_page_id`);--> statement-breakpoint
CREATE INDEX `learning_wiki_pages_workspace_idx` ON `learning_wiki_pages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `learning_wiki_pages_category_idx` ON `learning_wiki_pages` (`category_id`);--> statement-breakpoint
CREATE INDEX `learning_wiki_pages_parent_idx` ON `learning_wiki_pages` (`parent_page_id`);