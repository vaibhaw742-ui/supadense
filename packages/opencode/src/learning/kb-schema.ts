// Shared KB structure types and defaults used across workspace and tools.

export interface SchemaSection {
  slug: string
  heading: string
  description: string
}

export interface SchemaSubcategory {
  slug: string
  name: string
  sections: SchemaSection[]
}

export const DEFAULT_SECTIONS: SchemaSection[] = [
  {
    slug: "key-concepts",
    heading: "## Key Concepts",
    description:
      "Core concepts, definitions, and terminology introduced by this resource. Use bullet points: **Term** — definition.",
  },
]

export const DEFAULT_SUBCATEGORIES: SchemaSubcategory[] = [
  {
    slug: "key-concepts",
    name: "Key Concepts",
    sections: [
      {
        slug: "overview",
        heading: "## Overview",
        description:
          "High-level summary of what this resource covers in this topic area. 1-3 sentences. What is the main idea and why does it matter?",
      },
      {
        slug: "definitions",
        heading: "## Definitions",
        description:
          "Define key terms, concepts, and techniques introduced. Use bullet points: **Term** — definition.",
      },
      {
        slug: "mental-models",
        heading: "## Mental Models",
        description:
          "Intuitions, analogies, and ways to think about this topic. How does it connect to things already known?",
      },
    ],
  },
  {
    slug: "papers",
    name: "Papers & Research",
    sections: [
      {
        slug: "summary",
        heading: "## Summary",
        description: "Main contribution in 3-5 sentences. What problem does it solve? What is the key result?",
      },
      {
        slug: "findings",
        heading: "## Key Findings",
        description: "Bullet the most important results, numbers, and insights from this work.",
      },
      {
        slug: "limitations",
        heading: "## Limitations",
        description: "Known limitations, caveats, or open questions raised by this work.",
      },
    ],
  },
  {
    slug: "examples",
    name: "Examples & Implementations",
    sections: [
      {
        slug: "walkthrough",
        heading: "## Walkthrough",
        description: "Step-by-step explanation of a concrete implementation or use case.",
      },
      {
        slug: "code",
        heading: "## Code Snippets",
        description: "Relevant code examples. Use fenced code blocks with language tags.",
      },
    ],
  },
  {
    slug: "tools",
    name: "Tools & Frameworks",
    sections: [
      {
        slug: "overview",
        heading: "## Overview",
        description: "What this tool does, when to use it, and how it compares to alternatives.",
      },
      {
        slug: "usage",
        heading: "## Usage",
        description: "How to install, configure, and use this tool. Include minimal working examples.",
      },
    ],
  },
]
