---
name: signal-detector
triggers:
  - "I noticed"
  - "Idea:"
  - "Remember:"
  - "Problem:"
  - "We should"
  - "Decision:"
  - "Key insight"
tools:
  - save_to_brain
---

## Signal Detector

### When to use
When the user's message contains a capturable insight, idea, or decision.

### Guidance

Watch every user message for these patterns:
- "I noticed X" → potential observation worth capturing
- "Idea: ..." → explicitly wants to capture
- "We decided to ..." → a decision that should live in L0/decisions/
- "Problem: ..." → a known issue worth tracking

When detected:
1. Acknowledge the signal briefly.
2. Offer to save: "I noticed a key insight here. Save to brain?"
3. If user confirms, call `save_to_brain` with `layer: 0`.
4. Suggest linking to existing related nodes if found via `search_brain`.

Do NOT interrupt the flow of the conversation. Surface the offer
as a note after responding to the main request.
