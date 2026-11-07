/** Historical references remain references; never decode them as inline audio. */
export function parseChatAssetReference(value: string, currentPrefix: string): { id: string, legacyNamespace?: string } | undefined {
  if (value.startsWith(currentPrefix))
    return { id: value.slice(currentPrefix.length) }
  // Compatibility is limited to a local content-addressed attachment scheme,
  // not arbitrary URLs, paths, database names or unbounded identifiers.
  const historical = /^([a-z][a-z0-9-]{0,63})-asset:([a-f0-9]{64})$/.exec(value)
  return historical ? { id: historical[2], legacyNamespace: historical[1] } : undefined
}

/** Open only an existing historical asset store, using a read-only transaction. */
export async function readHistoricalChatAsset(id: string, namespace: string, factory: IDBFactory = indexedDB): Promise<unknown> {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-z][a-z0-9-]{0,63}$/.test(namespace))
    throw new Error('Invalid historical chat asset reference')
  const name = `${namespace}-chat-assets`
  if (!(await factory.databases()).some(database => database.name === name))
    return null
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value: unknown, failed = false) => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      if (failed)
        reject(new Error('Historical chat asset could not be read'))
      else
        resolve(value)
    }
    const timer = setTimeout(() => finish(null, true), 5000)
    let request: IDBOpenDBRequest
    try {
      request = factory.open(name)
    }
    catch {
      finish(null, true)
      return
    }
    // The database might disappear between enumeration and open. Abort the
    // upgrade instead of silently creating a new empty database in its place.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => finish(null, true)
    request.onblocked = () => finish(null, true)
    request.onsuccess = () => {
      const db = request.result
      if (settled || !db.objectStoreNames.contains('assets')) {
        db.close()
        finish(null)
        return
      }
      try {
        const tx = db.transaction('assets', 'readonly')
        const read = tx.objectStore('assets').get(id)
        tx.oncomplete = () => { db.close(); finish(read.result ?? null) }
        tx.onabort = tx.onerror = () => { db.close(); finish(null, true) }
      }
      catch {
        db.close()
        finish(null, true)
      }
    }
  })
}
