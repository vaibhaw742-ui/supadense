/**
 * kb_concept_upsert — Add or merge a concept into the knowledge base.
 *
 * Called during the memorize pipeline after key_concepts extraction.
 * Merges new definitions/aliases into existing concepts if slug already exists.
 * Optionally links the concept to a wiki page.
 */
import z from "zod"
import { Tool } from "../tool"
import { ConceptStore } from "../../learning/resource"
import { Workspace } from "../../learning/workspace"

export const KbConceptUpsertTool = Tool.define("kb_concept_upsert", {
  description: [
    "Add a new concept to the knowledge base, or merge into an existing one (matched by slug).",
    "",
    "Concepts are atomic knowledge units: definitions, terms, techniques.",
    "Examples: 'ReAct Prompting', 'HNSW Index', 'Transformer Attention Mechanism'",
    "",
    "If a concept with the same slug already exists:",
    "  - definition/explanation are updated only if new values are richer",
    "  - aliases and related_slugs are merged (union, no duplicates)",
    "",
    "Optionally link to a wiki page so it appears in the '## Key Concepts' section.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
    name: z.string().describe("Full concept name, e.g. 'ReAct Prompting'"),
    slug: z
      .string()
      .describe("URL-safe slug, e.g. 'react-prompting'. Use hyphens, no underscores."),
    definition: z
      .string()
      .optional()
      .describe("One-line definition (the sharpest, most precise version)"),
    explanation: z
      .string()
      .optional()
      .describe("2-5 sentence explanation with context"),
    aliases: z
      .array(z.string())
      .optional()
      .describe("Alternative names, e.g. ['ReAct', 'Reason+Act']"),
    related_slugs: z
      .array(z.string())
      .optional()
      .describe("Slugs of related concepts, e.g. ['chain-of-thought', 'tool-use']"),
    category_id: z.string().optional().describe("Primary category ID this concept belongs to"),
    wiki_page_id: z
      .string()
      .optional()
      .describe("If provided, links this concept to the given wiki page"),
    section_slug: z
      .string()
      .optional()
      .describe("Which section of the wiki page this concept appears in"),
    introduced_by_resource_id: z
      .string()
      .optional()
      .describe("Resource ID that introduced this concept (for provenance)"),
  }),
  async execute(params) {
    const concept = ConceptStore.upsert({
      workspace_id: params.workspace_id,
      category_id: params.category_id,
      name: params.name,
      slug: params.slug,
      definition: params.definition,
      explanation: params.explanation,
      aliases: params.aliases ?? [],
      related_slugs: params.related_slugs ?? [],
    })

    if (params.wiki_page_id) {
      ConceptStore.linkToPage(
        concept.id,
        params.wiki_page_id,
        params.section_slug,
        params.introduced_by_resource_id,
      )
    }

    return {
      title: `Concept: ${concept.name}`,
      metadata: {
        concept_id: concept.id,
        slug: concept.slug,
        name: concept.name,
      },
      output: [
        `concept_id: ${concept.id}`,
        `name: ${concept.name}`,
        `slug: ${concept.slug}`,
        concept.definition ? `definition: ${concept.definition}` : "",
        concept.aliases.length > 0 ? `aliases: ${concept.aliases.join(", ")}` : "",
        params.wiki_page_id ? `linked to: wiki page ${params.wiki_page_id}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    }
  },
})
