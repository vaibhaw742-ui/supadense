// URL scraping for MCP capture_source tool
// Uses Airtop webhook (same as el.ts) to get JS-rendered markdown.
// Falls back to plain HTML fetch if AIRTOP_API_KEY is not set.

const AIRTOP_AGENT_WEBHOOK =
  "https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/webhooks/984d5de3-2807-43c8-af8a-f441652a11f4"

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.hostname.replace(/^www\./, "") + u.pathname
    return path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase() + ".md"
  } catch {
    return `source-${Date.now()}.md`
  }
}

async function scrapeWithAirtop(url: string, apiKey: string): Promise<{ content: string; title?: string }> {
  // 1. Trigger
  const triggerRes = await fetch(AIRTOP_AGENT_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ configVars: { url } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!triggerRes.ok) {
    throw new Error(`Airtop trigger failed: HTTP ${triggerRes.status}`)
  }
  const triggerBody = (await triggerRes.json()) as { invocationId?: string }
  const { invocationId } = triggerBody
  if (!invocationId) throw new Error("Airtop did not return invocationId")

  // 2. Poll (Airtop takes ~60-100s)
  const pollUrl = `https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/invocations/${invocationId}/result`
  await new Promise((r) => setTimeout(r, 60_000))
  let elapsed = 60_000
  const MAX_WAIT = 5 * 60 * 1000

  while (elapsed < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, 2_000))
    elapsed += 2_000
    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) continue
    const data = (await res.json()) as { status?: string; output?: unknown; error?: string }
    const statusLower = data.status?.toLowerCase() ?? ""
    if (statusLower === "failed") throw new Error(`Airtop failed: ${data.error ?? "unknown"}`)
    const outputObj = data.output as Record<string, unknown> | undefined
    const isDone = statusLower === "completed" || outputObj?.success === true
    if (isDone && data.output != null) {
      const markdown = typeof data.output === "string"
        ? data.output
        : (outputObj?.text_md ?? outputObj?.markdown ?? outputObj?.content ?? outputObj?.text ?? JSON.stringify(data.output)) as string
      const title = (outputObj?.title as string | undefined) ?? markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
      return { content: markdown.slice(0, 40_000), title }
    }
  }
  throw new Error("Airtop extraction timed out after 5 minutes")
}

async function scrapeWithFetch(url: string): Promise<{ content: string; title?: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Supadense/1.0)", Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim().replace(/\s+/g, " ")
  const content = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ").trim()
    .slice(0, 20_000)
  return { content, title }
}

export async function scrapeUrl(
  url: string,
  titleOverride?: string,
): Promise<{ content: string; title: string; slug: string }> {
  const apiKey = process.env.AIRTOP_API_KEY
  const { content, title: scraped } = apiKey
    ? await scrapeWithAirtop(url, apiKey)
    : await scrapeWithFetch(url)

  const title = titleOverride ?? scraped ?? new URL(url).hostname
  const slug = slugFromUrl(url)

  // Prepend a header if not already present
  const markdown = content.startsWith("#") ? content : `# ${title}\n\nSource: ${url}\n\n${content}`

  return { content: markdown, title, slug }
}
