import { createEffect, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { getAuthToken, getBackendUrl } from "@/utils/server"
import * as d3 from "d3"

type AnalyticsData = {
  totalUsers: number
  dau: { day: string; users: number }[]
  hourly: { hour: number; events: number }[]
  retention: { cohort_size: number; retained: number }
  messageStats: { day: string; messages: number }[]
}

type UserDetail = {
  id: string
  email: string
  created_at: string
  last_login: string | null
  login_count: number
  message_count: number
}

async function fetchAnalytics(): Promise<AnalyticsData | null> {
  const token = getAuthToken()
  if (!token) return null
  const res = await fetch(`${getBackendUrl()}/supa-auth/admin/analytics`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json()
}

type UserQuery = {
  message_id: string
  time_created: number
  session_title: string
  query_text: string
}

async function fetchUsers(): Promise<UserDetail[] | null> {
  const token = getAuthToken()
  if (!token) return null
  const res = await fetch(`${getBackendUrl()}/supa-auth/admin/users-detail`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json()
}

async function fetchUserQueries(userId: string): Promise<UserQuery[]> {
  const token = getAuthToken()
  if (!token) return []
  const res = await fetch(`${getBackendUrl()}/supa-auth/admin/user-queries?userId=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  return res.json()
}

function BarChart(props: {
  data: { label: string; value: number }[]
  color: string
  height?: number
  yLabel?: string
}) {
  let svgRef: SVGSVGElement | undefined

  onMount(() => {
    if (!svgRef || props.data.length === 0) return

    const margin = { top: 16, right: 16, bottom: 40, left: 48 }
    const width = svgRef.clientWidth - margin.left - margin.right
    const height = (props.height ?? 200) - margin.top - margin.bottom

    const svg = d3.select(svgRef)
    svg.selectAll("*").remove()

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`)

    const x = d3
      .scaleBand()
      .domain(props.data.map((d) => d.label))
      .range([0, width])
      .padding(0.25)

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(props.data, (d) => d.value) ?? 1])
      .nice()
      .range([height, 0])

    // Grid lines
    g.append("g")
      .attr("class", "grid")
      .call(
        d3.axisLeft(y)
          .tickSize(-width)
          .tickFormat(() => "")
          .ticks(5),
      )
      .call((gg) => {
        gg.select(".domain").remove()
        gg.selectAll(".tick line")
          .attr("stroke", "rgba(255,255,255,0.07)")
          .attr("stroke-dasharray", "3,3")
      })

    // X axis — show every nth label to avoid crowding
    const tickEvery = Math.ceil(props.data.length / 10)
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(
        d3.axisBottom(x).tickValues(
          props.data.filter((_, i) => i % tickEvery === 0).map((d) => d.label),
        ),
      )
      .call((gg) => {
        gg.select(".domain").attr("stroke", "rgba(255,255,255,0.15)")
        gg.selectAll(".tick line").remove()
        gg.selectAll(".tick text")
          .attr("fill", "rgba(255,255,255,0.45)")
          .attr("font-size", "11px")
          .attr("dy", "1em")
      })

    // Y axis
    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")))
      .call((gg) => {
        gg.select(".domain").remove()
        gg.selectAll(".tick line").remove()
        gg.selectAll(".tick text")
          .attr("fill", "rgba(255,255,255,0.45)")
          .attr("font-size", "11px")
      })

    // Bars
    g.selectAll(".bar")
      .data(props.data)
      .enter()
      .append("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.label) ?? 0)
      .attr("y", (d) => y(d.value))
      .attr("width", x.bandwidth())
      .attr("height", (d) => height - y(d.value))
      .attr("rx", 3)
      .attr("fill", props.color)
      .attr("opacity", 0.85)
  })

  return (
    <svg
      ref={svgRef!}
      width="100%"
      height={props.height ?? 200}
    />
  )
}

function StatCard(props: { label: string; value: string | number; sub?: string }) {
  return (
    <div class="rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-raised-base)] px-5 py-4 flex flex-col gap-1">
      <div class="text-12-regular text-text-weak uppercase tracking-wide">{props.label}</div>
      <div class="text-28-medium text-text-strong">{props.value}</div>
      <Show when={props.sub}>
        <div class="text-12-regular text-text-weak">{props.sub}</div>
      </Show>
    </div>
  )
}

async function checkAdmin(): Promise<boolean> {
  const token = getAuthToken()
  if (!token) return false
  try {
    const res = await fetch(`${getBackendUrl()}/supa-auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return false
    const data = await res.json() as { is_admin?: boolean }
    return !!data.is_admin
  } catch {
    return false
  }
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [isAdmin] = createResource(checkAdmin)
  const [analytics] = createResource(() => isAdmin() === true || undefined, fetchAnalytics)
  const [users] = createResource(() => isAdmin() === true || undefined, fetchUsers)
  const [tab, setTab] = createSignal<"overview" | "users">("overview")
  const [expandedUser, setExpandedUser] = createSignal<string | null>(null)
  const [queriesCache, setQueriesCache] = createSignal<Record<string, UserQuery[]>>({})
  const [queriesLoading, setQueriesLoading] = createSignal<string | null>(null)

  async function toggleUserQueries(userId: string) {
    if (expandedUser() === userId) {
      setExpandedUser(null)
      return
    }
    setExpandedUser(userId)
    if (queriesCache()[userId]) return
    setQueriesLoading(userId)
    const queries = await fetchUserQueries(userId)
    setQueriesCache((prev) => ({ ...prev, [userId]: queries }))
    setQueriesLoading(null)
  }

  createEffect(() => {
    if (!isAdmin.loading && isAdmin() === false) navigate("/")
  })

  const dauData = () =>
    (analytics()?.dau ?? []).map((d) => ({ label: d.day.slice(5), value: d.users }))

  const hourlyData = () => {
    const hourly = analytics()?.hourly ?? []
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h.toString().padStart(2, "0")}h`,
      value: hourly.find((x) => x.hour === h)?.events ?? 0,
    }))
  }

  const msgData = () =>
    (analytics()?.messageStats ?? []).map((d) => ({ label: d.day.slice(5), value: d.messages }))

  const retentionPct = () => {
    const r = analytics()?.retention
    if (!r || r.cohort_size === 0) return "—"
    return `${Math.round((r.retained / r.cohort_size) * 100)}%`
  }

  function fmtDate(s: string | null) {
    if (!s) return "Never"
    const d = new Date(s)
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
  }

  function daysSince(s: string | null) {
    if (!s) return null
    const diff = Date.now() - new Date(s).getTime()
    return Math.floor(diff / 86400000)
  }

  return (
    <div class="min-h-screen bg-[var(--surface-base)] text-text-strong">
      {/* Header */}
      <div class="border-b border-[var(--border-weak-base)] px-8 py-4 flex items-center gap-4">
        <button
          type="button"
          class="text-text-weak hover:text-text-strong transition-colors text-sm"
          onClick={() => navigate("/")}
        >
          ← Back
        </button>
        <span class="text-20-medium text-text-strong">Admin Dashboard</span>
      </div>

      <div class="px-8 py-6 max-w-7xl mx-auto flex flex-col gap-8">
        {/* Tabs */}
        <div class="flex gap-1 bg-[var(--surface-raised-base)] rounded-lg p-1 w-fit">
          <button
            type="button"
            class={`px-4 py-1.5 rounded-md text-14-medium transition-colors ${tab() === "overview" ? "bg-[var(--surface-raised-stronger-non-alpha)] text-text-strong" : "text-text-weak hover:text-text-strong"}`}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            class={`px-4 py-1.5 rounded-md text-14-medium transition-colors ${tab() === "users" ? "bg-[var(--surface-raised-stronger-non-alpha)] text-text-strong" : "text-text-weak hover:text-text-strong"}`}
            onClick={() => setTab("users")}
          >
            Users
          </button>
        </div>

        <Show when={analytics.loading || users.loading}>
          <div class="text-text-weak text-14-regular">Loading...</div>
        </Show>

        <Show when={analytics.error}>
          <div class="text-red-400 text-14-regular">Failed to load analytics. Are you an admin?</div>
        </Show>

        {/* Overview tab */}
        <Show when={tab() === "overview" && analytics()}>
          {(data) => (
            <div class="flex flex-col gap-8">
              {/* Stat cards */}
              <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatCard label="Total Users" value={data().totalUsers} />
                <StatCard
                  label="DAU (today)"
                  value={data().dau.at(-1)?.users ?? 0}
                  sub="unique logins today"
                />
                <StatCard
                  label="DAU (7-day avg)"
                  value={
                    data().dau.length
                      ? Math.round(
                          data().dau.slice(-7).reduce((s, d) => s + d.users, 0) /
                            Math.min(data().dau.slice(-7).length, 7),
                        )
                      : 0
                  }
                  sub="avg unique logins/day"
                />
                <StatCard
                  label="Week-1 Retention"
                  value={retentionPct()}
                  sub={`${data().retention.retained} of ${data().retention.cohort_size} returned`}
                />
              </div>

              {/* DAU chart */}
              <div class="rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-raised-base)] p-5 flex flex-col gap-3">
                <div class="text-14-medium text-text-strong">Daily Active Users — last 30 days</div>
                <BarChart data={dauData()} color="hsl(20,87%,52%)" height={220} />
              </div>

              {/* Messages per day chart */}
              <div class="rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-raised-base)] p-5 flex flex-col gap-3">
                <div class="text-14-medium text-text-strong">Messages per Day — last 30 days</div>
                <BarChart data={msgData()} color="hsl(210,80%,55%)" height={220} />
              </div>

              {/* Hourly usage */}
              <div class="rounded-xl border border-[var(--border-weak-base)] bg-[var(--surface-raised-base)] p-5 flex flex-col gap-3">
                <div class="text-14-medium text-text-strong">Login Activity by Hour of Day (UTC) — last 30 days</div>
                <BarChart data={hourlyData()} color="hsl(270,70%,60%)" height={180} />
              </div>
            </div>
          )}
        </Show>

        {/* Users tab */}
        <Show when={tab() === "users" && users()}>
          {(list) => (
            <div class="flex flex-col gap-4">
              <div class="text-14-regular text-text-weak">{list().length} approved users</div>
              <div class="rounded-xl border border-[var(--border-weak-base)] overflow-hidden">
                <table class="w-full text-14-regular">
                  <thead>
                    <tr class="border-b border-[var(--border-weak-base)] bg-[var(--surface-raised-base)]">
                      <th class="text-left px-4 py-3 text-12-medium text-text-weak uppercase tracking-wide">Email</th>
                      <th class="text-left px-4 py-3 text-12-medium text-text-weak uppercase tracking-wide">Joined</th>
                      <th class="text-left px-4 py-3 text-12-medium text-text-weak uppercase tracking-wide">Last Login</th>
                      <th class="text-right px-4 py-3 text-12-medium text-text-weak uppercase tracking-wide">Logins</th>
                      <th class="text-right px-4 py-3 text-12-medium text-text-weak uppercase tracking-wide">Messages</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={list()}>
                      {(u) => {
                        const days = daysSince(u.last_login)
                        const lastLoginClass =
                          days === null
                            ? "text-text-weak"
                            : days <= 1
                              ? "text-green-400"
                              : days <= 7
                                ? "text-yellow-400"
                                : "text-text-weak"
                        const isExpanded = () => expandedUser() === u.id
                        const queries = () => queriesCache()[u.id] ?? []
                        const isLoading = () => queriesLoading() === u.id
                        return (
                          <>
                            <tr
                              class="border-b border-[var(--border-weak-base)] hover:bg-[var(--surface-raised-base)] transition-colors cursor-pointer select-none"
                              onClick={() => toggleUserQueries(u.id)}
                            >
                              <td class="px-4 py-3 text-text-strong flex items-center gap-2">
                                <span class="text-text-weak text-10-regular transition-transform" style={{ display: "inline-block", transform: isExpanded() ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                {u.email}
                              </td>
                              <td class="px-4 py-3 text-text-weak">{fmtDate(u.created_at)}</td>
                              <td class={`px-4 py-3 ${lastLoginClass}`}>{fmtDate(u.last_login)}</td>
                              <td class="px-4 py-3 text-right text-text-weak">{u.login_count}</td>
                              <td class="px-4 py-3 text-right text-text-weak">{u.message_count}</td>
                            </tr>
                            <Show when={isExpanded()}>
                              <tr class="border-b border-[var(--border-weak-base)] bg-[var(--surface-base)]">
                                <td colspan="5" class="px-8 py-4">
                                  <div class="text-12-medium text-text-weak uppercase tracking-wide mb-3">Last 10 chat queries</div>
                                  <Show when={isLoading()}>
                                    <div class="text-12-regular text-text-weak">Loading...</div>
                                  </Show>
                                  <Show when={!isLoading() && queries().length === 0}>
                                    <div class="text-12-regular text-text-weak">No queries found.</div>
                                  </Show>
                                  <Show when={!isLoading() && queries().length > 0}>
                                    <div class="flex flex-col gap-2">
                                      <For each={queries()}>
                                        {(q) => (
                                          <div class="flex items-start gap-3 rounded-lg bg-[var(--surface-raised-base)] px-3 py-2">
                                            <span class="text-11-regular text-text-weak whitespace-nowrap pt-0.5 min-w-[120px]">
                                              {new Date(q.time_created).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                                              {" "}
                                              {new Date(q.time_created).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                            <span class="text-12-regular text-text-weak shrink-0">·</span>
                                            <span class="text-12-regular text-text-strong line-clamp-2 flex-1">{q.query_text}</span>
                                            <span class="text-11-regular text-text-weak whitespace-nowrap pt-0.5 shrink-0">{q.session_title}</span>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </td>
                              </tr>
                            </Show>
                          </>
                        )
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
