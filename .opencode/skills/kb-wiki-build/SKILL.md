---
name: kb-wiki-build
description: Rebuild wiki files from DB state. Load when the user says 'rebuild my wiki', 'refresh my KB', 'update wiki pages', or after a batch of placements that haven't been built yet.
---

# KB Wiki Build Skill

Use this skill when:
- User asks to rebuild / refresh their wiki
- Multiple resources were memorized but wiki files weren't rebuilt
- User wants to regenerate supadense.md after profile changes
- You want to regenerate all files after a batch update

## Rebuild a Single Page

When you know the page ID:
```
kb_wiki_build({ page_id: "<wiki_page_id>" })
```

## Rebuild a Category

When a category received new content:
```
kb_wiki_build({ category_id: "<category_id>" })
```
This rebuilds the category page AND all its subcategory pages.

## Rebuild Everything

Full rebuild — use after significant changes:
```
kb_workspace_init()  // get workspace_id
kb_wiki_build({ workspace_id: "<workspace_id>" })
```
This rebuilds all wiki pages, supadense.md, AND log.md.

## When to Rebuild

- After every `kb_resource_place` call (or batch of calls)
- After `kb_onboard_complete` (already done automatically)
- When the user asks to "refresh" or "rebuild"
- Never needed before `kb_retrieve` (retrieval reads from DB, not files)

## Output

The tool returns a list of files that were written to disk.
Confirm to the user: "Rebuilt X files: wiki/agents--key-concepts.md, ..."
