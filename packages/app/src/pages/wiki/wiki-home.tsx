import { createResource, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import "./wiki.css"

export default function WikiHome() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()

  const [data] = createResource(() => api.home())

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })

  return (
    <div class="wk-root">
      <div class="wk-layout">
        <div class="wk-content-area">
          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading…</div>
            </Show>

            <Show when={!data.loading}>
              <>
                <h1 class="wk-title">Knowledge Base</h1>

                <Show when={(data()?.recent_events?.length ?? 0) > 0} fallback={
                  <div class="wk-empty-main">
                    <div class="wk-empty-main-icon">📚</div>
                    <div class="wk-empty-main-title">No activity yet</div>
                    <div class="wk-empty-main-desc">
                      Ask the AI to add resources to start building your knowledge base.
                    </div>
                  </div>
                }>
                  <div class="wk-section-label">Recent activity</div>
                  <ul class="wk-activity-list">
                    <For each={data()!.recent_events.slice(0, 20)}>
                      {(ev) => (
                        <li class="wk-activity-item">
                          <span class="wk-activity-dot" data-type={ev.event_type} />
                          <span class="wk-activity-summary">{ev.summary}</span>
                          <span class="wk-activity-date">{formatDate(ev.time_created)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </>
            </Show>
          </main>
        </div>
      </div>
    </div>
  )
}
