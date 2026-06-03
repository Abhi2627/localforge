const DELETED_SESSIONS_KEY = 'localforge_deleted_sessions'

export function getDeletedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DELETED_SESSIONS_KEY) ?? '[]')) } catch { return new Set() }
}

export function markDeleted(id: string) {
  const ids = getDeletedIds()
  ids.add(id)
  const arr = [...ids].slice(-200)
  localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(arr))
}
