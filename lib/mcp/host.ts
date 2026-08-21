import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createServer,
  createServices,
  loadConfig,
  NullCache,
  type Cache,
  type Env,
  type ServiceOverrides,
} from 'plant-intel-mcp';

/** The narrow fetch shape the MCP server actually uses, kept in sync with it. */
export type FetchLike = NonNullable<ServiceOverrides['fetch']>;

/** A tool as the MCP server advertises it: name, description, JSON Schema. */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolOutcome {
  ok: boolean;
  /** Parsed JSON when the tool returned JSON, otherwise the raw text. */
  result: unknown;
}

export interface McpHost {
  tools: McpToolDescriptor[];
  callTool(name: string, input: unknown): Promise<McpToolOutcome>;
  close(): Promise<void>;
}

export interface McpHostOptions {
  env?: Env;
  fetch?: FetchLike;
  cache?: Cache;
}

/**
 * Serverless filesystems are read-only apart from the temp directory. The MCP
 * cache degrades silently when it cannot write, but pointing it somewhere
 * writable means a warm instance still earns cache hits -- which matters a
 * great deal against Perenual's 100-requests-per-day ceiling.
 */
const SERVERLESS_CACHE_DIR = '/tmp/plant-intel';

function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text',
    )
    .map((block) => block.text)
    .join('\n');
}

/**
 * Runs the plant-intel MCP server in this process and speaks to it as a real
 * MCP client over an in-memory transport.
 *
 * This is a genuine protocol client -- handshake, `tools/list`, `tools/call` --
 * not a library shortcut around the server. It just skips the pipe, which means
 * no subprocess, no open port, and no credential ever leaving the process.
 */
export async function createMcpHost(options: McpHostOptions = {}): Promise<McpHost> {
  const env: Env = {
    PLANT_INTEL_CACHE_DIR: SERVERLESS_CACHE_DIR,
    ...(options.env ?? process.env),
  };

  const config = loadConfig(env);
  const services = createServices(config, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    // An explicit cache wins; otherwise a disabled cache means NullCache.
    ...(options.cache !== undefined
      ? { cache: options.cache }
      : config.cacheDir === null
        ? { cache: new NullCache() }
        : {}),
  });

  const server = createServer(services);
  const client = new Client({ name: 'rootwise', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  const tools: McpToolDescriptor[] = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
  }));

  return {
    tools,

    async callTool(name, input) {
      try {
        const response = await client.callTool({
          name,
          arguments: (input ?? {}) as Record<string, unknown>,
        });

        const text = textOf(response.content);
        if (response.isError === true) {
          return { ok: false, result: text };
        }

        try {
          return { ok: true, result: JSON.parse(text) as unknown };
        } catch {
          return { ok: true, result: text };
        }
      } catch (error: unknown) {
        // A protocol-level failure (unknown tool, schema rejection) is data the
        // model can act on, not an exception that should end the turn.
        return { ok: false, result: error instanceof Error ? error.message : String(error) };
      }
    },

    async close() {
      await client.close();
      await server.close();
    },
  };
}

let hostPromise: Promise<McpHost> | null = null;

/**
 * The process-wide host. Memoised on the promise rather than the resolved
 * value so two concurrent first requests share one construction instead of
 * racing to build two servers.
 */
export async function getMcpHost(options: McpHostOptions = {}): Promise<McpHost> {
  hostPromise ??= createMcpHost(options);
  return hostPromise;
}

export async function resetMcpHost(): Promise<void> {
  const pending = hostPromise;
  hostPromise = null;
  if (pending !== null) {
    await (await pending).close();
  }
}
