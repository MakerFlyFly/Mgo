export interface PoolLease<T> { resource: T; release(): void; invalidate(): void }
type Closable = { close(): Promise<void> };
type Entry<T> = { ready: Promise<T>; refs: number; invalid: boolean; closing: boolean; timer?: ReturnType<typeof setTimeout> };

export class ResourcePool<T extends Closable> {
  private entries = new Map<string, Entry<T>>();
  constructor(private idleMs: number) {}
  async acquire(key: string, create: () => Promise<T>): Promise<PoolLease<T>> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { ready: Promise.resolve().then(create), refs: 0, invalid: false, closing: false };
      this.entries.set(key, entry);
    }
    const current = entry;
    if (current.timer) { clearTimeout(current.timer); current.timer = undefined; }
    current.refs++;
    const close = () => {
      if (current.refs || current.closing) return;
      current.closing = true;
      void current.ready.then(resource => resource.close()).catch(() => {});
    };
    const invalidate = () => {
      current.invalid = true;
      if (this.entries.get(key) === current) this.entries.delete(key);
      if (current.timer) clearTimeout(current.timer);
      close();
    };
    let released = false;
    const release = () => {
      if (released) return; released = true; current.refs--;
      if (current.refs) return;
      if (current.invalid) close();
      else { current.timer = setTimeout(invalidate, this.idleMs); current.timer.unref?.(); }
    };
    try { return { resource: await current.ready, release, invalidate }; }
    catch (error) { invalidate(); release(); throw error; }
  }
}
