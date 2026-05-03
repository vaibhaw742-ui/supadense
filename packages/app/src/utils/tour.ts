import { driver } from "driver.js"
import "driver.js/dist/driver.css"

const TOUR_KEY = "supadense.tour.v1"

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "done"
  } catch {
    return false
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, "done")
  } catch {}
}

export function startTour(): void {
  const driverObj = driver({
    showProgress: true,
    showButtons: ["next", "previous", "close"],
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Got it ✓",
    popoverClass: "supadense-tour",
    stagePadding: 6,
    stageRadius: 8,
    onDestroyStarted: () => {
      markTourSeen()
      driverObj.destroy()
    },
    steps: [
      {
        popover: {
          title: "Welcome to Supadense 👋",
          description:
            "This quick tour will show you the key parts of the platform. You can skip at any time.",
          side: "over",
          align: "center",
        },
      },
      {
        element: '[data-component="sidebar-nav-desktop"]',
        popover: {
          title: "Your Knowledge Bases",
          description:
            "All your KBs live here. Each one is an isolated workspace with its own sessions, categories, and wiki.",
          side: "right",
          align: "start",
        },
      },
      {
        element: '[data-tour="create-kb-btn"]',
        popover: {
          title: "Create a Knowledge Base",
          description:
            "Click here to create a new KB. Give it a name and the AI will guide you through setup.",
          side: "right",
          align: "center",
        },
      },
      {
        element: '[data-tour="chat-composer"]',
        popover: {
          title: "Chat with your AI",
          description:
            "Type here to talk to your AI assistant. Ask it to add content, search your KB, explain topics, or organise information.",
          side: "top",
          align: "center",
        },
      },
      {
        element: '[data-tour="kb-tree-panel"]',
        popover: {
          title: "KB Files & Folders",
          description:
            "Your KB structure lives here — categories, sub-categories, wiki pages, and raw files. Expand folders to browse, click any file to open it.",
          side: "left",
          align: "start",
        },
      },
      {
        element: '[data-tour="wiki-btn"]',
        popover: {
          title: "Open Wiki",
          description:
            "View everything in your KB rendered as a searchable wiki. It updates automatically as your KB grows.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="github-btn"]',
        popover: {
          title: "GitHub Sync",
          description:
            "Back up your KB to a private GitHub repo. Commit changes locally, then push to GitHub whenever you're ready.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="chat-composer"]',
        popover: {
          title: "Ready to get started?",
          description:
            "Type <strong>/onboard</strong> in the chat box and press Enter — your AI assistant will walk you through setting up your first Knowledge Base.",
          side: "top",
          align: "center",
        },
      },
    ],
  })

  driverObj.drive()
}
