import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { getAuthToken, getBackendUrl } from "@/utils/server"

type User = { id: string; email: string; status?: string; created_at: string }

function authHeaders() {
  return { Authorization: `Bearer ${getAuthToken()}` }
}

async function fetchUsers(): Promise<User[]> {
  const res = await fetch(`${getBackendUrl()}/supa-auth/users`, { headers: authHeaders() })
  if (!res.ok) throw new Error("Failed to fetch users")
  return res.json()
}

async function fetchWaitlist(): Promise<User[]> {
  const res = await fetch(`${getBackendUrl()}/supa-auth/waitlist`, { headers: authHeaders() })
  if (!res.ok) throw new Error("Failed to fetch waitlist")
  return res.json()
}

export const SettingsUsers: Component = () => {
  const [users, { refetch: refetchUsers }] = createResource(fetchUsers)
  const [waitlist, { refetch: refetchWaitlist }] = createResource(fetchWaitlist)
  const [email, setEmail] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [creating, setCreating] = createSignal(false)
  // approving: tracks which waitlist user id is being approved + their temp password
  const [approvingId, setApprovingId] = createSignal<string | null>(null)
  const [approvePassword, setApprovePassword] = createSignal("")

  const refetchAll = () => { refetchUsers(); refetchWaitlist() }

  async function createUser() {
    if (!email() || !password()) return
    setCreating(true)
    try {
      const res = await fetch(`${getBackendUrl()}/supa-auth/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ email: email(), password: password() }),
      })
      const data = await res.json()
      if (!res.ok) { showToast({ title: data.error ?? "Failed to create user", variant: "error" }); return }
      showToast({ title: `User ${data.email} created`, variant: "success" })
      setEmail(""); setPassword("")
      refetchUsers()
    } finally {
      setCreating(false)
    }
  }

  async function confirmApprove(id: string, userEmail: string) {
    if (!approvePassword() || approvePassword().length < 6) {
      showToast({ title: "Password must be at least 6 characters", variant: "error" })
      return
    }
    const res = await fetch(`${getBackendUrl()}/supa-auth/waitlist/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ password: approvePassword() }),
    })
    if (!res.ok) { showToast({ title: "Failed to approve user", variant: "error" }); return }
    showToast({ title: `${userEmail} approved — share the password with them`, variant: "success" })
    setApprovingId(null); setApprovePassword("")
    refetchAll()
  }

  async function rejectUser(id: string, userEmail: string) {
    const res = await fetch(`${getBackendUrl()}/supa-auth/waitlist/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    })
    if (!res.ok) { showToast({ title: "Failed to reject user", variant: "error" }); return }
    showToast({ title: `${userEmail} rejected`, variant: "success" })
    refetchWaitlist()
  }

  async function deleteUser(id: string, userEmail: string) {
    const res = await fetch(`${getBackendUrl()}/supa-auth/users/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    })
    const data = await res.json()
    if (!res.ok) { showToast({ title: data.error ?? "Failed to remove user", variant: "error" }); return }
    showToast({ title: `${userEmail} removed`, variant: "success" })
    refetchUsers()
  }

  const card = {
    padding: "10px 12px",
    "border-radius": "6px",
    background: "var(--color-surface-raised-base)",
    border: "1px solid var(--color-border-base)",
    display: "flex",
    "flex-direction": "column" as const,
    gap: "8px",
  }

  const inputStyle = {
    background: "var(--color-surface-raised-base)",
    border: "1px solid var(--color-border-base)",
    "border-radius": "6px",
    padding: "6px 10px",
    "font-size": "13px",
    color: "var(--color-text-base)",
    outline: "none",
    width: "100%",
  }

  const sectionTitle = {
    "font-size": "13px",
    "font-weight": "600",
    "margin-bottom": "10px",
    color: "var(--color-text-base)",
    display: "flex",
    "align-items": "center",
    gap: "6px",
  }

  return (
    <div style={{ padding: "24px", display: "flex", "flex-direction": "column", gap: "28px" }}>

      {/* Waitlist */}
      <div>
        <div style={sectionTitle}>
          Waitlist
          <Show when={waitlist() && waitlist()!.length > 0}>
            <span style={{ background: "var(--color-brand-base, #6366f1)", color: "#fff", "border-radius": "9999px", "font-size": "10px", "font-weight": "600", padding: "1px 6px" }}>
              {waitlist()!.length}
            </span>
          </Show>
        </div>
        <Show when={!waitlist.loading} fallback={<div style={{ "font-size": "13px", color: "var(--color-text-dimmed)" }}>Loading...</div>}>
          <Show
            when={(waitlist() ?? []).length > 0}
            fallback={<div style={{ "font-size": "13px", color: "var(--color-text-dimmed)" }}>No pending requests</div>}
          >
            <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
              <For each={waitlist()}>
                {(user) => (
                  <div style={card}>
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                      <div>
                        <div style={{ "font-size": "13px", color: "var(--color-text-base)" }}>{user.email}</div>
                        <div style={{ "font-size": "11px", color: "var(--color-text-dimmed)" }}>
                          Requested {new Date(user.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => { setApprovingId(approvingId() === user.id ? null : user.id); setApprovePassword("") }}
                        >
                          Approve
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => rejectUser(user.id, user.email)}>
                          Reject
                        </Button>
                      </div>
                    </div>
                    <Show when={approvingId() === user.id}>
                      <div style={{ display: "flex", gap: "6px", "padding-top": "4px" }}>
                        <input
                          type="password"
                          placeholder="Set temporary password (min 6 chars)"
                          value={approvePassword()}
                          onInput={(e) => setApprovePassword(e.currentTarget.value)}
                          style={{ ...inputStyle, flex: "1" }}
                        />
                        <Button variant="primary" size="sm" onClick={() => confirmApprove(user.id, user.email)}>
                          Confirm
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setApprovingId(null); setApprovePassword("") }}>
                          Cancel
                        </Button>
                      </div>
                      <div style={{ "font-size": "11px", color: "var(--color-text-dimmed)" }}>
                        Share this password with the user so they can log in.
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* Invite user directly */}
      <div>
        <div style={sectionTitle}>Invite user directly</div>
        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <input type="email" placeholder="Email" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} style={inputStyle} />
          <input type="password" placeholder="Temporary password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} style={inputStyle} />
          <Button variant="primary" size="sm" disabled={!email() || !password() || creating()} onClick={createUser}>
            {creating() ? "Creating..." : "Create user"}
          </Button>
        </div>
      </div>

      {/* Active members */}
      <div>
        <div style={sectionTitle}>Active members</div>
        <Show when={!users.loading} fallback={<div style={{ "font-size": "13px", color: "var(--color-text-dimmed)" }}>Loading...</div>}>
          <Show when={!users.error} fallback={<div style={{ "font-size": "13px", color: "var(--color-text-error)" }}>Failed to load users</div>}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <For each={users()}>
                {(user) => (
                  <div style={{ ...card, "flex-direction": "row", "align-items": "center", "justify-content": "space-between" }}>
                    <div>
                      <div style={{ "font-size": "13px", color: "var(--color-text-base)" }}>{user.email}</div>
                      <div style={{ "font-size": "11px", color: "var(--color-text-dimmed)" }}>
                        Joined {new Date(user.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => deleteUser(user.id, user.email)}>
                      Remove
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

    </div>
  )
}
