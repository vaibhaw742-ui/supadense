/**
 * backlinks-panel.tsx — Shows other pages that link to this one.
 */
import { For, Show, createResource, createSignal } from "solid-js"
import { useWikiApi } from "./wiki-api"

interface Props {
  slug: string
  onNavigate: (slug: string, label: string) => void
}

export function BacklinksPanel(props: Props) {
  const wikiApi = useWikiApi()
  const [open, setOpen] = createSignal(false)

  const [backlinksData] = createResource(
    () => open() ? props.slug : null,
    (slug) => wikiApi.backlinks(slug),
  )

  return (
    <div class="backlinks-panel shrink-0 border-t border-border-weaker-base">
      <button
        class="w-full flex items-center gap-2 px-4 py-2 text-11-regular text-text-weak hover:text-text-base hover:bg-surface-base-hover"
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ "font-size": "10px" }}>{open() ? "▾" : "▸"}</span>
        <span>Backlinks</span>
        <Show when={backlinksData()?.backlinks.length}>
          {(count) => (
            <span class="ml-1 px-1.5 py-0.5 rounded text-10-regular bg-surface-base text-text-weak">
              {count()}
            </span>
          )}
        </Show>
      </button>

      <Show when={open()}>
        <div class="px-4 pb-3">
          <Show when={backlinksData.loading}>
            <div class="text-12-regular text-text-weakest py-2">Loading…</div>
          </Show>
          <Show when={!backlinksData.loading && backlinksData()?.backlinks.length === 0}>
            <div class="text-12-regular text-text-weakest py-2">No references to this page yet.</div>
          </Show>
          <Show when={!backlinksData.loading && (backlinksData()?.backlinks.length ?? 0) > 0}>
            <div class="flex flex-col gap-2 pt-1">
              <For each={backlinksData()?.backlinks}>
                {(link) => (
                  <div class="flex flex-col gap-0.5">
                    <button
                      class="text-11-regular text-text-link hover:underline text-left"
                      onClick={() => props.onNavigate(link.from_page.slug, link.from_page.title)}
                    >
                      {link.from_page.title}
                    </button>
                    <div class="text-11-regular text-text-weak truncate pl-2 border-l-2 border-border-weaker-base">
                      {link.block.content.slice(0, 120)}{link.block.content.length > 120 ? "…" : ""}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
