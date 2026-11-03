// The installation supplies key mappings for this user's existing profile.
// Chat text, blobs and attachment bytes pass through without string replacement.
export async function migrateProfile(mapping, { local = localStorage, db = indexedDB, locks = navigator.locks } = {}) {
  if (!mapping?.id || !Array.isArray(mapping.keyReplacements)) return { skipped: true };
  return locks.request('lingbo-profile-migration', async () => {
    const marker = 'lingbo/profile-migration/' + mapping.id;
    if (local.getItem(marker)) return { skipped: true };
    const rename = key => mapping.keyReplacements.reduce((value, [from, to]) => value.replaceAll(from, to), key);
    const properties = new Map(mapping.propertyReplacements || []);
    const remapProperties = value => {
      if (Array.isArray(value)) return value.map(remapProperties);
      if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, child]) => [properties.get(key) || key, remapProperties(child)]));
      return value;
    };
    const storedValue = text => { try { return JSON.stringify(remapProperties(JSON.parse(text))); } catch { return text; } };
    const staged = [];
    for (let i = 0; i < local.length; i++) {
      const key = local.key(i), next = rename(key);
      const original = local.getItem(key), value = storedValue(original);
      if (key !== next || value !== original) staged.push([key, next, value]);
    }
    for (const [, next, value] of staged) {
      const sourceKey = staged.find(entry => entry[1] === next)?.[0];
      if (sourceKey !== next && local.getItem(next) !== null && local.getItem(next) !== value) throw new Error('角色设置迁移出现键冲突，已保留原始数据。');
    }
    const databases = await db.databases();
    let moved = 0;
    for (const meta of databases) {
      if (!meta.name) continue;
      const connection = await new Promise((resolve, reject) => {
        const request = db.open(meta.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!connection.objectStoreNames.length) continue;
        const names = Array.from(connection.objectStoreNames);
        await new Promise((resolve, reject) => {
          const tx = connection.transaction(names, 'readwrite');
          let fault;
          tx.oncomplete = resolve;
          tx.onabort = () => reject(fault || tx.error || new Error('角色数据迁移已中止。'));
          tx.onerror = () => {};
          for (const name of names) {
            const store = tx.objectStore(name);
            // Inline primary keys belong to their schema. Only key-value stores use renamed prefixes.
            if (store.keyPath !== null) continue;
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const item = cursor.result;
              if (!item) return;
              if (typeof item.key === 'string' && rename(item.key) !== item.key) {
                const next = rename(item.key);
                const check = store.count(next);
                check.onsuccess = () => {
                  if (check.result) { fault = new Error('聊天数据迁移出现键冲突，已保留原始数据。'); tx.abort(); return; }
                  store.add(remapProperties(item.value), next);
                  item.delete();
                  moved++;
                  item.continue();
                };
              } else { item.update(remapProperties(item.value)); item.continue(); }
            };
          }
        });
      } finally { connection.close(); }
    }
    for (const [key, next, value] of staged) { local.setItem(next, value); if (key !== next) local.removeItem(key); }
    local.setItem(marker, JSON.stringify({ at: new Date().toISOString(), localKeys: staged.length, databaseKeys: moved }));
    return { localKeys: staged.length, databaseKeys: moved };
  });
}
