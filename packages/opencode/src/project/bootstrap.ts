import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Workspace } from "../learning/workspace"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()

  // Ensure KB workspace DB record exists. Scaffolding happens during onboarding
  // (via kb_workspace_init tool) once the user has set their kb_path.
  // If workspace is already onboarded, re-scaffold on startup (idempotent — skips existing files).
  try {
    const project = Instance.project
    let workspace = Workspace.get(project.id)
    if (!workspace) {
      workspace = Workspace.ensure(project.id, Instance.directory)
      Log.Default.info("KB workspace record created", { id: workspace.id })
    } else if (workspace.kb_initialized) {
      Workspace.scaffoldFiles(workspace)
      Log.Default.info("KB workspace ready", { id: workspace.id, path: workspace.kb_path })
    }
  } catch (err) {
    Log.Default.warn("KB workspace init failed (non-fatal)", { error: err })
  }

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}
