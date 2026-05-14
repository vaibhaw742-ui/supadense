import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { elApi, type ElProject } from "./el-api"

interface Props {
  onCreated: (project: ElProject) => void
  onClose: () => void
}

type Step = 1 | 2 | 3

export function CreateProjectDialog(props: Props) {
  const [step, setStep] = createSignal<Step>(1)
  const [name, setName] = createSignal("")
  const [githubUrl, setGithubUrl] = createSignal("")
  const [arxivUrl, setArxivUrl] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  const stepLabels: Record<Step, string> = {
    1: "Name your project",
    2: "Add GitHub repo",
    3: "Add arxiv paper",
  }

  function handleNext() {
    if (step() === 1) {
      if (!name().trim()) { setError("Project name is required"); return }
      setError("")
      setStep(2)
    } else if (step() === 2) {
      setError("")
      setStep(3)
    }
  }

  async function handleCreate() {
    setError("")
    setLoading(true)
    try {
      const project = await elApi.createProject({
        name: name().trim(),
        github_url: githubUrl().trim() || undefined,
        arxiv_url: arxivUrl().trim() || undefined,
      })
      props.onCreated(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project")
    } finally {
      setLoading(false)
    }
  }

  const modalStyle = {
    background: "var(--surface-raised-stronger-non-alpha)",
    "border-color": "var(--border-weak-base)",
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div class="rounded-xl shadow-lg border w-full max-w-sm mx-4" style={modalStyle}>
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--border-weak-base)" }}>
          <span class="text-16-medium text-text-strong">New Project</span>
          <button type="button" class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none" onClick={props.onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div class="flex items-center justify-center gap-2 pt-4 pb-1">
          {([1, 2, 3] as Step[]).map((s) => (
            <div
              class="rounded-full transition-all"
              style={{
                width: step() === s ? "20px" : "6px",
                height: "6px",
                background: step() >= s ? "var(--color-amber-400, #f59e0b)" : "var(--border-weak-base)",
              }}
            />
          ))}
        </div>

        <div class="px-5 pt-2 pb-1">
          <div class="text-12-regular text-text-weak text-center">{stepLabels[step()]}</div>
        </div>

        {/* Body */}
        <div class="flex flex-col gap-4 px-6 py-4">
          <Show when={step() === 1}>
            <input
              autofocus
              class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
              classList={{ "border-red-500 focus:border-red-500": !!error() }}
              placeholder="e.g. BERT Fine-tuning Research"
              value={name()}
              onInput={(e) => { setName(e.currentTarget.value); setError("") }}
              onKeyDown={(e) => { if (e.key === "Enter") handleNext(); if (e.key === "Escape") props.onClose() }}
            />
          </Show>

          <Show when={step() === 2}>
            <input
              autofocus
              class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
              placeholder="https://github.com/owner/repo"
              value={githubUrl()}
              onInput={(e) => setGithubUrl(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleNext(); if (e.key === "Escape") props.onClose() }}
            />
            <div class="text-12-regular text-text-weak -mt-2">
              We'll fetch the README and repo metadata automatically.
            </div>
          </Show>

          <Show when={step() === 3}>
            <input
              autofocus
              class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
              placeholder="https://arxiv.org/abs/2305.10403"
              value={arxivUrl()}
              onInput={(e) => setArxivUrl(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") props.onClose() }}
            />
            <div class="text-12-regular text-text-weak -mt-2">
              We'll fetch the abstract and paper metadata.
            </div>
          </Show>

          <Show when={error()}>
            <div class="text-12-regular text-red-500">{error()}</div>
          </Show>

          {/* Footer */}
          <div class="flex items-center justify-between pt-1">
            <Show
              when={step() > 1}
              fallback={<Button variant="ghost" size="large" onClick={props.onClose}>Cancel</Button>}
            >
              <Button variant="ghost" size="large" onClick={() => setStep((s) => (s - 1) as Step)}>← Back</Button>
            </Show>

            <div class="flex items-center gap-2">
              <Show when={step() > 1}>
                <button
                  type="button"
                  class="text-12-regular text-text-weak hover:text-text-base transition-colors px-2"
                  onClick={() => { if (step() === 2) setStep(3); else handleCreate() }}
                >
                  Skip
                </button>
              </Show>

              <Show
                when={step() < 3}
                fallback={
                  <Button variant="primary" size="large" disabled={loading()} onClick={handleCreate}>
                    {loading() ? "Creating…" : "Create Project"}
                  </Button>
                }
              >
                <Button variant="primary" size="large" onClick={handleNext}>Next →</Button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
