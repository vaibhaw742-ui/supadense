import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { ProjectID } from "../../project/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { InstanceBootstrap } from "../../project/bootstrap"
import { Database } from "../../storage/db"
import { rmSync, existsSync } from "node:fs"

function projectBelongsToUser(projectID: ProjectID, userId: string): boolean {
  const row = Database.Client().$client
    .prepare("SELECT user_id FROM project WHERE id = ?")
    .get(projectID) as { user_id: string | null } | undefined
  return row?.user_id === userId
}

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with OpenCode.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const userId = Instance.current.userId
        const projects = Project.list(userId)
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that OpenCode is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const dir = Instance.directory
        const prev = Instance.project
        const next = await Project.initGit({
          directory: dir,
          project: prev,
        })
        if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return c.json(next)
        await Instance.reload({
          directory: dir,
          worktree: dir,
          project: next,
          init: InstanceBootstrap,
        })
        return c.json(next)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.UpdateInput.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const userId = Instance.current.userId
        if (userId && !projectBelongsToUser(projectID, userId)) {
          return c.json({ error: "Not found" }, 404)
        }
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    )
    .delete(
      "/:projectID",
      describeRoute({
        summary: "Delete project",
        description: "Delete a project and all its data from the database.",
        operationId: "project.delete",
        responses: {
          200: { description: "Deleted", content: { "application/json": { schema: resolver(z.boolean()) } } },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const userId = Instance.current.userId
        if (userId && !projectBelongsToUser(projectID, userId)) {
          return c.json({ error: "Not found" }, 404)
        }
        const project = Project.get(projectID)
        await Project.remove(projectID)
        if (project?.worktree && userId) {
          const userWorkspacePrefix = `/workspaces/${userId}/`
          const isKBDir = project.worktree.startsWith(userWorkspacePrefix)
          if (isKBDir && existsSync(project.worktree)) {
            rmSync(project.worktree, { recursive: true, force: true })
          }
        }
        return c.json(true)
      },
    ),
)
