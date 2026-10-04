/**
 * One JSON document in KV that is written only when it changed. A hold cycle then costs
 * zero writes, which keeps two Workers on a 5-minute cron well under the Workers Free
 * limit of 1000 KV writes/day per account.
 */
export interface KvDoc<T> {
  value: T;
  /** Persist `value` if it differs from what was last read or written. */
  save(): Promise<void>;
}

export async function loadDoc<T>(kv: KVNamespace, key: string, empty: T): Promise<KvDoc<T>> {
  let stored = await kv.get(key);
  const doc: KvDoc<T> = {
    value: stored === null ? structuredClone(empty) : (JSON.parse(stored) as T),
    async save() {
      const next = JSON.stringify(doc.value);
      if (next === stored) return;
      await kv.put(key, next);
      stored = next;
    },
  };
  return doc;
}
