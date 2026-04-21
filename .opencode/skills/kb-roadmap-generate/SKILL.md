---
name: kb-roadmap-generate
description: Generate a roadmap or blog post from KB resources and write it to wiki/roadmap/. Load when the user says 'create a roadmap', 'generate a learning path', 'make a roadmap', 'write a blog', 'create a blog post', or similar.
---

# KB Roadmap Generate Skill

Generate a structured roadmap (learning path) or blog post from resources in the knowledge base.

## Step 1 — Get workspace info

Call:
```
kb_workspace_init()
```

From the result, extract:
- `metadata.workspace_id` → needed for kb_retrieve
- `metadata.kb_path` → absolute path to the KB folder (e.g. `/Users/you/projects/myknowledge`)

## Step 2 — Retrieve ALL relevant resources

Call:
```
kb_retrieve({ workspace_id: "<workspace_id>", query: "<topic>", max_results: 20 })
```

**Read every single result** — call `Read` on the `abs_path` of each one. Do not skip any. Use `section_heading` to locate the right section within the file.

The roadmap must cover ALL resources returned, not just the top few. Every source the KB has on this topic should appear somewhere in the final document.

## Step 3 — Determine type, title, and slug

- User says "roadmap" or "learning path" → `type: roadmap`
- User says "blog" or "blog post" → `type: blog`
- Use the user's title if given; otherwise infer one (e.g. "Agents Learning Path")
- Derive `slug` from title: lowercase, spaces → hyphens, remove special chars (e.g. `agents-learning-path`)

## Step 4 — Create the roadmap folder

Run this exact bash command:
```bash
mkdir -p <kb_path>/wiki/roadmap
```

Example:
```bash
mkdir -p /Users/you/projects/myknowledge/wiki/roadmap
```

## Step 5 — Write the file

Use the `Write` tool to create `<kb_path>/wiki/roadmap/<slug>.md`.

NEVER overwrite an existing file. If `<slug>.md` already exists, use `<slug>-2.md`.

### Roadmap format:
```markdown
---
title: <title>
type: roadmap
created: <YYYY-MM-DD>
---

> <1–2 sentence description of what this roadmap covers>

## Stage 1: Foundations
What to achieve in this stage.

### Resources
- **[Resource Title](url)** — what to learn and why

## Stage 2: Core Concepts
...

## Stage 3: Advanced
...
```

### Blog format:
```markdown
---
title: <title>
type: blog
created: <YYYY-MM-DD>
---

> <tagline or subtitle>

## Introduction
...

## <Key Insight 1>
...

## <Key Insight 2>
...

## Conclusion
...

## Sources
- [Title](url)
```

## Step 6 — Confirm to user

Tell the user:
> "Created `wiki/roadmap/<slug>.md`. You can view it in the wiki under Roadmaps."

## Rules
- ALWAYS run `mkdir -p` via Bash before writing the file — the folder may not exist yet
- ALWAYS use the `Write` tool (not Bash) to write the markdown file
- ALWAYS include the YAML frontmatter between `---` delimiters at the top
- EVERY resource returned by kb_retrieve must appear in the roadmap — none left out
- Only use real resource titles and URLs fetched from the KB — never invent sources
- Slug must be URL-safe: lowercase letters, numbers, hyphens only
