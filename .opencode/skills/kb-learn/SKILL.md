---
name: kb-learn
description: Answer learning questions by searching the KB first, then supplementing with general knowledge. Load when the user wants to learn about a topic, asks "explain X", "teach me about X", "what is X", "how does X work", "tell me about X", "I want to understand X", or any conceptual/educational question about a topic in their knowledge domains.
---

# KB Learn Skill

Use this skill for any question where the user wants to understand a topic — not just explicit "check my KB" queries. Always check the KB first before reaching for the web.

## Step 1: Search the KB

```
kb_retrieve({
  query: "<the topic or concept the user wants to learn about>",
  max_results: 8
})
```

The tool returns three sections:
- **Wiki Locations** — exact file + section where content lives
- **Related Concepts** — concepts stored in the KB with definitions
- **Resources** — articles/videos already memorized that cover this topic

## Step 2: Read the Relevant Wiki Sections

For each wiki location returned, read the actual content:

```
read({ file_path: "<abs_path from result>" })
```

Focus on sections most relevant to the query. Skip index/category pages unless they're the only results.

## Step 3: Synthesize and Answer

Structure your answer as:

### What's in your KB
- Summarize what you found in the wiki sections
- Quote or paraphrase key points (attribute to the wiki page)
- List the **related concepts** from the KB with their definitions

### Resources that cover this
- List the memorized resources (title + URL) that introduced this content
- Note the author/source if available

### What's not in your KB yet (supplement)
- If the KB is sparse or doesn't fully answer the question, supplement with your general knowledge
- Clearly label this: "From general knowledge (not yet in your KB):"
- Suggest a specific resource to memorize: "You could memorize [X] to add this to your KB"

## Step 4: Offer Next Steps

After answering, always offer:
- "Want me to memorize a resource on this to fill the gaps?"
- "Should I add any of these concepts to your KB?"
- Suggest 1–2 specific URLs/resources if you know good ones

## Rules

- ALWAYS call `kb_retrieve` first — never skip it even if you think the KB won't have it
- If KB has content: lead with KB content, supplement with general knowledge
- If KB is empty: say so explicitly, answer from general knowledge, offer to memorize
- Never pretend content is in the KB if `kb_retrieve` returned nothing
- Cite wiki pages by path: "According to `wiki/agents.md`..."

## Images — CRITICAL RULE

If `kb_retrieve` returns a `## Related Images` section:
- **You MUST paste the `![alt](url)` lines verbatim into your response.**
- The URL starts with `http://localhost:4096/wiki/assets/...`
- Do NOT write "Image 1 shows..." or describe the image — paste the raw markdown line.
- Example of what your response must contain:
  ```
  ![Decision Framework](http://localhost:4096/wiki/assets/abc/img.png)
  ```
- If you describe images instead of rendering them, you are doing it wrong.
