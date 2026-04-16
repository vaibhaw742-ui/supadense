---
name: kb-section-group
description: Group and densify a wiki section by clustering similar concepts/entries across resources into fewer, denser entries backed by multiple sources. Load when the user says "group [section] in [category]", "densify", "consolidate", "merge concepts", or "group key concepts".
---

# KB Section Group Skill

Use this skill when the user wants to group, densify, or consolidate a section across resources — turning many per-resource entries into fewer, cross-source groups.

## Step 1: Read the existing section first

Before fetching, read the current wiki page to understand the existing content structure:

```
read({ file_path: "<kb_path>/wiki/<category>--<section>.md" })
// or for sections on the category page:
read({ file_path: "<kb_path>/wiki/<category>.md" })
```

Note the existing headings, bullet styles, and content format. **Grouping must not destroy this structure** — the original content of every placement is preserved verbatim, just reorganised under group headings.

## Step 2: Fetch placement data

Call `kb_section_group` in fetch mode (no `groups` param):

```
kb_section_group({
  category_slug: "<category>",   // e.g. "rag", "agents"
  section_slug: "<section>",     // e.g. "key-concepts", "use-cases"
})
```

This returns all placements for the section with their content and context excerpts.

## Step 3: Analyse and cluster

Read the returned entries carefully. Cluster concepts/entries that express the **same core idea** into groups.

Rules:
- Merge concepts that are synonyms, sub-variants, or describe the same mechanism
- Keep concepts that are **genuinely distinct** in separate groups
- Aim for the **fewest groups** that preserve all meaningful distinctions
- Every resource must appear in at least one group
- A resource CAN belong to multiple groups if its content spans different ideas
- Write a concise, synthesised **one-sentence definition** for each group that reflects all member resources — not just one
- Group numbers start at 1 and are sequential

## Step 4: Apply the groups

Call `kb_section_group` in apply mode with your clusters:

```
kb_section_group({
  category_slug: "<category>",
  section_slug: "<section>",
  groups: [
    {
      group_num: 1,
      group: "Chunking Strategies",
      definition: "Techniques for splitting documents into semantically coherent chunks for indexing.",
      members: [
        { resource_id: "res_001", concepts: ["chunking", "semantic chunking", "fixed-size chunking"] },
        { resource_id: "res_002", concepts: ["chunking strategy"] }
      ]
    },
    {
      group_num: 2,
      group: "Dense Retrieval",
      definition: "Vector-based retrieval using bi-encoder models to find semantically similar passages.",
      members: [
        { resource_id: "res_002", concepts: ["dense retrieval"] },
        { resource_id: "res_003", concepts: ["retrieval", "bi-encoder"] }
      ]
    }
  ]
})
```

## Step 5: Present the summary

After applying, show the user a clean summary:

```
Grouped 'key-concepts' in 'rag':

  [1] Chunking Strategies     — 3 resources
      Techniques for splitting documents...

  [2] Dense Retrieval         — 2 resources
      Vector-based retrieval...

  [3] Query Expansion         — 2 resources
      ...

14 concepts from 6 resources → 3 groups
Wiki rebuilt. View at wiki/rag--key-concepts.md (or the relevant wiki page).
```

## Rules

- **Always read the existing wiki page first (Step 1)** — understand the current structure before grouping
- **Never summarise or rewrite placement content** — the original extracted_content of every placement is preserved verbatim by the wiki builder; your job is only to decide WHICH group each resource belongs to
- **The `definition` field is a one-line synthesis shown as an italic subtitle under the group heading** — keep it brief; the full content comes from the original placements
- Always run Phase 1 (fetch) before Phase 2 (apply) — never skip it
- Do not invent resource_ids — use only the IDs returned in Phase 1
- Every resource_id from Phase 1 must appear in at least one group in Phase 2
- The `concepts` list per member should reflect the actual bullet points / concept names from that resource's placement content
- If the section has very few entries (< 3 resources), tell the user grouping may not add much value but proceed if they want it
