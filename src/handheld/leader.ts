/**
 * Single-writer coordination across tabs.
 *
 * OPFS access handles are exclusive, so only one tab (the leader, holder of
 * the `fi-sync-leader` Web Lock) may open the databases. Other tabs
 * (followers) forward calls to the leader over a BroadcastChannel. When the
 * leader's tab closes the browser releases the lock, and the first queued
 * follower is granted it, runs `onLeader()` and starts serving.
 *
 * `role` is exposed as a live getter (it changes on promotion); use
 * `onRoleChange(cb)` to be notified. Browser-API free apart from the injected
 * `locks` and `channel`, so it is unit-testable in Node.
 */

export const LEADER_LOCK_NAME = 'fi-sync-leader';
export const CHANNEL_NAME = 'fi-sync';
export const FOLLOWER_TIMEOUT_MS = 10_000;

// biome-ignore lint/suspicious/noExplicitAny: generic method table
type AnyApi = Record<string, (...args: any[]) => Promise<unknown>>;

export type Role = 'leader' | 'follower';

export interface HandheldBackend<Api extends AnyApi> {
  /** Current role. A live getter: becomes 'leader' when a follower is promoted. */
  readonly role: Role;
  /** Subscribe to role changes. Returns an unsubscribe function. */
  onRoleChange(cb: (role: Role) => void): () => void;
  call<K extends keyof Api>(
    method: K,
    ...args: Parameters<Api[K]>
  ): Promise<Awaited<ReturnType<Api[K]>>>;
}

type WireError = { name: string; message: string };
type Request = {
  kind: 'req';
  id: string;
  from: string;
  method: string;
  args: unknown[];
};
type Response =
  | { kind: 'res'; id: string; to: string; ok: true; value: unknown }
  | { kind: 'res'; id: string; to: string; ok: false; error: WireError };
type Message = Request | Response;

function toWireError(err: unknown): WireError {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'Error', message: String(err) };
}

function fromWireError(e: WireError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

type Pending = {
  method: string;
  args: unknown[];
  resolve(v: unknown): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

export async function electLeader<Api extends AnyApi>(opts: {
  locks: LockManager;
  channel: BroadcastChannel;
  onLeader(): Promise<Api>;
}): Promise<HandheldBackend<Api>> {
  const { locks, channel } = opts;
  const tabId = crypto.randomUUID();
  let role: Role = 'follower';
  let api: Api | null = null;
  const pending = new Map<string, Pending>();
  const listeners = new Set<(r: Role) => void>();

  const setRole = (r: Role) => {
    role = r;
    for (const cb of listeners) cb(r);
  };

  const run = (method: string, args: unknown[]): Promise<unknown> => {
    const fn = api?.[method];
    if (!fn) return Promise.reject(new Error(`UNKNOWN_METHOD:${method}`));
    return fn(...args);
  };

  channel.addEventListener('message', (ev: MessageEvent<Message>) => {
    const msg = ev.data;
    if (msg.kind === 'req') {
      // Only a serving leader answers, and never its own posts.
      if (!api || msg.from === tabId) return;
      run(msg.method, msg.args).then(
        (value) =>
          channel.postMessage({
            kind: 'res',
            id: msg.id,
            to: msg.from,
            ok: true,
            value,
          } satisfies Response),
        (err) =>
          channel.postMessage({
            kind: 'res',
            id: msg.id,
            to: msg.from,
            ok: false,
            error: toWireError(err),
          } satisfies Response),
      );
      return;
    }
    // Responses addressed to another tab are ignored.
    if (msg.to !== tabId) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(fromWireError(msg.error));
  });

  /** Runs inside the lock callback: open DBs, start serving, drain queued calls. */
  const promote = async () => {
    api = await opts.onLeader();
    setRole('leader');
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      clearTimeout(p.timer);
      run(p.method, p.args).then(p.resolve, p.reject);
    }
  };

  const holdForever = () => new Promise<void>(() => {});

  // First attempt: take the lock only if free, so the role is known on return.
  const decided = new Promise<void>((resolve, reject) => {
    locks
      .request(LEADER_LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve();
          return;
        }
        try {
          await promote();
        } catch (err) {
          reject(err);
          throw err;
        }
        resolve();
        await holdForever();
      })
      .catch(() => {});
  });
  await decided;

  if (role === 'follower') {
    // Queue for promotion; granted when the current leader's tab goes away.
    locks
      .request(LEADER_LOCK_NAME, async () => {
        try {
          await promote();
        } catch (err) {
          // Fail queued calls rather than leave them to time out.
          for (const [id, p] of [...pending]) {
            pending.delete(id);
            clearTimeout(p.timer);
            p.reject(err);
          }
          throw err;
        }
        await holdForever();
      })
      .catch(() => {});
  }

  return {
    get role() {
      return role;
    },
    onRoleChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    call(method, ...args) {
      type R = Awaited<ReturnType<Api[typeof method]>>;
      if (role === 'leader') {
        return run(method as string, args) as Promise<R>;
      }
      return new Promise<R>((resolve, reject) => {
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('LEADER_TIMEOUT'));
        }, FOLLOWER_TIMEOUT_MS);
        pending.set(id, {
          method: method as string,
          args,
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        channel.postMessage({
          kind: 'req',
          id,
          from: tabId,
          method: method as string,
          args,
        } satisfies Request);
      });
    },
  };
}
