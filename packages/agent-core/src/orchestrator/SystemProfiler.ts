import si from 'systeminformation'
import type { ExecutionMode } from './TaskQueue.js'

export interface SystemProfile {
  totalRamGb: number
  freeRamGb: number
  gpuDetected: boolean
  gpuVramGb: number
  gpuName: string
  recommendedMode: ExecutionMode
  recommendedMaxParallel: number
  reason: string
}

export async function profileSystem(): Promise<SystemProfile> {
  const [mem, graphics] = await Promise.all([
    si.mem(),
    si.graphics()
  ])

  const totalRamGb = Math.round(mem.total / 1024 / 1024 / 1024)
  const freeRamGb  = Math.round(mem.available / 1024 / 1024 / 1024)

  // Find the most capable GPU
  const gpus = graphics.controllers.filter(g =>
    g.vram && g.vram > 0
  )
  const bestGpu = gpus.sort((a, b) => (b.vram ?? 0) - (a.vram ?? 0))[0]

  const gpuDetected = !!bestGpu
  const gpuVramGb   = bestGpu ? Math.round((bestGpu.vram ?? 0) / 1024) : 0
  const gpuName     = bestGpu?.model ?? 'None'

  let recommendedMode: ExecutionMode = 'sequential'
  let recommendedMaxParallel = 1
  let reason = ''

  if (gpuDetected && gpuVramGb >= 16 && freeRamGb >= 16) {
    recommendedMode = 'parallel'
    recommendedMaxParallel = 3
    reason = `High-end GPU (${gpuName}, ${gpuVramGb}GB VRAM) + ${freeRamGb}GB free RAM — up to 3 parallel agents`
  } else if (gpuDetected && gpuVramGb >= 8 && freeRamGb >= 12) {
    recommendedMode = 'parallel'
    recommendedMaxParallel = 2
    reason = `GPU (${gpuName}, ${gpuVramGb}GB VRAM) + ${freeRamGb}GB free RAM — up to 2 parallel agents`
  } else if (!gpuDetected && freeRamGb >= 16) {
    recommendedMode = 'parallel'
    recommendedMaxParallel = 2
    reason = `No GPU but ${freeRamGb}GB free RAM (Apple Silicon unified memory) — up to 2 parallel agents`
  } else {
    recommendedMode = 'sequential'
    recommendedMaxParallel = 1
    reason = `Limited resources (${freeRamGb}GB free RAM, GPU: ${gpuDetected ? gpuName : 'none'}) — sequential mode for stability`
  }

  const profile: SystemProfile = {
    totalRamGb,
    freeRamGb,
    gpuDetected,
    gpuVramGb,
    gpuName,
    recommendedMode,
    recommendedMaxParallel,
    reason
  }

  console.log(`[SystemProfiler] ${reason}`)
  return profile
}
