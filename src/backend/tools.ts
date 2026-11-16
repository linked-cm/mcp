/**
 * Running one agent request: decide it, then do it as the person.
 *
 * Every request goes the same way:
 *   1. the rate limit of its connection;
 *   2. what it needs — a DSL-JSON query's needs from its own walk, a call's
 *      callable, a host tool's declared needs;
 *   3. the capabilities every layer grants (the connection's own grants are
 *      one layer; the host gives the others, fresh for every request);
 *   4. only then, in a delegated call context for the person, the query plane's
 *      own access check and the store — so the app's rules apply to the agent
 *      exactly as to the person.
 *
 * A refusal is a result, never a thrown error: the agent reads what is missing
 * and which layer withheld it. Server-only.
 */
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import type { ShapeCatalog } from '@_linked/core/utils/ShapeCatalog';
import { runAsDelegate } from '@_linked/server-utils/utils/CallContext';
import { ServerCallError } from '@_linked/server-utils/utils/ServerCallError';
import { authorizeGenericQuery } from '@_linked/server/utils/queryPlane';
import { CONNECTION_LAYER, KIND, MCP, type Declarations } from '../declarations.js';
import { evaluate, refusalText, type Grants, type Need, type Verdict } from '../evaluate.js';
import type { ConnectionRecord } from './connections.js';
import { needsOfQuery, QueryNotUnderstoodError, type QueryOperation } from './needs.js';

export type RefusalReason = 'not-granted' | 'out-of-scope' | 'unknown-tool' | 'bad-input' | 'rate-limited' | 'refused-by-app';

const REASON_IRI: Readonly<Record<RefusalReason, string>> = {
  'not-granted': `${MCP}NotGranted`,
  'out-of-scope': `${MCP}OutOfScope`,
  'unknown-tool': `${MCP}UnknownTool`,
  'bad-input': `${MCP}BadInput`,
  'rate-limited': `${MCP}RateLimited`,
  'refused-by-app': `${MCP}RefusedByApp`,
};

export type ToolOutcome =
  | { readonly ok: true; readonly result: unknown }
  | {
      readonly ok: false;
      readonly reason: RefusalReason;
      /** The reason's IRI in the mcp: vocabulary. */
      readonly reasonIri: string;
      readonly text: string;
      readonly verdict?: Verdict;
    };

/** A provider method opened to agents. It must also be covered by a capability (`mcp:onCallable`). */
export interface AgentCallable {
  /** `<shape IRI or package name>#<method>`, as capabilities name it. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** A JSON Schema for its input, shown to the agent. */
  readonly inputSchema?: Record<string, unknown>;
  /** Run it. Called in the delegated context: `requireSessionUser()` is the person. */
  run(input: unknown): Promise<unknown>;
}

/** A tool of the host's own, for what the shapes can't say. */
export interface HostTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
  /** What it needs to be allowed (usually one `mcp:Perform` operation). */
  needs(input: unknown): readonly Need[];
  run(input: unknown, connection: ConnectionRecord): Promise<unknown>;
}

/** One tool call, as the host sees it: the tool, and its input (with its `place`, when the host asks for one). */
export interface McpCall {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface McpHost {
  readonly declarations: Declarations;
  /** The layers other than the connection's own grants, for this call (its place may change them). */
  grantsFor(connection: ConnectionRecord, call?: McpCall): Promise<Grants>;
  /**
   * Where a call works, when the app has more than one place (a project, an
   * app, a branch …): a JSON Schema added to every tool's input as `place`.
   * The host reads it in `inScope`, `grantsFor` and `within`.
   */
  readonly placeInput?: { readonly schema: Record<string, unknown>; readonly required?: boolean };
  /**
   * Run a call where it works (the app's data routing for its place). Called
   * inside the delegated context, around the access check and the store. A
   * thrown 401/403 is a refusal by the app.
   */
  within?<T>(connection: ConnectionRecord, call: McpCall, run: () => Promise<T>): Promise<T>;
  /** The person's account, as the app's sessions carry it (`linkedAuth.userAccount`). */
  accountOf(person: string): Promise<unknown>;
  /** The catalog a connection's queries are decoded in; the global registry when absent. */
  catalogFor?(connection: ConnectionRecord, call: McpCall): Promise<ShapeCatalog | undefined>;
  /** Whether a request is inside the connection's scope; everything is when absent. */
  inScope?(connection: ConnectionRecord, request: { tool: string; input: unknown; needs: readonly Need[] }): boolean | Promise<boolean>;
  /** Whether `shape` is `ancestor` or a sub-shape of it, for capabilities on a super-shape. */
  isShapeOrSubShape?(shape: string, ancestor: string): boolean;
  /** A shape's name, for refusals. */
  nameOf?(iri: string): string | undefined;
  readonly callables?: readonly AgentCallable[];
  readonly tools?: readonly HostTool[];
  /** The most rows a read returns; a read asking for more is capped. Default 100. */
  readonly readLimit?: number;
  onCall?(event: { connection: ConnectionRecord; tool: string; ok: boolean; reason?: RefusalReason; ms: number }): void;
}

export type Refusal = Extract<ToolOutcome, { readonly ok: false }>;
/** Whether an outcome is a refusal (narrows without strict null checks). */
export const isRefusal = (outcome: ToolOutcome): outcome is Refusal => 'reason' in outcome;

const refuse = (host: McpHost, reason: RefusalReason, text: string, verdict?: Verdict): ToolOutcome => ({
  ok: false,
  reason,
  reasonIri: REASON_IRI[reason],
  text,
  ...(verdict ? { verdict } : {}),
});

export const QUERY_TOOLS: Readonly<Record<string, readonly QueryOperation[]>> = {
  read: ['select', 'ask'],
  create: ['create'],
  update: ['update'],
  delete: ['delete'],
};

/** The grants of every layer for this request: the host's, plus the connection's own. */
export async function grantsOf(host: McpHost, connection: ConnectionRecord, call?: McpCall): Promise<Grants> {
  return { ...(await host.grantsFor(connection, call)), [CONNECTION_LAYER]: new Set(connection.grants) };
}

const asInput = (value: unknown): Readonly<Record<string, unknown>> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

async function decide(host: McpHost, connection: ConnectionRecord, call: McpCall, needs: readonly Need[]): Promise<ToolOutcome | undefined> {
  if (host.placeInput?.required && call.input.place === undefined)
    return refuse(host, 'bad-input', 'Say where this works: `place` is required.');
  if (host.inScope && !(await host.inScope(connection, { tool: call.tool, input: call.input, needs })))
    return refuse(host, 'out-of-scope', 'That is outside where this agent may work.');
  const verdict = evaluate(await grantsOf(host, connection, call), needs, host.declarations, {
    ...(host.isShapeOrSubShape ? { isShapeOrSubShape: host.isShapeOrSubShape } : {}),
  });
  if (!verdict.ok)
    return refuse(host, 'not-granted', refusalText(verdict, host.declarations, { ...(host.nameOf ? { nameOf: host.nameOf } : {}) }), verdict);
  return undefined;
}

const asDelegate = async <T>(host: McpHost, connection: ConnectionRecord, call: McpCall, fn: () => Promise<T>): Promise<T> =>
  runAsDelegate(await host.accountOf(connection.person), { id: connection.id, label: connection.agentName, via: connection.via ?? 'mcp' }, () =>
    host.within ? host.within(connection, call, fn) : fn()
  );

/** A refusal from the app's own rules (the person may not either), as a result. */
function appRefusal(host: McpHost, error: unknown): ToolOutcome | undefined {
  if (!ServerCallError.is(error)) return undefined;
  const status = (error as { status?: number }).status;
  if (status === 401 || status === 403) return refuse(host, 'refused-by-app', 'The app does not allow this, for this person.');
  if (status === 400) return refuse(host, 'bad-input', `The request could not be read: ${(error as Error).message}`);
  return undefined;
}

function capRead(json: unknown, limit: number): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const query = json as Record<string, unknown>;
  if (query.op !== undefined && query.op !== 'select') return json;
  const asked = typeof query.limit === 'number' && query.limit > 0 ? query.limit : limit;
  return { ...query, limit: Math.min(asked, limit) };
}

/** Run a DSL-JSON query tool: `read`, `create`, `update` or `delete`. */
export async function runQueryTool(
  host: McpHost,
  connection: ConnectionRecord,
  tool: string,
  rawQuery: unknown,
  input: Readonly<Record<string, unknown>> = { query: rawQuery }
): Promise<ToolOutcome> {
  const call: McpCall = { tool, input };
  const allowedOperations = QUERY_TOOLS[tool];
  if (!allowedOperations) return refuse(host, 'unknown-tool', `There is no tool called ${tool}.`);
  const json = tool === 'read' ? capRead(rawQuery, host.readLimit ?? 100) : rawQuery;
  let decoded;
  try {
    decoded = needsOfQuery(json, await host.catalogFor?.(connection, call));
  } catch (error) {
    if (error instanceof QueryNotUnderstoodError) return refuse(host, 'bad-input', error.message);
    const app = appRefusal(host, error);
    if (app) return app;
    throw error;
  }
  if (!allowedOperations.includes(decoded.operation))
    return refuse(host, 'bad-input', `"${tool}" takes ${allowedOperations.join(' or ')} queries; this one is a ${decoded.operation}.`);
  const refused = await decide(host, connection, call, decoded.needs);
  if (refused) return refused;
  try {
    const result = await asDelegate(host, connection, call, async () => {
      await authorizeGenericQuery(decoded.operation, json, decoded.builder, `mcp ${tool}`);
      const builder = decoded.builder as never;
      // Returned inside an object: a query builder is a thenable.
      if (decoded.operation === 'select' || decoded.operation === 'ask') return { value: await LinkedStorage.readQuery(builder) };
      if (decoded.operation === 'create') return { value: await LinkedStorage.createQuery(builder) };
      if (decoded.operation === 'update') return { value: await LinkedStorage.updateQuery(builder) };
      return { value: await LinkedStorage.deleteQuery(builder) };
    });
    return { ok: true, result: result.value };
  } catch (error) {
    const app = appRefusal(host, error);
    if (app) return app;
    throw error;
  }
}

/** Run an opened provider method. */
export async function runCall(host: McpHost, connection: ConnectionRecord, callableId: unknown, input: unknown): Promise<ToolOutcome> {
  const callable = typeof callableId === 'string' ? host.callables?.find((c) => c.id === callableId) : undefined;
  if (!callable) return refuse(host, 'unknown-tool', `Nothing called ${String(callableId)} is open to agents.`);
  const call: McpCall = { tool: 'call', input: { ...asInput(input), callable: callable.id } };
  const refused = await decide(host, connection, call, [{ kind: KIND.call, callable: callable.id }]);
  if (refused) return refused;
  try {
    return { ok: true, result: await asDelegate(host, connection, call, () => callable.run(input)) };
  } catch (error) {
    const app = appRefusal(host, error);
    if (app) return app;
    throw error;
  }
}

/** Run a host tool. */
export async function runHostTool(host: McpHost, connection: ConnectionRecord, tool: HostTool, input: unknown): Promise<ToolOutcome> {
  const call: McpCall = { tool: tool.name, input: asInput(input) };
  const refused = await decide(host, connection, call, tool.needs(input));
  if (refused) return refused;
  try {
    return { ok: true, result: await asDelegate(host, connection, call, () => tool.run(input, connection)) };
  } catch (error) {
    const app = appRefusal(host, error);
    if (app) return app;
    throw error;
  }
}
