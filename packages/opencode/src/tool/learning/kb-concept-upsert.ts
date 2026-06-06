/**
 * kb_concept_upsert — Add or merge a concept into the knowledge base.
 *
 * Called during the add-resource pipeline after key_concepts extraction.
 * Merges new definitions/aliases into existing concepts if slug already exists.
 * Optionally links the concept to a wiki page.
 */
import z from "zod"
import { Tool } from "../tool"

export const KbConceptUpsertTool = Tool.define("kb_concept_upsert", {
  description: "Add a concept to the knowledge base (no-op: concept table removed).",
  parameters: z.object({
    workspace_id: z.string(),
    name: z.string(),
    slug: z.string(),
    definition: z.string().optional(),
    explanation: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    related_slugs: z.array(z.string()).optional(),
  }),
  async execute(params) {
    return {
      title: `Concept: ${params.name}`,
      metadata: { slug: params.slug, name: params.name },
      output: `concept noted: ${params.name}`,
    }
  },
})
