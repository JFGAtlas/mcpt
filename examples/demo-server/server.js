#!/usr/bin/env node
// A tiny MCP server with zero dependencies, used by mcpt's examples and tests.
// It speaks JSON-RPC 2.0 over stdio per the Model Context Protocol spec.

const TOOLS = [
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'first addend' },
        b: { type: 'number', description: 'second addend' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'echo',
    description: 'Echo a message back, uppercased on request.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', examples: ['hello world'] },
        uppercase: { type: 'boolean', default: false },
      },
      required: ['message'],
    },
  },
  {
    name: 'get_weather',
    description: 'Return canned weather data for a city, as JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', examples: ['Tokyo'] },
      },
      required: ['city'],
    },
  },
];

function handleToolCall(name, args) {
  switch (name) {
    case 'add': {
      if (typeof args.a !== 'number' || typeof args.b !== 'number') {
        return { content: [{ type: 'text', text: 'a and b must be numbers' }], isError: true };
      }
      return { content: [{ type: 'text', text: String(args.a + args.b) }] };
    }
    case 'echo': {
      const text = args.uppercase ? String(args.message).toUpperCase() : String(args.message);
      return { content: [{ type: 'text', text }] };
    }
    case 'get_weather': {
      const weather = { city: args.city, temperature: 21, unit: 'celsius', condition: 'sunny' };
      return {
        content: [{ type: 'text', text: JSON.stringify(weather) }],
        structuredContent: weather,
      };
    }
    default:
      return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handleMessage(message);
  }
});
process.stdin.on('end', () => process.exit(0));

function handleMessage(message) {
  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mcpt-demo-server', version: '1.0.0' },
      });
      break;
    case 'tools/list':
      respond(message.id, { tools: TOOLS });
      break;
    case 'tools/call':
      respond(message.id, handleToolCall(message.params.name, message.params.arguments ?? {}));
      break;
    case 'ping':
      respond(message.id, {});
      break;
    default:
      if (message.id !== undefined) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `method not found: ${message.method}` },
          }) + '\n',
        );
      }
  }
}
