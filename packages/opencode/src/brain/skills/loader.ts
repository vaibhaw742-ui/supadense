import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname }  from "node:path"
import { fileURLToPath }   from "node:url"

export interface BrainSkill {
  name:      string
  triggers:  string[]
  tools:     string[]
  guidance:  string
}

function parseSkillMd(content: string): Pick<BrainSkill, "name" | "triggers" | "tools"> {
  const name: string[] = []
  const triggers: string[] = []
  const tools: string[] = []

  if (!content.startsWith("---")) return { name: "", triggers, tools }

  const end = content.indexOf("---", 3)
  if (end < 3) return { name: "", triggers, tools }

  const fm = content.slice(3, end)
  let inTriggers = false
  let inTools    = false

  for (const line of fm.split("\n")) {
    if (line.startsWith("name:"))      { name.push(line.slice(5).trim()); inTriggers = inTools = false; continue }
    if (line.startsWith("triggers:"))  { inTriggers = true;  inTools = false; continue }
    if (line.startsWith("tools:"))     { inTools = true; inTriggers = false; continue }
    if (line.match(/^\w+:/) && !line.startsWith("  ")) { inTriggers = inTools = false; continue }
    if (inTriggers && line.startsWith("  - ")) triggers.push(line.slice(4).trim().replace(/^["']|["']$/g, ""))
    if (inTools    && line.startsWith("  - ")) tools.push(line.slice(4).trim())
  }

  return { name: name[0] ?? "", triggers, tools }
}

function parseGuidance(content: string): string {
  if (!content.startsWith("---")) return content
  const end = content.indexOf("---", 3)
  return end > 3 ? content.slice(end + 3).trim() : content
}

/** Load built-in skill files shipped with supadense */
function loadBuiltInSkills(): BrainSkill[] {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)))
  const skills: BrainSkill[] = []

  for (const entry of readdirSync(skillsDir)) {
    if (!entry.endsWith(".md")) continue
    try {
      const content = readFileSync(join(skillsDir, entry), "utf8")
      const { name, triggers, tools } = parseSkillMd(content)
      if (!name || !triggers.length) continue
      skills.push({ name, triggers, tools, guidance: parseGuidance(content) })
    } catch {}
  }
  return skills
}

/** Load user-defined skills from .brain/skills/ */
function loadUserSkills(brainDir: string): BrainSkill[] {
  const skillsDir = join(brainDir, "skills")
  if (!existsSync(skillsDir)) return []

  const skills: BrainSkill[] = []
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.endsWith(".md")) continue
    try {
      const content = readFileSync(join(skillsDir, entry), "utf8")
      const { name, triggers, tools } = parseSkillMd(content)
      if (!name || !triggers.length) continue
      skills.push({ name, triggers, tools, guidance: parseGuidance(content) })
    } catch {}
  }
  return skills
}

export function loadBrainSkills(brainDir?: string): BrainSkill[] {
  const builtIn   = loadBuiltInSkills()
  const userDefined = brainDir ? loadUserSkills(brainDir) : []
  // User-defined skills override built-ins with the same name
  const map = new Map<string, BrainSkill>()
  for (const s of [...builtIn, ...userDefined]) map.set(s.name, s)
  return [...map.values()]
}

export function buildSkillSystemPrompt(skills: BrainSkill[]): string {
  if (!skills.length) return ""

  const sections = skills.map((s) => `
### Skill: ${s.name}
Triggers: ${s.triggers.map((t) => `"${t}"`).join(", ")}
${s.guidance}
`).join("\n---\n")

  return `
## Brain Skills

You have access to a project knowledge brain. The following skills define how to use it:

${sections}

## Core Rule
When a question matches a skill trigger, follow the skill guidance.
Always prefer searching the brain before answering from scratch.
`.trim()
}
