---
name: kb-onboard
description: Onboard a new knowledge base workspace. Load when the user wants to set up their second-brain learning platform, define learning goals, choose focus areas, or configure their knowledge base for the first time.
---

# KB Onboarding Skill

## IMPORTANT: Tool calls are mandatory

After collecting answers, you MUST call the tools. Do not summarize and stop. Do not say "I'll set that up" without calling the tools. The files will NOT be created unless you call `kb_workspace_init` and `kb_onboard_complete`.

---

## Step 1: Ask all questions in ONE message

Ask the user ALL of the following in a single message. Wait for their answers before proceeding.

```
To set up your knowledge base, I need a few details:

1. **Knowledge base folder path** — where should I create the files?
   (e.g. `/Users/you/Desktop/KnowledgeBase`)

2. **Learning intent** — in one sentence, what are you trying to achieve?
   (e.g. "Build production-grade AI agent systems")

3. **Goals** — list 2–5 specific things you want to learn or be able to do.

4. **Knowledge domains** — list 2–6 areas to track (e.g. Agents, RAG, LLM Engineering).
   For each: name, brief description, and depth (deep / working / awareness).

5. **Trusted sources** — websites, authors, or publications you trust most.
```

The subcategory structure (key-concepts, papers, examples, tools) is applied automatically — no need to ask.

---

## Step 2: Call kb_workspace_init

Once you have the answers, immediately call:

```
kb_workspace_init({ kb_path: "<path from answer 1>" })
```

Save the `workspace_id` from the output.

---

## Step 3: Call kb_onboard_complete

Immediately after step 2, call:

```
kb_onboard_complete({
  workspace_id: "<from step 2>",
  learning_intent: "<answer 2>",
  goals: ["<goal 1>", "<goal 2>", ...],
  depth_prefs: { "<slug>": "deep|working|awareness", ... },
  trusted_sources: ["<source 1>", ...],
  scout_platforms: [],
  categories: [
    {
      slug: "<kebab-case>",
      name: "<Display Name>",
      description: "<one line>",
      depth: "deep|working|awareness",
      icon: "<emoji>"
    },
    ...
  ]
})
```

---

## Step 4: Confirm to user

After both tools succeed, tell the user:
- Which files were created and where (schema.json, supadense.md, log.md, wiki/)
- How many wiki pages were generated
- How to memorize their first resource: "Say 'memorize <URL>' to add content"
- How to evolve the schema: "Say 'add a section' or 'add a subcategory' to change the structure"

---

## Rules
- NEVER stop after asking questions without calling the tools
- ALWAYS call both tools back-to-back before responding to the user
- Category slugs must be kebab-case (e.g. `llm-engineering`, `systems-design`)
- Default depth is "working" if not specified
