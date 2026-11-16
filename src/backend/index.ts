// Server-only: the MCP endpoint, the connection store, and running agent requests.
export { createMcpHandler, createMcpProvider, type McpProviderOptions } from './provider.js';
export { isRefusal, type McpHost, type McpCall, type AgentCallable, type HostTool, type ToolOutcome, type Refusal, type RefusalReason } from './tools.js';
export {
  issueConnection,
  connectionByKey,
  connectionsOf,
  connectionOf,
  changeConnection,
  disconnect,
  noteActed,
  newKey,
  hashKey,
  type ConnectionRecord,
  type IssueConnectionInput,
} from './connections.js';
export { needsOfQuery, QueryNotUnderstoodError } from './needs.js';
