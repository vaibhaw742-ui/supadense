import { createSignal } from "solid-js"

// Module-level signal shared between the global FAB (layout.tsx) and the
// panel content (directory-layout.tsx, inside SDK/Sync/Local providers).
export const [chatOpen, setChatOpen] = createSignal(false)
