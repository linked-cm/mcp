// Places: a host with more than one place (projects, apps …) asks every call to say where it works
// (`placeInput`), may grant differently per place (`grantsFor(connection, call)`) and runs the call
// there (`within`), inside the delegated context.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { InMemoryDataset } from '@_linked/core/memory/InMemoryDataset';
import { currentDelegate } from '@_linked/server-utils/utils/CallContext';
import { readDeclarations } from '../src/declarations';
import { createMcpProvider, issueConnection, connectionByKey, noteActed, type McpHost, type McpCall } from '../src/backend/index';
import { appTurtle, APP, Note } from './fixtures/shapes';
import '../src/shapes/index';

const vocabulary = readFileSync(new URL('../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
const declarations = readDeclarations({ vocabulary, declared: [{ name: 'app', turtle: appTurtle }] });
const WORKSPACE = APP + 'workspace';
const ALL = ['read-notes', 'write-notes', 'delete-notes', 'archive'].map((c) => APP + c);

const seen: { place: unknown; delegate: string | undefined }[] = [];
const grantCalls: (McpCall | undefined)[] = [];
const catalogCalls: McpCall[] = [];
const host: McpHost = {
  declarations,
  placeInput: { schema: { type: 'string', description: 'The project it works in.' }, required: true },
  // "locked" withholds writing: a per-place layer, as a host's data restrictions would be.
  grantsFor: async (_c, call) => {
    grantCalls.push(call);
    return { [WORKSPACE]: new Set(call?.input.place === 'locked' ? [APP + 'read-notes'] : ALL) };
  },
  accountOf: async (person) => ({ id: person }),
  catalogFor: async (_connection, call) => {
    catalogCalls.push(call);
    return undefined;
  },
  inScope: (_c, { input }) => input.place !== 'elsewhere',
  within: async (_c, call, run) => {
    seen.push({ place: call.input.place, delegate: currentDelegate()?.id });
    return run();
  },
};

let base = '';
let server: any;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const Provider = createMcpProvider(host, { connections: { byKey: connectionByKey, noteActed: (id) => noteActed(id) } });
  new (Provider as any)(app, {}).setupBeforeControllers();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => server?.close());
beforeEach(() => {
  LinkedStorage.setDefaultDataset(new InMemoryDataset() as any);
  seen.length = 0;
  grantCalls.length = 0;
  catalogCalls.length = 0;
});

const connect = async () => {
  const { connection, key } = await issueConnection(
    { person: 'https://example.org/person/ada', agentName: 'Notes agent', scope: [], grants: ALL },
    { dataRoot: 'https://example.org/data/' }
  );
  const client = new Client({ name: 'place-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return { client, connection };
};
const create = (words: string) => Note.create({ text: words } as any).toJSON();

describe('places', () => {
  it('asks every tool for its place', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect((tool.inputSchema as any).properties.place, tool.name).toMatchObject({ type: 'string' });
      expect((tool.inputSchema as any).required, tool.name).toContain('place');
    }
  });

  it('runs a call where it works, as the person’s delegate; grants and scope see the place', async () => {
    const { client, connection } = await connect();
    const done: any = await client.callTool({ name: 'create', arguments: { query: create('here'), place: 'garden' } });
    expect(done.structuredContent?.refused).toBeUndefined();
    expect(seen).toEqual([{ place: 'garden', delegate: connection.id }]);
    expect(grantCalls.at(-1)).toMatchObject({ tool: 'create', input: { place: 'garden' } });

    // The same create in a place whose layer withholds writing: refused by name, never run.
    const locked: any = await client.callTool({ name: 'create', arguments: { query: create('there'), place: 'locked' } });
    expect(locked.structuredContent).toMatchObject({ refused: true, reason: 'not-granted', missing: [{ withheldBy: [WORKSPACE] }] });
    const outside: any = await client.callTool({ name: 'read', arguments: { query: (Note.select((n: any) => n.text) as any).toJSON(), place: 'elsewhere' } });
    expect(outside.structuredContent).toMatchObject({ refused: true, reason: 'out-of-scope' });
    expect(seen).toHaveLength(1);
    expect((await Note.select((n: any) => n.text)).map((r: any) => r.text)).toEqual(['here']);
  });

  it('does not load the catalog for a place outside the scope', async () => {
    const { client } = await connect();
    const query = (Note.select((n: any) => n.text) as any).toJSON();
    const outside: any = await client.callTool({ name: 'read', arguments: { query, place: 'elsewhere' } });
    expect(outside.structuredContent).toMatchObject({ refused: true, reason: 'out-of-scope' });
    expect(catalogCalls).toEqual([]);
    // The same read inside the scope does load it, so the assertion above is not an unwired hook.
    await client.callTool({ name: 'read', arguments: { query, place: 'garden' } });
    expect(catalogCalls).toHaveLength(1);
  });

  it('refuses a call that does not say where, before anything runs', async () => {
    const { client } = await connect();
    const result: any = await client.callTool({ name: 'create', arguments: { query: create('nowhere') } });
    expect(result.structuredContent).toMatchObject({ refused: true, reason: 'bad-input' });
    expect(seen).toEqual([]);
    expect(await Note.select((n: any) => n.text)).toEqual([]);
  });
});
