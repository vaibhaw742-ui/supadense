import { For, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { sessionTitle } from "@/utils/session-title"

interface Props {
  sessions: Session[]
  activeId: string | undefined
  slug: string // base64-encoded workspace dir
  onNavigate: (sessionId: string) => void
  onNew: () => void
  onArchive: (session: Session) => void
}

export function SessionTabs(props: Props) {
  return (
    <div class="session-tabs-bar">
      <div class="session-tabs-scroll">
        <For each={props.sessions}>
          {(session) => {
            const active = () => props.activeId === session.id
            const title = () => sessionTitle(session.title)
            return (
              <div
                class="session-tab"
                classList={{ "session-tab--active": active() }}
                role="button"
                tabIndex={0}
                onClick={() => props.onNavigate(session.id)}
                onKeyDown={(e) => e.key === "Enter" && props.onNavigate(session.id)}
                title={title()}
              >
                <span class="session-tab-icon">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" fill="currentColor" opacity="0.7" />
                  </svg>
                </span>
                <span class="session-tab-title">{title()}</span>
                <span
                  class="session-tab-close"
                  role="button"
                  tabIndex={0}
                  title="Close"
                  onClick={(e) => { e.stopPropagation(); props.onArchive(session) }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); props.onArchive(session) } }}
                >
                  ×
                </span>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
