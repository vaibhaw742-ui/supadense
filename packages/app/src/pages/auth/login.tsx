import { createSignal, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { setAuthToken } from "@/utils/server"

interface Props {
  backendUrl: string
  onLogin: () => void
  initialMode?: "login" | "signup"
  onBack?: () => void
}

type Mode = "login" | "signup"

const ORANGE = "#c44a0e"

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  "font-size": "13px",
  border: "1px solid #e5e5e5",
  "border-radius": "8px",
  background: "#f8f7f7",
  color: "#333",
  outline: "none",
  "box-sizing": "border-box" as const,
}

const linkBtn = {
  background: "none",
  border: "none",
  "font-size": "12px",
  color: ORANGE,
  cursor: "pointer",
  padding: "0",
}

export default function LoginPage(props: Props) {
  const isMobile = createMediaQuery("(max-width: 640px)")
  const [mode, setMode] = createSignal<Mode>(props.initialMode ?? "login")
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [yearsOfExp, setYearsOfExp] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [waitlisted, setWaitlisted] = createSignal(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError("")
    setPassword("")
    setWaitlisted(false)
  }

  const handleLogin = async (e: Event) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch(`${props.backendUrl}/supa-auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email(), password: password() }),
      })
      const data = await res.json()
      if (res.status === 403 && data.error === "waitlist") {
        setWaitlisted(true)
        return
      }
      if (!res.ok) {
        setError(data.error ?? "Login failed")
        return
      }
      setAuthToken(data.token)
      props.onLogin()
    } catch {
      setError("Could not connect to server")
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: Event) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch(`${props.backendUrl}/supa-auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email(), years_of_experience: yearsOfExp() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Registration failed")
        return
      }
      setWaitlisted(true)
    } catch {
      setError("Could not connect to server")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ "min-height": "100dvh", display: "flex", "flex-direction": "column", background: "#fff", "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <nav style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: isMobile() ? "12px 16px" : "16px 40px", "border-bottom": "1px solid #f0f0f0" }}>
        <div
          onClick={props.onBack}
          style={{ display: "flex", "align-items": "center", gap: "10px", cursor: props.onBack ? "pointer" : "default" }}
        >
          <div style={{ width: "32px", height: "32px", background: ORANGE, "border-radius": "8px", display: "flex", "align-items": "center", "justify-content": "center", "font-weight": "700", "font-size": "16px", color: "#fff" }}>S</div>
          <span style={{ "font-weight": "600", "font-size": "16px", color: "#111" }}>Supadense</span>
        </div>
        <Show when={props.onBack}>
          <button
            onClick={props.onBack}
            style={{ background: "none", border: "none", "font-size": "13px", color: "#888", cursor: "pointer", padding: "6px 12px", display: "flex", "align-items": "center", gap: "4px" }}
          >
            ← Back
          </button>
        </Show>
      </nav>

      <div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", padding: "24px" }}>
        <div style={{
          width: "100%",
          "max-width": "360px",
          background: "#fff",
          border: "1px solid #e5e5e5",
          "border-radius": "12px",
          padding: isMobile() ? "20px 16px" : "32px",
          "box-shadow": "0 2px 12px rgba(0,0,0,0.06)",
        }}>
          <div style={{ "text-align": "center", "margin-bottom": "28px" }}>
            <div style={{ "font-size": "20px", "font-weight": "600", color: "#111", "letter-spacing": "-0.3px" }}>
              {mode() === "login" ? "Sign in to continue" : "Create an account"}
            </div>
          </div>

          <Show when={waitlisted()}>
            <div style={{ "text-align": "center", padding: "8px 0 16px" }}>
              <div style={{ "font-size": "32px", "margin-bottom": "12px" }}>⏳</div>
              <div style={{ "font-size": "15px", "font-weight": "600", color: "#111", "margin-bottom": "8px" }}>
                You're on the waitlist
              </div>
              <div style={{ "font-size": "13px", color: "#888", "line-height": "1.6" }}>
                Your request has been received. You'll get access once an admin approves your account.
              </div>
              <button onClick={() => switchMode("login")} style={{ ...linkBtn, "margin-top": "20px", display: "inline-block" }}>
                Back to login
              </button>
            </div>
          </Show>

          <Show when={!waitlisted() && mode() === "login"}>
            <form onSubmit={handleLogin}>
              <div style={{ "margin-bottom": "14px" }}>
                <label style={{ display: "block", "font-size": "12px", "font-weight": "500", color: "#333", "margin-bottom": "6px" }}>
                  Email
                </label>
                <input type="email" required autocomplete="email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} style={inputStyle} placeholder="you@example.com" />
              </div>
              <div style={{ "margin-bottom": "20px" }}>
                <label style={{ display: "block", "font-size": "12px", "font-weight": "500", color: "#333", "margin-bottom": "6px" }}>
                  Password
                </label>
                <input type="password" required autocomplete="current-password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} style={inputStyle} placeholder="••••••••" />
              </div>
              <Show when={error()}>
                <div style={{ "font-size": "12px", color: "#e53e3e", "margin-bottom": "14px", padding: "8px 12px", background: "#fff5f5", "border-radius": "6px", border: "1px solid #fed7d7" }}>
                  {error()}
                </div>
              </Show>
              <button type="submit" disabled={loading()} style={{ width: "100%", padding: "9px", "font-size": "13px", "font-weight": "500", color: "#fff", background: loading() ? "#a0aec0" : ORANGE, border: "none", "border-radius": "8px", cursor: loading() ? "not-allowed" : "pointer" }}>
                {loading() ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div style={{ "text-align": "center", "margin-top": "16px", "font-size": "12px", color: "#888" }}>
              Don't have an account?{" "}
              <button onClick={() => switchMode("signup")} style={linkBtn}>Sign up</button>
            </div>
          </Show>

          <Show when={!waitlisted() && mode() === "signup"}>
            <form onSubmit={handleSignup}>
              <div style={{ "margin-bottom": "14px" }}>
                <label style={{ display: "block", "font-size": "12px", "font-weight": "500", color: "#333", "margin-bottom": "6px" }}>
                  Email
                </label>
                <input type="email" required autocomplete="email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} style={inputStyle} placeholder="you@example.com" />
              </div>
              <div style={{ "margin-bottom": "20px" }}>
                <label style={{ display: "block", "font-size": "12px", "font-weight": "500", color: "#333", "margin-bottom": "6px" }}>
                  Years of Experience
                </label>
                <select
                  required
                  value={yearsOfExp()}
                  onChange={(e) => setYearsOfExp(e.currentTarget.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  <option value="" disabled>Select experience</option>
                  <option value="<2">&lt;2 years</option>
                  <option value="2-5">2–5 years</option>
                  <option value="5-10">5–10 years</option>
                  <option value="10+">10+ years</option>
                </select>
              </div>
              <Show when={error()}>
                <div style={{ "font-size": "12px", color: "#e53e3e", "margin-bottom": "14px", padding: "8px 12px", background: "#fff5f5", "border-radius": "6px", border: "1px solid #fed7d7" }}>
                  {error()}
                </div>
              </Show>
              <button type="submit" disabled={loading()} style={{ width: "100%", padding: "9px", "font-size": "13px", "font-weight": "500", color: "#fff", background: loading() ? "#a0aec0" : ORANGE, border: "none", "border-radius": "8px", cursor: loading() ? "not-allowed" : "pointer" }}>
                {loading() ? "Submitting…" : "Get early access"}
              </button>
            </form>
            <div style={{ "text-align": "center", "margin-top": "16px", "font-size": "12px", color: "#888" }}>
              Already have an account?{" "}
              <button onClick={() => switchMode("login")} style={linkBtn}>Sign in</button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
