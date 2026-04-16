---
name: kb-retrieve
description: Raw KB search — returns wiki locations, concepts, and source resources for a query. Load when the user explicitly says 'search my KB', 'what do I know about X', 'check my notes on X', or 'look this up in my KB'. For general learning questions use kb-learn instead.
---

# KB Retrieve Skill

Use this skill when:
- User asks a question about a topic they might have memorized resources on
- User says "what do I know about X" or "check my KB"
- User wants to review their notes on a subject
- You need KB context before answering (check KB first, then respond)

## Step 1: Search the KB

```
kb_retrieve({
  query: "<natural language query matching the user's question>",
  max_results: 5
})
```

The tool returns a list of locations: `file_path` + `section_heading` + summary.

## Step 2: Read the Relevant Sections

For each relevant result, use ReadTool to get the actual content.

**Efficient reading strategy:**
1. Check `section_heading` — if provided, scan the file for that heading first
2. Use ReadTool with `offset` + `limit` to read just the relevant section (not the entire file)
3. The heading divides content into logical chunks — read 30–80 lines from the heading

Example:
```
read({
  filePath: "/path/to/wiki/agents--key-concepts.md",
  // Use offset if you know the line number of the section
})
```

If `section_heading` is `null`, read the full page (usually short for category/index pages).

## Step 3: Synthesize and Answer

After reading the relevant sections:
1. Synthesize the information from multiple sources if needed
2. Answer the user's question using KB content as the primary source
3. Cite the wiki pages: "According to your KB (wiki/agents--key-concepts.md)..."
4. Note any gaps: "Your KB doesn't cover X yet — you could memorize [suggestion]"

### Images — CRITICAL RULE

If `kb_retrieve` returns a `## Related Images` section:
- **You MUST paste the `![alt](url)` lines verbatim into your response.**
- The URL starts with `http://localhost:4096/wiki/assets/...`
- Do NOT write "Image 1 shows..." — paste the raw `![alt](url)` markdown directly.
- If you describe images in text instead of rendering them, you are doing it wrong.

Correct example:
```
![Decision Framework](http://localhost:4096/wiki/assets/abc/img.png)
```

## Step 4: Offer Next Steps

After answering:
- If the answer is partial: suggest what to memorize to fill the gap
- If the question reveals a new concept: offer to add it to the KB
- If the content is outdated: note the last_built date

## When KB Has No Relevant Content

If `kb_retrieve` returns no results:
1. Say: "I didn't find this in your KB."
2. Offer to answer from general knowledge
3. Offer to memorize a resource that covers the topic

## Tips

- Use specific terms from the user's actual knowledge domains
- Try multiple queries if the first returns few results (e.g., try synonyms)
- Cross-reference: if concept A links to concept B, check B too
- The `abs_path` field gives the full filesystem path for ReadTool
