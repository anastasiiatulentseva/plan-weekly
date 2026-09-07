const subscribers = new Set<(revision: number) => void>();
export function broadcast(revision: number) {
  for (const send of subscribers) send(revision);
}
export function subscribe(send: (revision: number) => void) {
  subscribers.add(send);
  return () => { subscribers.delete(send); };
}
const closers = new Set<() => void>();
export function onShutdown(close: () => void) {
  closers.add(close);
  return () => { closers.delete(close); };
}
export function closeEvents() {
  for (const close of closers) close();
}
