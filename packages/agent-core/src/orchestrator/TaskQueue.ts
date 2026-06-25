export type QueuedTask = {
  id: string
  agentId: string
  projectId: string
  run: () => Promise<void>
}

export type ExecutionMode = 'sequential' | 'parallel'

export class TaskQueue {
  private queue: QueuedTask[] = []
  private running: Map<string, Promise<void>> = new Map()
  private mode: ExecutionMode
  private maxParallel: number
  private isProcessing = false

  constructor(mode: ExecutionMode = 'sequential', maxParallel = 2) {
    this.mode = mode
    this.maxParallel = maxParallel
  }

  setMode(mode: ExecutionMode, maxParallel?: number): void {
    this.mode = mode
    if (maxParallel !== undefined) this.maxParallel = maxParallel
    console.log(`[TaskQueue] Mode set to ${mode}${maxParallel ? ` (max ${maxParallel} parallel)` : ''}`)
  }

  enqueue(task: QueuedTask): void {
    this.queue.push(task)
    console.log(`[TaskQueue] Enqueued task ${task.id} for agent ${task.agentId} — queue size: ${this.queue.length}`)
    this.process()
  }

  private async process(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      // Loop until BOTH the queue and the in-flight set are empty. Re-checking
      // the queue after each await means a task enqueued during the final drain
      // is picked up here instead of being stranded until the next enqueue().
      while (this.queue.length > 0 || this.running.size > 0) {
        if (this.mode === 'sequential') {
          const task = this.queue.shift()
          if (task) await this.runTask(task)
          else break
        } else {
          // Parallel mode — fill up to maxParallel slots
          while (this.queue.length > 0 && this.running.size < this.maxParallel) {
            const task = this.queue.shift()!
            const promise = this.runTask(task).finally(() => {
              this.running.delete(task.id)
            })
            this.running.set(task.id, promise)
          }

          if (this.running.size > 0) {
            // Wait for at least one slot to free up, then re-evaluate
            await Promise.race(this.running.values())
          }
        }
      }
    } finally {
      this.isProcessing = false
    }
  }

  private async runTask(task: QueuedTask): Promise<void> {
    console.log(`[TaskQueue] Starting task ${task.id} (agent: ${task.agentId})`)
    try {
      await task.run()
      console.log(`[TaskQueue] Completed task ${task.id}`)
    } catch (err) {
      console.error(`[TaskQueue] Task ${task.id} failed:`, err)
    }
  }

  get pendingCount(): number {
    return this.queue.length
  }

  get runningCount(): number {
    return this.running.size
  }

  get currentMode(): ExecutionMode {
    return this.mode
  }

  clear(): void {
    this.queue = []
  }
}
