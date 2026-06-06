---
name: meeting-ingestion
triggers:
  - "ingest a meeting"
  - "process transcript"
  - "add meeting notes"
  - "capture this meeting"
tools:
  - ingest_meeting
  - search_brain
  - save_to_brain
---

## Meeting Ingestion

### When to use
When the user provides a meeting transcript or asks to process meeting notes.

### Guidance

1. Before ingesting, call `search_brain()` for each attendee name.
   If an attendee already has a page, link to it — never create a duplicate.

2. Extract key decisions as timeline entries (one per decision).

3. If a decision references a technical system (auth, database, API),
   check if an L0/decisions/ page exists and link to it via the `sources:` field.

4. After ingesting, check if this is the 3rd+ meeting on the same topic.
   If so, offer to synthesise to L1.

5. Use `ingest_meeting` tool for the mechanical parsing.
   Use `save_to_brain` for any additional context the tool misses.
