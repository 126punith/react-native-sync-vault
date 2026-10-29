import type { AddressInfo } from 'net';
import type { Server } from 'http';

export interface Fault {
  status?: number;
  retryAfter?: number;
  delayMs?: number;
  dropResponse?: boolean;
  match?: (req: { method: string; path: string; get(name: string): string | undefined }) => boolean;
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  version: number;
}

export interface TodoServer {
  baseUrl: string;
  todos: Map<string, Todo>;
  faults: Fault[];
  effects: { type: string; id: string; idempotencyKey?: string }[];
  readonly requestCount: number;
  close(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTodoServer } = require('../../server/express-sync-vault/example/todo-server');

export async function startTodoServer(options: { token?: string } = {}): Promise<TodoServer> {
  const server = createTodoServer(options);
  const http: Server = await new Promise((resolve) => {
    const s = server.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = http.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    todos: server.todos,
    faults: server.faults,
    effects: server.effects,
    get requestCount() {
      return server.requestCount as number;
    },
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections?.();
        http.close(() => resolve());
      }),
  };
}

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}
