---
name: kb-memorize
description: Memorize a resource into the knowledge base. Load when the user says 'memorize', 'add to KB', 'save this', 'learn from', or provides a URL/text/YouTube link they want stored. Runs the full pipeline: fetch → analyze → categorize → extract → place → build.
---

# KB Memorize Skill

Use this skill when the user wants to add a resource to their knowledge base:
- URLs ("memorize https://...")
- YouTube videos ("memorize this youtube video: ...")
- Text pastes ("memorize this: ...")
- PDF paths or URLs
- LinkedIn posts
- Images

## Pipeline Overview

```
kb_workspace_init → kb_resource_create → [analyze] → kb_resource_place (×N) → kb_concept_upsert (×N) → kb_wiki_build → kb_event_log
```

## Step 1: Initialize Workspace

```
kb_workspace_init()
```

If `kb_initialized` is `false`, tell the user: "Your KB isn't set up yet. Say 'set up my knowledge base' to start onboarding."

## Step 2: Create Resource + Fetch Content

Determine the modality:
- `http://` or `https://` URL → `url` (unless it's YouTube or LinkedIn)
- `youtube.com` or `youtu.be` → `youtube`
- `linkedin.com/posts/` → `linkedin`
- Pasted text / code → `text`
- `.pdf` extension or PDF URL → `pdf`
- Image path or image URL → `image`

```
kb_resource_create({
  workspace_id: "<id>",
  modality: "<detected modality>",
  input: "<URL or text content>",
  title: "<optional: user-specified title>",
  note: "<optional: user's annotation about why this matters>"
})
```

Note the `resource_id` from the output. The tool returns the raw content for you to analyze.

## Step 3: Analyze the Content

Read the content returned by `kb_resource_create`. Determine:

1. **Primary category**: Which of the user's categories does this belong to? (from `kb_workspace_init` categories list)
2. **Subcategory pages**: Which wiki pages should receive content? (can be multiple)
3. **Key sections**: What sections within each page should get content?
   - Common sections: `overview`, `key-concepts`, `examples`, `tools`, `papers`, `techniques`, `definitions`, `case-studies`
4. **Quality assessment**: Is this high-quality, reliable content? (0.0–1.0)
5. **Key concepts**: What are the main terms/techniques/ideas introduced?

## Step 4: Place Content into Wiki Sections

For each relevant section, call `kb_resource_place`:

```
kb_resource_place({
  resource_id: "<id>",
  wiki_page_id: "<target page id>",       // from kb_workspace_init pages list
  section_slug: "key-concepts",
  section_heading: "## Key Concepts",
  extracted_content: "<well-formatted markdown chunk>",
  confidence: 0.95
})
```

**Content extraction guidelines:**
- Extract the most valuable, non-obvious insights (not obvious facts)
- Reformat as clean markdown (bullet points for lists, code blocks for code)
- Each chunk should be self-contained — readable without the original article
- A resource can be placed in multiple sections across multiple pages
- Aim for 2–5 placements per resource (more for rich resources)
- Keep each chunk under 500 words

**Avoid:**
- Copying verbatim paragraphs (paraphrase + attribute)
- Placing trivial or widely-known information
- Duplicate content already in the wiki

## Step 5: Extract and Upsert Concepts

For each key concept found:

```
kb_concept_upsert({
  workspace_id: "<id>",
  name: "ReAct Prompting",
  slug: "react-prompting",
  definition: "A prompting technique that interleaves reasoning steps with action calls.",
  explanation: "ReAct alternates between 'Thought' (reasoning) and 'Action' (tool call) steps...",
  aliases: ["ReAct", "Reason+Act"],
  related_slugs: ["chain-of-thought", "tool-use", "agent-loop"],
  category_id: "<agents category id>",
  wiki_page_id: "<target page id>",
  section_slug: "key-concepts",
  introduced_by_resource_id: "<resource_id>"
})
```

Only upsert concepts that are:
- Domain-specific (not general knowledge)
- Would be useful to look up later
- Not already well-known to the user (check existing concepts from workspace)

## Step 6: Rebuild Wiki Pages

Build all pages that received new content:

```
kb_wiki_build({ page_id: "<page_id>" })
```

Call once per affected page. Or if multiple pages were updated:

```
kb_wiki_build({ category_id: "<cat_id>" })
```

## Step 7: Log the Event

```
kb_event_log({
  workspace_id: "<id>",
  event_type: "memorize",
  summary: "Memorized: 'ReAct: Synergizing Reasoning and Acting in Language Models' (arxiv.org) → Agents / Key Concepts, Examples",
  resource_id: "<resource_id>",
  rebuild_log: true
})
```

## Step 8: Confirm to User

Tell the user:
- What was memorized (title + URL)
- Which wiki pages were updated and which sections
- Any new concepts added
- Where to find the content: e.g., `wiki/agents--key-concepts.md`

## Handling Special Modalities

### YouTube Videos
- Resource create returns the video ID
- Summarize based on your knowledge of the topic if transcript not available
- Note: mark confidence lower (0.6–0.8) if summarizing from title/description only

### LinkedIn Posts
- Often short-form — one or two placements max
- Good for: tools/frameworks mentions, opinion pieces, trend signals
- metadata: note the author name and engagement if known

### PDF / Papers
- Often high-quality academic content — treat as authoritative
- Place in `papers` section if available, plus relevant concept sections
- Extract: abstract, key contributions, methodology, results

### Text Pastes
- User is sharing their own notes or copied content
- Respect their formatting, just organize into sections

## Quality Signals (adjust confidence)
- `1.0` — authoritative source (official docs, peer-reviewed paper)
- `0.8` — reputable blog/newsletter, known expert
- `0.6` — social media post, unverified claim
- `0.4` — speculative or opinion-heavy content
