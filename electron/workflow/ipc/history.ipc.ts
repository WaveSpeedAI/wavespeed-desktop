/**
 * History IPC handlers — execution history management.
 */
import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as executionRepo from '../db/execution.repo'
import { updateNodeCurrentOutputId } from '../db/node.repo'
import type { NodeExecutionRecord } from '../../../src/workflow/types/execution'

let markDownstreamStaleFn: ((workflowId: string, nodeId: string) => void) | null = null

export function setMarkDownstreamStale(fn: (workflowId: string, nodeId: string) => void): void {
  markDownstreamStaleFn = fn
}

/**
 * Try to delete local files referenced by a result record.
 * Only deletes `local-asset://` URLs (files stored on disk).
 * Remote URLs are ignored. Failures are silently swallowed.
 */
function deleteResultFiles(record: NodeExecutionRecord): void {
  const urls: string[] = []
  // Collect all result URLs
  if (record.resultPath) urls.push(record.resultPath)
  const meta = record.resultMetadata as Record<string, unknown> | null
  const metaUrls = meta?.resultUrls as string[] | undefined
  if (Array.isArray(metaUrls)) {
    for (const u of metaUrls) { if (u && typeof u === 'string') urls.push(u) }
  }

  for (const url of urls) {
    if (!/^local-asset:\/\//i.test(url)) continue
    try {
      const filePath = decodeURIComponent(url.replace(/^local-asset:\/\//i, ''))
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch { /* best-effort */ }
  }
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

  /** Delete a single execution record and its local result files */
  ipcMain.handle('history:delete', async (_event, args: { executionId: string }) => {
    const record = executionRepo.getExecutionById(args.executionId)
    if (record) {
      deleteResultFiles(record)
      executionRepo.deleteExecution(args.executionId)
    }
  })

  /** Delete ALL execution records for a node and their local result files */
  ipcMain.handle('history:delete-all', async (_event, args: { nodeId: string }) => {
    const records = executionRepo.getExecutionsByNodeId(args.nodeId)
    for (const record of records) {
      deleteResultFiles(record)
    }
    executionRepo.deleteExecutionsByNodeId(args.nodeId)
  })
}
