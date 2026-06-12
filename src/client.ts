import { spawn, type ChildProcess } from 'node:child_process';
import type {
  JsonRpcResponse,
  ServerInfo,
  ToolCallResult,
  ToolDefinition,
} from './types.js';

const PROTOCOL_VERSION = '2025-06-18';

export interface ServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** A minimal MCP client over stdio. Spawns the server process, performs the
 * initialize handshake, and exposes tools/list and tools/call. */
export class McpClient {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private stdoutBuf = '';
  private stderrTail: string[] = [];
  private closed = false;
  serverInfo: ServerInfo = {};

  constructor(
    private spec: ServerSpec,
    private defaultTimeoutMs = 10_000,
  ) {}

  async start(): Promise<void> {
    const child = spawn(this.spec.command, this.spec.args ?? [], {
      cwd: this.spec.cwd,
      env: { ...process.env, ...this.spec.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.on('error', (err) => this.failAll(new Error(`failed to start server: ${err.message}`)));
    child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.failAll(
          new Error(
            `server exited unexpectedly (${signal ?? `code ${code}`})${this.stderrHint()}`,
          ),
        );
      }
    });

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      this.stderrTail.push(chunk);
      // keep roughly the last 4KB for diagnostics
      while (this.stderrTail.join('').length > 4096 && this.stderrTail.length > 1) {
        this.stderrTail.shift();
      }
    });

    // Server startup can include a package download (npx/uvx cold start),
    // so the handshake gets a more generous timeout than tool calls.
    const result = (await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'mcpt', version: '0.1.0' },
      },
      Math.max(this.defaultTimeoutMs, 60_000),
    )) as {
      protocolVersion?: string;
      serverInfo?: { name?: string; version?: string };
    };

    this.serverInfo = {
      name: result?.serverInfo?.name,
      version: result?.serverInfo?.version,
      protocolVersion: result?.protocolVersion,
    };
    this.notify('notifications/initialized');
  }

  async listTools(): Promise<ToolDefinition[]> {
    const tools: ToolDefinition[] = [];
    let cursor: string | undefined;
    do {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: ToolDefinition[];
        nextCursor?: string;
      };
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<ToolCallResult> {
    const result = (await this.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
    )) as ToolCallResult;
    return { ...result, content: result.content ?? [] };
  }

  /** Stderr captured from the server, for failure diagnostics. */
  stderr(): string {
    return this.stderrTail.join('').trim();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failAll(new Error('client closed'));
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin?.end();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
    await exited;
    clearTimeout(timer);
  }

  private request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeout}ms${this.stderrHint()}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: unknown): void {
    if (!this.child?.stdin?.writable) {
      throw new Error('server is not running');
    }
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    let newline: number;
    while ((newline = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, newline).trim();
      this.stdoutBuf = this.stdoutBuf.slice(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // tolerate servers that print noise on stdout
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: Record<string, unknown>): void {
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        // Server-to-client request. We support ping; everything else is declined
        // so the server never hangs waiting on us.
        if (message.method === 'ping') {
          this.send({ jsonrpc: '2.0', id: message.id, result: {} });
        } else {
          this.send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `mcpt does not support ${message.method}` },
          });
        }
      }
      return; // notifications are ignored
    }

    const response = message as unknown as JsonRpcResponse;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(
        new Error(`server error ${response.error.code}: ${response.error.message}`),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private failAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private stderrHint(): string {
    const tail = this.stderr();
    return tail ? `\n  server stderr: ${tail.split('\n').slice(-5).join('\n  ')}` : '';
  }
}
