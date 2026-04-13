/**
 * markdown.ts — Minimal markdown-to-HTML renderer for wiki pages.
 * Handles the exact subset our wiki-builder.ts generates.
 */

export function renderMarkdown(md: string): string {
  const lines = md.split("\n")
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(escape(lines[i]))
        i++
      }
      out.push(`<pre class="wiki-code" data-lang="${lang}"><code>${codeLines.join("\n")}</code></pre>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      out.push(`<hr class="wiki-hr" />`)
      i++
      continue
    }

    // Headings
    const h3 = line.match(/^### (.+)$/)
    if (h3) { out.push(`<h3 class="wiki-h3">${inline(h3[1])}</h3>`); i++; continue }

    const h2 = line.match(/^## (.+)$/)
    if (h2) {
      const id = h2[1].toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")
      out.push(`<h2 class="wiki-h2" id="${id}">${inline(h2[1])}</h2>`)
      i++; continue
    }

    const h1 = line.match(/^# (.+)$/)
    if (h1) { out.push(`<h1 class="wiki-h1">${inline(h1[1])}</h1>`); i++; continue }

    // Blockquote
    if (line.startsWith("> ")) {
      out.push(`<blockquote class="wiki-blockquote">${inline(line.slice(2))}</blockquote>`)
      i++; continue
    }

    // Bullet list — collect consecutive items
    if (line.match(/^[-*] /)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(`<li>${inline(lines[i].slice(2))}</li>`)
        i++
      }
      out.push(`<ul class="wiki-ul">${items.join("")}</ul>`)
      continue
    }

    // Numbered list
    if (line.match(/^\d+\. /)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\. /, ""))}</li>`)
        i++
      }
      out.push(`<ol class="wiki-ol">${items.join("")}</ol>`)
      continue
    }

    // Empty line
    if (line.trim() === "") {
      i++; continue
    }

    // Paragraph
    out.push(`<p class="wiki-p">${inline(line)}</p>`)
    i++
  }

  return out.join("\n")
}

/** Extract headings (## and ###) for table of contents */
export function extractHeadings(md: string): { level: number; text: string; id: string }[] {
  return md
    .split("\n")
    .filter((l) => l.match(/^#{2,3} /))
    .map((l) => {
      const level = l.startsWith("### ") ? 3 : 2
      const text = l.replace(/^#{2,3} /, "")
      const id = text.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")
      return { level, text, id }
    })
}

// ── Inline formatting ──────────────────────────────────────────────────────────

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function inline(s: string): string {
  let t = escape(s)
  // Images — must come before links
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="wiki-img" />')
  // Inline code
  t = t.replace(/`([^`]+)`/g, `<code class="wiki-inline-code">$1</code>`)
  // Bold
  t = t.replace(/\*\*(.+?)\*\*/g, `<strong>$1</strong>`)
  // Italic
  t = t.replace(/\*(.+?)\*/g, `<em>$1</em>`)
  t = t.replace(/_(.+?)_/g, `<em>$1</em>`)
  // Strikethrough
  t = t.replace(/~~(.+?)~~/g, `<del class="wiki-del">$1</del>`)
  // Links
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" class="wiki-link" target="_blank" rel="noopener">$1</a>`)
  return t
}
