---
name: kb-memorize
description: Memorize a resource into the knowledge base. Load when the user says 'memorize', 'add to KB', 'save this', 'learn from', or provides a URL/text/YouTube link they want stored.
---

# KB Memorize Skill

## ⛔ STOP — READ BEFORE CALLING ANY TOOL

**If the user gave you a URL:**
- Call `kb_resource_create` with `modality: "url"` and pass the raw URL as `input`
- DO NOT use WebFetch or any fetch tool first
- DO NOT pre-read or summarize the page
- DO NOT pass the page content as `input`
- The tool fetches the page AND downloads images — if you pre-fetch, images are LOST

**If you already fetched the page:** still pass the original URL as `input` with `modality: "url"` — the tool will re-fetch it properly.

---

## Pipeline

```
kb_workspace_init → kb_resource_create → kb_pipeline_run → confirm to user
```

The wiki is updated in the background. You return immediately after step 3.

---

## Step 1: Initialize Workspace

```
kb_workspace_init()
```

Note the `workspace_id`. If `kb_initialized` is `false`, tell the user to run onboarding first.

---

## Step 2: Create Resource

Determine the modality:
- `http://` or `https://` URL → `url` (unless YouTube/LinkedIn)
- `youtube.com` / `youtu.be` → `youtube`
- `linkedin.com/posts/` → `linkedin`
- Pasted text with NO URL → `text`
- `.pdf` extension → `pdf`

```
kb_resource_create({
  workspace_id: "<id>",
  modality: "url",           ← for any http/https link
  input: "https://...",      ← the raw URL, NOT fetched content
  title: "<optional>",
  note: "<optional user annotation>"
})
```

Note the `resource_id`. If `duplicate: true` is returned, tell the user and stop.

**Text paste example (only when user pastes actual text, no URL):**
```
kb_resource_create({
  workspace_id: "<id>",
  modality: "text",
  input: "<the pasted text>",
})
```

---

## Step 3: Trigger Background Pipeline

```
kb_pipeline_run({
  resource_id: "<id from step 2>",
  workspace_id: "<id from step 1>"
})
```

Do not wait — proceed to step 4 immediately.

---

## Step 4: Confirm to User

Tell the user: what was memorized (title + URL), that the wiki is being updated in the background, and the `task_id`.

---

## Handling Duplicates

If `kb_resource_create` returns `duplicate: true`: tell the user, do NOT call `kb_pipeline_run`, offer to reprocess.

---

## Modality Notes

- **YouTube**: returns video ID, curator summarizes from title/description
- **PDF**: content extraction not automated — inform user if content is limited
- **Text**: for user-written notes or pastes with no source URL
