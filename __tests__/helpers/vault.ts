import { MemorySyncVault, type TransportRequest, type TransportResponse } from '../../src/testing';
import { setNativeImplementation } from '../../src/native';
import { SyncVault } from '../../src/core/SyncVault';

export interface TestVault {
  vault: MemorySyncVault;
  sent: TransportRequest[];
  respond(fn: (req: TransportRequest) => TransportResponse | Promise<TransportResponse>): void;
}

/** Installs a manually drained MemorySyncVault behind the SyncVault facade. */
export function installVault(options: { online?: boolean } = {}): TestVault {
  const sent: TransportRequest[] = [];
  let responder: (req: TransportRequest) => TransportResponse | Promise<TransportResponse> = () => ({ status: 200, body: '{}' });
  const vault = new MemorySyncVault({
    autoDrain: false,
    network: { isConnected: options.online ?? true },
    transport: async (req) => {
      sent.push(req);
      return responder(req);
    },
  });
  setNativeImplementation(vault);
  return {
    vault,
    sent,
    respond(fn) {
      responder = fn;
    },
  };
}

export function uninstallVault(): void {
  SyncVault.reset();
  setNativeImplementation(null);
}

export const flush = () => new Promise((r) => setTimeout(r, 0));
