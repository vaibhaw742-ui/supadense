import { createSignal, Show, onMount, onCleanup } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import LoginPage from "./login"

interface Props {
  backendUrl: string
  onLogin: () => void
}

type View = "landing" | "login" | "signup"

const ORANGE = "#c44a0e"

export default function LandingPage(props: Props) {
  const [view, setView] = createSignal<View>("landing")
  const isMobile = createMediaQuery("(max-width: 640px)")

  onMount(() => {
    document.body.style.overflow = "auto"
    document.body.style.background = "#fff"
    document.documentElement.style.background = "#fff"
    onCleanup(() => {
      document.body.style.overflow = ""
      document.body.style.background = ""
      document.documentElement.style.background = ""
    })
  })

  return (
    <Show
      when={view() === "landing"}
      fallback={
        <LoginPage
          backendUrl={props.backendUrl}
          onLogin={props.onLogin}
          initialMode={view() === "signup" ? "signup" : "login"}
          onBack={() => setView("landing")}
        />
      }
    >
      <div style={{ "min-height": "100dvh", display: "flex", "flex-direction": "column", background: "#fff", "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

        {/* Navbar */}
        <nav style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: isMobile() ? "12px 16px" : "16px 40px", "border-bottom": "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", background: ORANGE, "border-radius": "8px", display: "flex", "align-items": "center", "justify-content": "center", "font-weight": "700", "font-size": "16px", color: "#fff" }}>S</div>
            <span style={{ "font-weight": "600", "font-size": "16px", color: "#111" }}>Supadense</span>
          </div>
          <div style={{ display: "flex", "align-items": "center", gap: isMobile() ? "8px" : "16px" }}>
            <Show when={!isMobile()}>
              <span style={{ "font-size": "14px", "font-weight": "500", color: "#333", padding: "6px 12px", cursor: "default" }}>
                Docs
              </span>
              <button
                onClick={() => setView("login")}
                style={{ background: "none", border: "none", "font-size": "14px", "font-weight": "500", color: "#333", cursor: "pointer", padding: "6px 12px" }}
              >
                Sign in
              </button>
            </Show>
            <button
              onClick={() => setView("signup")}
              style={{ background: ORANGE, border: "none", "border-radius": "8px", "font-size": isMobile() ? "13px" : "14px", "font-weight": "500", color: "#fff", cursor: "pointer", padding: isMobile() ? "7px 14px" : "8px 18px", display: "flex", "align-items": "center", gap: "6px", "white-space": "nowrap" }}
            >
              {isMobile() ? "Get access →" : "Get early access →"}
            </button>
            <Show when={isMobile()}>
              <button
                onClick={() => setView("login")}
                style={{ background: "none", border: "1px solid #ddd", "border-radius": "8px", "font-size": "13px", "font-weight": "500", color: "#333", cursor: "pointer", padding: "7px 12px", "white-space": "nowrap" }}
              >
                Sign in
              </button>
            </Show>
          </div>
        </nav>

        {/* Hero */}
        <main style={{ display: "flex", "flex-direction": "column", "align-items": "center", "text-align": "center", padding: isMobile() ? "40px 16px 48px" : "80px 24px 80px" }}>
          {/* Badge */}
          <div style={{ display: "inline-flex", "align-items": "center", gap: "6px", background: "#fff7f4", border: "1px solid #f5cbb5", "border-radius": "100px", padding: "5px 14px", "margin-bottom": "24px" }}>
            <span style={{ width: "7px", height: "7px", background: ORANGE, "border-radius": "50%", display: "inline-block" }} />
            <span style={{ "font-size": "13px", "font-weight": "500", color: ORANGE }}>Private Beta — Now Open</span>
          </div>

          {/* Headline */}
          <h1 style={{ "font-size": isMobile() ? "clamp(32px, 9vw, 42px)" : "clamp(36px, 6vw, 60px)", "font-weight": "800", "line-height": "1.1", color: "#111", margin: "0 0 16px", "max-width": "640px", "letter-spacing": "-1.5px" }}>
            Agentic second brain<br />for <span style={{ color: ORANGE }}>engineers</span>
          </h1>

          {/* Subtitle */}
          <p style={{ "font-size": isMobile() ? "16px" : "18px", color: "#666", "line-height": "1.6", "max-width": "460px", margin: "0 0 32px" }}>
            Your tech knowledge base that thinks, connects, and upskills you back.
          </p>

          {/* CTAs */}
          <div style={{ display: "flex", gap: "10px", "flex-direction": isMobile() ? "column" : "row", "align-items": "center", "justify-content": "center", "margin-bottom": "12px", width: isMobile() ? "100%" : "auto", "max-width": isMobile() ? "280px" : "none" }}>
            <button
              onClick={() => setView("signup")}
              style={{ background: ORANGE, border: "none", "border-radius": "10px", "font-size": "15px", "font-weight": "600", color: "#fff", cursor: "pointer", padding: "13px 28px", display: "flex", "align-items": "center", "justify-content": "center", gap: "6px", width: isMobile() ? "100%" : "auto" }}
            >
              Get early access →
            </button>
            <button
              onClick={() => setView("login")}
              style={{ background: "#fff", border: "1.5px solid #ddd", "border-radius": "10px", "font-size": "15px", "font-weight": "600", color: "#333", cursor: "pointer", padding: "13px 28px", width: isMobile() ? "100%" : "auto" }}
            >
              See how it works
            </button>
          </div>
          <p style={{ "font-size": "13px", color: "#aaa", margin: "0" }}>Free to get started · No credit card required</p>

          <div style={{ "margin-top": isMobile() ? "40px" : "80px", width: "100%", "max-width": isMobile() ? "100%" : "550px", "margin-left": "auto", "margin-right": "auto", display: "flex", "justify-content": "center" }}>
            <iframe
              src="https://platform.twitter.com/embed/Tweet.html?dnt=true&id=2045132112374964620&theme=light"
              style={{ border: "none", width: "100%", height: isMobile() ? "500px" : "750px", "border-radius": "12px", display: "block" }}
              scrolling="no"
            />
          </div>
        </main>

        {/* Footer */}
        <footer style={{ "border-top": "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", "flex-wrap": "wrap", gap: isMobile() ? "24px" : "40px", padding: isMobile() ? "32px 16px 24px" : "48px 40px 32px", "max-width": "1100px", margin: "0 auto", width: "100%", "box-sizing": "border-box" }}>
            {/* Brand */}
            <div style={{ flex: "1", "min-width": "160px" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "10px", "margin-bottom": "12px" }}>
                <div style={{ width: "28px", height: "28px", background: ORANGE, "border-radius": "7px", display: "flex", "align-items": "center", "justify-content": "center", "font-weight": "700", "font-size": "14px", color: "#fff" }}>S</div>
                <span style={{ "font-weight": "600", "font-size": "15px", color: "#111" }}>Supadense</span>
              </div>
              <p style={{ "font-size": "13px", color: "#888", "line-height": "1.6", margin: "0", "max-width": "200px" }}>
                Agentic second brain to be in top 1% engineer.
              </p>
            </div>

            {/* Links */}
            <div style={{ display: "flex", gap: isMobile() ? "32px" : "60px", "flex-wrap": "wrap" }}>
              <FooterCol title="PRODUCT" links={[["Features", "#"], ["Pricing", "#"], ["Changelog", "#"]]} />
              <FooterCol title="RESOURCES" links={[["Blog", "#"], ["Docs", "#"], ["Discord", "#"]]} />
              <FooterCol title="LEGAL" links={[["Privacy", "#"], ["Terms", "#"]]} />
            </div>
          </div>

          {/* Bottom bar */}
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "flex-wrap": "wrap", gap: "12px", padding: isMobile() ? "12px 16px" : "16px 40px", "border-top": "1px solid #f0f0f0", "max-width": "1100px", margin: "0 auto", width: "100%", "box-sizing": "border-box" }}>
            <span style={{ "font-size": "13px", color: "#aaa" }}>© 2025 Supadense. All rights reserved.</span>
            <div style={{ display: "flex", gap: "12px" }}>
              <SocialIcon label="X" />
              <SocialIcon label="in" />
              <SocialIcon label="💬" />
            </div>
          </div>
        </footer>
      </div>
    </Show>
  )
}


function FooterCol(props: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div style={{ "font-size": "11px", "font-weight": "700", color: "#999", "letter-spacing": "0.8px", "margin-bottom": "14px" }}>{props.title}</div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
        {props.links.map(([label, href]) => (
          <a href={href} style={{ "font-size": "14px", color: "#555", "text-decoration": "none" }}>{label}</a>
        ))}
      </div>
    </div>
  )
}

function SocialIcon(props: { label: string }) {
  return (
    <div style={{ width: "30px", height: "30px", border: "1px solid #e5e5e5", "border-radius": "6px", display: "flex", "align-items": "center", "justify-content": "center", "font-size": "13px", color: "#555", cursor: "pointer" }}>
      {props.label}
    </div>
  )
}
