// F-52 (CC-080): the reference lists behind the drop-downs (/reference-data), loaded once and shared by every drop-down.
// Any successful change sent to the server (POST / PATCH / PUT / DELETE) and any sign-in or sign-out marks them stale:
// mounted drop-downs reload them (one request however many are on the page), so a record created in the session is
// selectable at once and a new session never sees the previous user's lists.
type Listener = () => void;
let cache: any = null;
let pending: Promise<any> | null = null;
let generation = 0;
const listeners = new Set<Listener>();

export function loadReferenceData(fetcher: () => Promise<any>): Promise<any> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    const gen = generation;
    pending = fetcher().then(data => { if (gen === generation) cache = data; return data; })
      .finally(() => { if (gen === generation) pending = null; });
  }
  return pending;
}

export function invalidateReferenceData() {
  generation += 1; cache = null; pending = null;
  listeners.forEach(l => l());
}

export function onReferenceDataChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
