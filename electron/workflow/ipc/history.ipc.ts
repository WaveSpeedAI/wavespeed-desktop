/**
 * History IPC handlers — execution history management.
 */
import { ipcMain } from 'electron'
import * as executionRepo from '../db/execution.repo'
import { updateNodeCurrentOutputId } from '../db/node.repo'
import type { NodeExecutionRecord } from '../../../src/workflow/types/execution'

let markDownstreamStaleFn: ((workflowId: string, nodeId: string) => void) | null = null

export function setMarkDownstreamStale(fn: (workflowId: string, nodeId: string) => void): void {
  markDownstreamStaleFn = fn
}

export function registerHistoryIpc(): void {
  ipcMain.handle('history:list', async (_event, args: { nodeId: string }): Promise<NodeExecutionRecord[]> => {
    return executionRepo.getExecutionsByNodeId(args.nodeId)
  })

  ipcMain.handle('history:set-current', async (_event, args: { nodeId: string; executionId: string }) => {
    updateNodeCurrentOutputId(args.nodeId, args.executionId)
    if (markDownstreamStaleFn) {
      const exec = executionRepo.getExecutionById(args.executionId)
      if (exec) markDownstreamStaleFn(exec.workflowId, args.nodeId)
    }
  })

  ipcMain.handle('history:star', async (_event, args: { executionId: string; starred: boolean }) => {
    executionRepo.updateExecutionStarred(args.executionId, args.starred)
  })

  ipcMain.handle('history:score', async (_event, args: { executionId: string; score: number }) => {
    executionRepo.updateExecutionScore(args.executionId, args.score)
  })
}
