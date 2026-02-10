/**
 * Workflow IPC handlers — CRUD operations.
 */
import { ipcMain } from 'electron'
import * as workflowRepo from '../db/workflow.repo'
import type { CreateWorkflowInput, SaveWorkflowInput, WorkflowSummary } from '../../../src/workflow/types/ipc'
import type { Workflow } from '../../../src/workflow/types/workflow'

export function registerWorkflowIpc(): void {
  ipcMain.handle('workflow:create', async (_event, input: CreateWorkflowInput): Promise<Workflow> => {
    return workflowRepo.createWorkflow(input.name)
  })

  ipcMain.handle('workflow:save', async (_event, input: SaveWorkflowInput): Promise<void> => {
    const graphDef = { nodes: input.nodes, edges: input.edges }
    workflowRepo.updateWorkflow(input.id, input.name, graphDef, input.status)
  })

  ipcMain.handle('workflow:load', async (_event, args: { id: string }): Promise<Workflow> => {
    const wf = workflowRepo.getWorkflowById(args.id)
    if (!wf) throw new Error(`Workflow ${args.id} not found`)
    return wf
  })

  ipcMain.handle('workflow:list', async (): Promise<WorkflowSummary[]> => {
    return workflowRepo.listWorkflows()
  })

  ipcMain.handle('workflow:delete', async (_event, args: { id: string }): Promise<void> => {
    workflowRepo.deleteWorkflow(args.id)
  })
}
