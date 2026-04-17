# kb-remove-resource

Remove a resource and all associated data from the knowledge base.

## When to use

When the user says things like:
- "remove resource https://..."
- "delete this source: https://..."
- "forget https://..."
- "remove the URL https://..."

## Steps

1. **Confirm the URL** — repeat the URL back to the user and confirm they want to remove it and all associated data (raw content, images, wiki placements, wiki rebuild). Wait for confirmation before proceeding.

2. **Call the tool**:
   ```
   kb_remove_resource({ url: "<exact URL>" })
   ```

3. **Report results** — tell the user:
   - How many wiki placements were removed
   - Which wiki pages were rebuilt
   - How many files were deleted from disk

## Critical rules

- ALWAYS confirm with the user before removing — this is irreversible
- Use the EXACT URL the user provided, including protocol (https:// or http://)
- Do NOT guess or truncate the URL
- After removal, the wiki pages are automatically rebuilt — do not ask the user to rebuild manually
