/**
 * The network side of LAN sharing: listeners on this computer's local
 * network addresses, opened when the first artifact is shared and closed
 * when the last one stops, and the Host names they answer to. A site reaches
 * it as {@link SiteNetwork} (`SiteContext.network`).
 */

import { lookup } from 'node:dns/promises';
import type { Server } from 'node:http';
import { connect, createServer, type AddressInfo } from 'node:net';
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { SHARING_FILE, WorkspaceDirectory, readSharingState } from '@open-artifact/protocol/workspace-files';

/** The file in an artifact folder that records its sharing state. */
export { SHARING_FILE };

/** 198.18.0.0/15 (RFC 2544): TUN-mode proxies put their own interface there; nobody else reaches it. */
const isBenchmarkRange = (address: string): boolean => /^198\.1[89]\./.test(address);

/**
 * True for 100.64.0.0/10: Tailscale's addresses (a carrier NAT's too),
 * reachable from anywhere on the same tailnet.
 */
export function isTailnet(address: string): boolean {
  const m = /^100\.(\d{1,3})\./.exec(address);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/** A VPN's or proxy's interface, by name: nobody on the same Wi-Fi reaches its address. */
const isTunnel = (name: string): boolean =>
  /(^|[^a-z0-9])(utun|tun|tap|wg|ppp|ipsec)\d*($|[^a-z0-9])/i.test(name) || /vpn|wintun|tunnel/i.test(name);

const ipv4Number = (address: string): number => address.split('.').reduce((n, part) => n * 256 + Number(part), 0);

/** A network this computer makes for itself (point-to-point, or it holds the gateway's address), not one it joined. */
function isOwnNetwork(entry: NetworkInterfaceInfo): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(entry.netmask)) return false;
  const mask = ipv4Number(entry.netmask);
  if (mask >= ipv4Number('255.255.255.252')) return true;
  const address = ipv4Number(entry.address);
  return ((address & mask) >>> 0) + 1 === address;
}

/**
 * This computer's IPv4 addresses others may reach: the local network's
 * first, then tunnels and its own networks, then Tailscale.
 */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const rank = new Map<string, number>();
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.') || isBenchmarkRange(entry.address)) continue;
      const r = isTailnet(entry.address) ? 2 : isTunnel(name) || isOwnNetwork(entry) ? 1 : 0;
      rank.set(entry.address, Math.min(r, rank.get(entry.address) ?? r));
    }
  }
  return [...rank.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!);
}

/** Errors that mean "nobody answers there". */
const NO_ANSWER = new Set(['ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH', 'EHOSTUNREACH', 'EACCES', 'EPERM']);

/** Whether something answers at host:port (refused, unreachable or 300 ms of silence: no). */
function answers(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (taken: boolean): void => {
      socket.destroy();
      resolve(taken);
    };
    socket.setTimeout(300, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', (error: NodeJS.ErrnoException) => done(!NO_ANSWER.has(error.code ?? '')));
  });
}

/** An address that accepts a connection even at a port nobody listens on is a proxy's: a link at it reaches nobody. */
async function answersAnyPort(address: string): Promise<boolean> {
  const server = createServer();
  let port = 0;
  try {
    port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, address, () => resolve((server.address() as AddressInfo | null)?.port ?? 0));
    });
  } catch {
    return false;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return port > 0 && answers(address, port);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** This machine's own name, with or without `.local`. */
function isMachineName(name: string): boolean {
  const machine = hostname().toLowerCase();
  return name === machine || name === `${machine.replace(/\.local$/, '')}.local`;
}

/** Whether an artifact folder's {@link SHARING_FILE} says it is shared on the network (without mounting anything). */
export function sharedOnLan(root: string): boolean {
  try {
    return readSharingState(new WorkspaceDirectory(root))?.lan === true;
  } catch {
    return false;
  }
}

/** What a site sees of the LAN listeners (`SiteContext.network`). */
export interface SiteNetwork {
  /** The port every listener uses: the server's own. */
  readonly port: number;
  /** Addresses listened on now. */
  addresses(): string[];
  /** Starts listening on the LAN addresses (once for all sites); resolves with them. */
  open(): Promise<string[]>;
  /** This site stopped sharing: the listeners close when no other site shares. */
  release(): void;
  /** Whether a link may use `name` as its Host (an address listened on, this machine's name, or a name resolving to them). */
  allowName(name: string): Promise<boolean>;
}

/** Options of {@link LanNetwork}. */
export interface LanNetworkOptions {
  /** The server's port; LAN listeners use the same one. */
  port: () => number;
  /** A new HTTP server with the same handlers as the loopback one. */
  createServer: () => Server;
  /** Whether any site still shares (listeners stay open while one does). */
  stillShared: () => boolean;
  /** Diagnostic log. */
  log: (line: string) => void;
  /** The addresses to listen on (default {@link lanAddresses}). */
  addresses?: () => string[];
}

/** The LAN listeners of one type server. */
export class LanNetwork {
  /** The contract handed to sites. */
  readonly network: SiteNetwork;

  private readonly options: LanNetworkOptions;
  /** Address → its HTTP server. */
  private readonly servers = new Map<string, Server>();
  /** Names a remote owner link came by that resolve to an address listened on. */
  private readonly names = new Set<string>();
  private opening: Promise<string[]> | null = null;

  /** Creates the (closed) listeners. */
  constructor(options: LanNetworkOptions) {
    this.options = options;
    const self = this;
    this.network = Object.freeze({
      get port() {
        return self.options.port();
      },
      addresses: () => [...self.servers.keys()],
      open: () => self.open(),
      release: () => self.release(),
      allowName: (name: string) => self.allowName(name),
    });
  }

  /** True while at least one LAN listener is open. */
  get listening(): boolean {
    return this.servers.size > 0;
  }

  /** Opens listeners on every LAN address not listened on yet; resolves with all addresses listened on. */
  open(): Promise<string[]> {
    // Two sites opening at once share one pass over the interfaces.
    this.opening ??= this.openNow().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openNow(): Promise<string[]> {
    const want = (this.options.addresses ?? lanAddresses)().filter((a) => !this.servers.has(a));
    const proxied = await Promise.all(want.map(answersAnyPort));
    for (const address of want.filter((_, i) => !proxied[i])) {
      const server = this.options.createServer();
      try {
        await listen(server, this.options.port(), address);
        this.servers.set(address, server);
        this.options.log(`sharing: listening at ${address}:${this.options.port()}`);
      } catch (error) {
        server.close();
        this.options.log(`sharing: not listening at ${address}:${this.options.port()}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return [...this.servers.keys()];
  }

  /** A site stopped sharing: the listeners stay while another one still shares. */
  release(): void {
    if (!this.options.stillShared()) this.close();
  }

  /** Closes every LAN listener. */
  close(): void {
    for (const server of this.servers.values()) {
      server.close();
      server.closeAllConnections();
    }
    if (this.servers.size) this.options.log('sharing: stopped listening on the network');
    this.servers.clear();
    this.names.clear();
  }

  /** Whether the owner's other-device link may use `name`: an address listened on, this machine's name, or one resolving to them. */
  async allowName(name: string): Promise<boolean> {
    const lower = String(name ?? '').toLowerCase();
    if (!lower || !this.servers.size) return false;
    if (this.servers.has(lower) || isMachineName(lower) || this.names.has(lower)) return true;
    const found = await lookup(lower, { all: true, family: 4 }).catch(() => []);
    if (!found.some((e) => this.servers.has(e.address))) return false;
    this.names.add(lower);
    return true;
  }

  /** While listening: whether a Host header names an address listened on, this machine, or a name {@link allowName} took. */
  hostAllowed(host: string): boolean {
    if (!this.servers.size) return false;
    const suffix = `:${this.options.port()}`;
    if (!host.endsWith(suffix)) return false;
    const name = host.slice(0, -suffix.length).toLowerCase();
    return this.servers.has(name) || isMachineName(name) || this.names.has(name);
  }
}
