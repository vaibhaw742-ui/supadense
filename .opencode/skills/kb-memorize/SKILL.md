---
name: kb-memorize
description: Memorize a resource into the knowledge base. Load when the user says 'memorize', 'add to KB', 'save this', 'learn from', or provides a URL/text/YouTube link they want stored.
---

# KB Memorize Skill

Use this skill when the user wants to add a resource to their knowledge base:
- URLs ("memorize https://...")
- YouTube videos ("memorize this youtube video: ...")
- Text pastes ("memorize this: ...")
- PDF paths or URLs
- LinkedIn posts

## Pipeline Overview

```
kb_workspace_init → kb_resource_create → kb_pipeline_run → confirm to user
```

The extraction, placement, and wiki rebuild all happen in the background via `kb_pipeline_run`.
You return immediately after step 3 — the user does not need to wait.

---

## Step 1: Initialize Workspace

```
kb_workspace_init()
```

If `kb_initialized` is `false`, tell the user: "Your KB isn't set up yet. Say 'set up my knowledge base' to start onboarding."

Note the `workspace_id` from the output.

---

## Step 2: Create Resource + Fetch Content

Determine the modality:
- `http://` or `https://` URL → `url` (unless YouTube or LinkedIn)
- `youtube.com` or `youtu.be` → `youtube`
- `linkedin.com/posts/` → `linkedin`
- Pasted text / code → `text`
- `.pdf` extension or PDF URL → `pdf`

```
kb_resource_create({
  workspace_id: "<id>",
  modality: "<detected modality>",
  input: "<URL or text content>",
  title: "<optional: user-specified title>",
  note: "<optional: user's annotation>"
})
```

Note the `resource_id` from the output. Images are downloaded automatically.

If `duplicate: true` is returned, tell the user and stop — do not call kb_pipeline_run.

---

## Step 3: Trigger Background Pipeline

```
kb_pipeline_run({
  resource_id: "<id from step 2>",
  workspace_id: "<id from step 1>"
})
```

This fires the KBCurator background agent immediately and returns a `task_id`.
The curator will:
1. Categorize the resource
2. Extract content into each relevant schema section
3. Call kb_resource_place (×N), kb_concept_upsert, kb_wiki_build, kb_event_log

**Do not wait for the pipeline.** Proceed to Step 4 immediately.

---

## Step 4: Confirm to User

Tell the user:
- What was memorized (title + URL)
- That the wiki is being updated in the background
- The `task_id` so they can track the child session if they want

Example:
> Memorized: **"From 12 Agents to 1: AI Agent Architecture Decision Guide"**
> (decodingai.com)
>
> The KB Curator is processing it in the background (task `01KP...`).
> Your wiki will be updated automatically — no need to wait.

---

## Handling Duplicates

If `kb_resource_create` returns `duplicate: true`:
- Tell the user this URL was already memorized (show when)
- Do NOT call `kb_pipeline_run`
- Offer to re-process if they want: "Say 'reprocess it' if you want to re-extract content"

---

## Modality Notes

### YouTube
- `kb_resource_create` returns the video ID
- The curator will summarize based on the title/description (confidence: 0.6–0.7)

### PDF
- Content extraction is not automated — inform the user if content is limited

### Text pastes
- Treat as `text` modality — curator will organize their own notes into sections
