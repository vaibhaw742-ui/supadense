---
name: kb-wiki-build
description: Rebuild wiki files from DB state. Load when the user says 'rebuild my wiki', 'refresh my KB', 'update wiki pages', or after a batch of placements that haven't been built yet.
---

# KB Wiki Build Skill

## Default: Rebuild Everything

When the user says "rebuild wiki", "refresh wiki", "update wiki", or similar — **always do a full rebuild**:

```
kb_workspace_init()  // get workspace_id
kb_wiki_build({ workspace_id: "<workspace_id>" })
```

This rebuilds ALL wiki pages, supadense.md, and log.md in one shot.
Never use page_id or category_id when the user asks to rebuild — they expect everything updated.

## Rebuild a Single Category (targeted)

Only when explicitly requested for one specific category:
```
kb_wiki_build({ category_id: "<category_id>" })
```

## Rebuild a Single Page (targeted)

Only when the curator places content on one specific page and rebuilds that page only:
```
kb_wiki_build({ page_id: "<wiki_page_id>" })
```

## When to Rebuild

- User says "rebuild", "refresh", "update" → full rebuild with workspace_id
- After every `kb_resource_place` call in the curator pipeline → page_id is fine there
- After `kb_onboard_complete` (already done automatically)
- Never needed before `kb_retrieve` (retrieval reads from DB, not files)

## Output

The tool returns the list of files written to disk.
Confirm to the user: "Rebuilt X files across all categories."
