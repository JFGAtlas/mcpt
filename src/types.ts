/** Subset of MCP / JSON-RPC types that mcpt needs. Kept local on purpose:
 * mcpt speaks the wire protocol directly and has no SDK dependency. */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  description?: string;
  default?: unknown;
  examples?: unknown[];
  [key: string]: unknown;
}

export interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface ToolCallResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ServerInfo {
  name?: string;
  version?: string;
  protocolVersion?: string;
}
