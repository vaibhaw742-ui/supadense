---
name: brain-first
triggers:
  - "why did we"
  - "how does X work"
  - "what is our approach to"
  - "why did you choose"
  - "what's the architecture"
  - "history of"
  - "decision behind"
---

## Brain-First Rule

Before answering ANY question about:
- Architecture choices or decisions
- Why something was built a certain way
- Historical context about the codebase
- Team expertise or past experiences

ALWAYS call `search_brain()` first.

If `search_brain` returns L2 results → answer from those (most refined).
If it cascades to L1 → note it's a synthesis, link back to raw sources.
If it cascades to L0 → note that only raw data exists, offer to synthesise to L1.
If nothing found → answer from code context, then offer to save to brain.
