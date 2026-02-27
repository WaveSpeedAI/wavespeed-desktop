/**
 * File storage service — organize workflow data by workflow name.
 *
 * Directory structure under workflow-data/:
 *
 * {workflow_name}/
 * ├── config/
 * │   └── workflow.json         ← Flow snapshot (nodes, edges, params)
 * └── media_output/
 *     ├── {workflow_name}_{YYYYMMDD}_{HHmmss}_node1.png
 *     ├── {workflow_name}_{YYYYMMDD}_{HHmmss}_node2.mp4
 *     └── ...
 *
 * workflow.db sits at the root level.
 */
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import https from 'https'
import http from 'http'
import type { GraphDefinition } from '../../../src/workflow/types/workflow'

const ROOT_DIR_NAME = 'workflow-data'

function getWorkflowDataRoot(): string {
  // Packaged app runs inside app.asar (read-only); use userData for writes.
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), ROOT_DIR_NAME)
  }
  // Keep dev behavior as-is for easier debugging.
  return path.join(app.getAppPath(), ROOT_DIR_NAME)
}

function sanitizeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').trim() || 'unnamed'
}

function timestamp(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
}

function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).toLowerCase()
    if (ext && ext.length <= 5) return ext
  } catch { /* ignore */ }
  return '.png'
}

export interface WorkflowSnapshot {
  workflowId: string
  name: string
  graphDefinition: GraphDefinition
  savedAt: string
}

/** Global singleton instance */
let _instance: FileStorageService | null = null

export function getFileStorageInstance(): FileStorageService {
  if (!_instance) _instance = new FileStorageService()
  return _instance
}

export class FileStorageService {
  private rootPath: string
  private nameMap = new Map<string, string>()

  constructor(basePath?: string) {
    if (basePath) {
      this.rootPath = basePath
    } else {
      try {
        this.rootPath = getWorkflowDataRoot()
      } catch {
        this.rootPath = path.join(process.cwd(), ROOT_DIR_NAME)
      }
    }
  }

  /* ─── Name mapping ──────────────────────────────────────────── */

  registerWorkflowName(workflowId: string, name: string): void {
    this.nameMap.set(workflowId, sanitizeName(name))
  }

  private resolveDirName(workflowId: string): string {
    return this.nameMap.get(workflowId) ?? workflowId
  }

  /**
   * Rename a workflow's data directory on disk.
   * If the old directory exists, rename it to the new sanitized name.
   * If the target directory already exists (name collision from another workflow),
   * remove the target first so the rename can proceed.
   * Returns true if rename succeeded, false if no old dir existed.
   */
  renameWorkflowDir(workflowId: string, oldName: string, newName: string): boolean {
    const oldSanitized = sanitizeName(oldName)
    const newSanitized = sanitizeName(newName)

    // No-op if sanitized names are the same
    if (oldSanitized === newSanitized) {
      this.registerWorkflowName(workflowId, newName)
      return true
    }

    const oldDir = path.join(this.rootPath, oldSanitized)
    const newDir = path.join(this.rootPath, newSanitized)

    if (!fs.existsSync(oldDir)) {
      // Old dir doesn't exist — just update the name mapping
      this.registerWorkflowName(workflowId, newName)
      return false
    }

    // If target directory already exists (orphaned from a deleted/renamed workflow),
    // remove it so we can rename cleanly
    if (fs.existsSync(newDir)) {
      fs.rmSync(newDir, { recursive: true, force: true })
    }

    fs.renameSync(oldDir, newDir)
    this.registerWorkflowName(workflowId, newName)
    return true
  }

  /* ─── Path helpers ──────────────────────────────────────────── */

  getWorkflowDir(workflowId: string): string {
    return path.join(this.rootPath, this.resolveDirName(workflowId))
  }

  getConfigDir(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), 'config')
  }

  getMediaOutputDir(workflowId: string): string {
    return path.join(this.getWorkflowDir(workflowId), 'media_output')
  }

  getWorkflowSnapshotPath(workflowId: string): string {
    return path.join(this.getConfigDir(workflowId), 'workflow.json')
  }

  /** Legacy aliases for backward compat */
  getNodeUploadDir(workflowId: string, nodeId: string): string {
    return path.join(this.getConfigDir(workflowId), 'uploads', nodeId)
  }
  getNodeOutputDir(workflowId: string, nodeId: string): string {
    return path.join(this.getMediaOutputDir(workflowId), nodeId)
  }
  getExecutionDir(workflowId: string, nodeId: string, executionId: string): string {
    return path.join(this.getNodeOutputDir(workflowId, nodeId), executionId)
  }
  getArtifactPath(workflowId: string, nodeId: string, executionId: string, filename: string): string {
    return path.join(this.getExecutionDir(workflowId, nodeId, executionId), filename)
  }
  getCacheDir(workflowId: string): string {
    return this.getMediaOutputDir(workflowId)
  }

  /* ─── Directory management ──────────────────────────────────── */

  ensureDir(dir: string): string {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  ensureExecutionDir(workflowId: string, nodeId: string, executionId: string): string {
    return this.ensureDir(this.getExecutionDir(workflowId, nodeId, executionId))
  }

  ensureNodeUploadDir(workflowId: string, nodeId: string): string {
    return this.ensureDir(this.getNodeUploadDir(workflowId, nodeId))
  }

  ensureBaseDir(): void {
    this.ensureDir(this.rootPath)
  }

  /* ─── Workflow config ───────────────────────────────────────── */

  saveWorkflowSnapshot(workflowId: string, name: string, graphDefinition: GraphDefinition): void {
    this.registerWorkflowName(workflowId, name)
    this.ensureDir(this.getConfigDir(workflowId))
    const snapshot: WorkflowSnapshot = { workflowId, name, graphDefinition, savedAt: new Date().toISOString() }
    fs.writeFileSync(this.getWorkflowSnapshotPath(workflowId), JSON.stringify(snapshot, null, 2), 'utf-8')
  }

  loadWorkflowSnapshot(workflowId: string): WorkflowSnapshot | null {
    const p = this.getWorkflowSnapshotPath(workflowId)
    if (!fs.existsSync(p)) return null
    try {
      const snap = JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkflowSnapshot
      if (snap.name) this.registerWorkflowName(workflowId, snap.name)
      return snap
    } catch { return null }
  }

  /* ─── Media output download ─────────────────────────────────── */

  /**
   * Download a result URL to the media_output/ directory.
   * Naming: {workflow_name}_{YYYYMMDD}_{HHmmss}_{modelSlug}.{ext}
   * Returns the local file path.
   */
  async downloadResult(workflowId: string, url: string, modelId?: string): Promise<string> {
    const dir = this.ensureDir(this.getMediaOutputDir(workflowId))
    const wfName = this.resolveDirName(workflowId)
    const modelSlug = modelId ? sanitizeName(modelId.split('/').pop() || 'output') : 'output'
    const ext = guessExtFromUrl(url)
    const filename = `${wfName}_${timestamp()}_${modelSlug}${ext}`
    const filePath = path.join(dir, filename)

    await this.downloadFile(url, filePath)
    return filePath
  }

  private downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http
      const file = fs.createWriteStream(dest)
      proto.get(url, (response) => {
        // Follow redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close()
          fs.unlinkSync(dest)
          this.downloadFile(response.headers.location, dest).then(resolve).catch(reject)
          return
        }
        response.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', (err) => { fs.unlinkSync(dest); reject(err) })
      }).on('error', (err) => { fs.unlinkSync(dest); reject(err) })
    })
  }

  /* ─── User uploads ──────────────────────────────────────────── */

  /**
   * Save node output (e.g. from renderer-based free-tool) to media_output/nodeId/.
   * Returns the local file path.
   */
  saveNodeOutput(workflowId: string, nodeId: string, prefix: string, ext: string, data: Buffer): string {
    const dir = this.ensureDir(this.getNodeOutputDir(workflowId, nodeId))
    const safeExt = ext.startsWith('.') ? ext : `.${ext}`
    const filename = `${prefix}_${timestamp()}${safeExt}`
    const filePath = path.join(dir, filename)
    fs.writeFileSync(filePath, data)
    return filePath
  }

  saveUploadedFile(workflowId: string, nodeId: string, filename: string, data: Buffer): string {
    this.ensureNodeUploadDir(workflowId, nodeId)
    let targetName = filename
    const dir = this.getNodeUploadDir(workflowId, nodeId)
    if (fs.existsSync(path.join(dir, targetName))) {
      const ext = path.extname(filename)
      const base = path.basename(filename, ext)
      targetName = `${base}_${Date.now()}${ext}`
    }
    const filePath = path.join(dir, targetName)
    fs.writeFileSync(filePath, data)
    return filePath
  }

  copyUploadedFile(workflowId: string, nodeId: string, sourcePath: string): string {
    const filename = path.basename(sourcePath)
    this.ensureNodeUploadDir(workflowId, nodeId)
    const destPath = path.join(this.getNodeUploadDir(workflowId, nodeId), filename)
    fs.copyFileSync(sourcePath, destPath)
    return destPath
  }

  listUploadedFiles(workflowId: string, nodeId: string): string[] {
    const dir = this.getNodeUploadDir(workflowId, nodeId)
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).map(f => path.join(dir, f))
  }

  /* ─── Execution metadata (kept for DB cache lookups) ────────── */

  saveExecutionInput(workflowId: string, nodeId: string, executionId: string, input: Record<string, unknown>): void {
    this.ensureExecutionDir(workflowId, nodeId, executionId)
    fs.writeFileSync(path.join(this.getExecutionDir(workflowId, nodeId, executionId), 'input.json'), JSON.stringify(input, null, 2), 'utf-8')
  }

  saveExecutionParams(workflowId: string, nodeId: string, executionId: string, params: Record<string, unknown>): void {
    this.ensureExecutionDir(workflowId, nodeId, executionId)
    fs.writeFileSync(path.join(this.getExecutionDir(workflowId, nodeId, executionId), 'params.json'), JSON.stringify(params, null, 2), 'utf-8')
  }

  saveExecutionMetadata(workflowId: string, nodeId: string, executionId: string, metadata: Record<string, unknown>): void {
    this.ensureExecutionDir(workflowId, nodeId, executionId)
    fs.writeFileSync(path.join(this.getExecutionDir(workflowId, nodeId, executionId), 'meta.json'), JSON.stringify(metadata, null, 2), 'utf-8')
  }

  listNodeExecutions(workflowId: string, nodeId: string): string[] {
    const dir = this.getNodeOutputDir(workflowId, nodeId)
    if (!fs.existsSync(dir)) return []
    try {
      return fs.readdirSync(dir)
        .filter(f => { try { return fs.statSync(path.join(dir, f)).isDirectory() } catch { return false } })
        .sort((a, b) => {
          try {
            return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs
          } catch { return 0 }
        })
    } catch { return [] }
  }

  /* ─── Cleanup ───────────────────────────────────────────────── */

  deleteWorkflowFiles(workflowId: string): void {
    const dir = this.getWorkflowDir(workflowId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }

  deleteNodeOutputs(workflowId: string, nodeId: string): void {
    const dir = this.getNodeOutputDir(workflowId, nodeId)
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }

  /* ─── Disk usage ────────────────────────────────────────────── */

  getWorkflowDiskUsage(workflowId: string): number {
    return this.getDirSize(this.getWorkflowDir(workflowId))
  }

  artifactExists(p: string): boolean { return fs.existsSync(p) }
  getRootPath(): string { return this.rootPath }

  private getDirSize(dirPath: string): number {
    if (!fs.existsSync(dirPath)) return 0
    let total = 0
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const fp = path.join(d, f)
        const s = fs.statSync(fp)
        if (s.isDirectory()) walk(fp); else total += s.size
      }
    }
    walk(dirPath)
    return total
  }
}
