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
              <button
                type="button"
                class="session-tab"
                classList={{ "session-tab--active": active() }}
                onClick={() => props.onNavigate(session.id)}
                title={title()}
              >
                {/* Session icon */}
                <span class="session-tab-icon">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" fill="currentColor" opacity="0.7" />
                  </svg>
                </span>
                <span class="session-tab-title">{title()}</span>
                <button
                  type="button"
                  class="session-tab-close"
                  onClick={(e) => { e.stopPropagation(); props.onArchive(session) }}
                  title="Close"
                >
                  ×
                </button>
              </button>
            )
          }}
        </For>
      </div>

      {/* New session button */}
      <button
        type="button"
        class="session-tabs-new"
        onClick={props.onNew}
        title="New session"
      >
        +
      </button>
    </div>
  )
}
