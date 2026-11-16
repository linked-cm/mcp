// The endpoint over real HTTP: an express app with the provider mounted, core's in-memory store,
// and the MCP SDK's own client as the agent.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { InMemoryDataset } from '@_linked/core/memory/InMemoryDataset';
import { requireSessionUser, currentDelegate } from '@_linked/server-utils/utils/CallContext';
import { withAccess } from '@_linked/server-utils/utils/QueryAccess';
import { readDeclarations } from '../src/declarations';
import { createMcpProvider, issueConnection, disconnect, connectionByKey, noteActed } from '../src/backend/index';
import type { McpHost } from '../src/backend/index';
import { appTurtle, APP, Note, NOTE, FOLDER } from './fixtures/shapes';
import '../src/shapes/index';

const vocabulary = readFileSync(new URL('../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
const declarations = readDeclarations({ vocabulary, declared: [{ name: 'app', turtle: appTurtle }] });
const ADA = 'https://example.org/person/ada';
const WORKSPACE = APP + 'workspace';
const ALL = ['read-notes', 'write-notes', 'delete-notes', 'archive'].map((c) => APP + c);

let store: InMemoryDataset;
let workspaceGrants = new Set(ALL);
const archived: { person: unknown; delegate: unknown; input: unknown }[] = [];
const host: McpHost = {
  declarations,
  grantsFor: async () => ({ [WORKSPACE]: workspaceGrants }),
  accountOf: async (person) => ({ id: person }),
  nameOf: (iri) => (iri === NOTE ? 'notes' : iri === FOLDER ? 'folders' : undefined),
  callables: [
    {
      id: NOTE + '#archive',
      title: 'Archive a note',
      description: 'Move a note out of sight.',
      run: async (input) => {
        archived.push({ person: requireSessionUser(), delegate: currentDelegate(), input });
        return { archived: true };
      },
    },
  ],
};

let base = '';
let server: any;
let provider: any;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const Provider = createMcpProvider(host, { perMinute: 1000, connections: { byKey: connectionByKey, noteActed: (id) => noteActed(id) } });
  provider = new (Provider as any)(app, {});
  provider.setupBeforeControllers();
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => server?.close());
beforeEach(() => {
  store = new InMemoryDataset();
  LinkedStorage.setDefaultDataset(store as any);
  workspaceGrants = new Set(ALL);
  archived.length = 0;
});

const connect = async (grants: string[]) => {
  const { connection, key } = await issueConnection(
    { person: ADA, agentName: 'Notes agent', via: 'mcp', scope: [], grants: grants.map((g) => APP + g) },
    { dataRoot: 'https://example.org/data/' }
  );
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return { client, connection, key };
};
const text = (result: any) => result.content?.[0]?.text as string;
const createNote = (words: string) => Note.create({ text: words } as any).toJSON();

describe('the MCP endpoint', () => {
  it('answers 401 the same way without a key, with an unknown one and with a disconnected one', async () => {
    const { connection, key } = await issueConnection({ person: ADA, agentName: 'x', scope: [], grants: [] }, { dataRoot: 'https://example.org/data/' });
    await disconnect(connection.id);
    const post = (auth?: string) =>
      fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) }, body: '{}' });
    const answers = await Promise.all([post(), post('Bearer lmc_unknown'), post(`Bearer ${key}`)]);
    expect(answers.map((r) => r.status)).toEqual([401, 401, 401]);
    const bodies = await Promise.all(answers.map((r) => r.text()));
    expect(new Set(bodies).size).toBe(1);
  });

  it('lists the shape tools, the call tool, and only the shapes it may read', async () => {
    const { client } = await connect(['read-notes']);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['shapes', 'read', 'create', 'update', 'delete', 'call']);
    const shapes = JSON.parse(text(await client.callTool({ name: 'shapes', arguments: {} })));
    expect(shapes.map((s: any) => s.id).sort()).toEqual([FOLDER, NOTE].sort());
    const none = await connect([]);
    expect(JSON.parse(text(await none.client.callTool({ name: 'shapes', arguments: {} })))).toEqual([]);
  });

  it('creates and reads through the shapes, as the person', async () => {
    const { client } = await connect(['read-notes', 'write-notes']);
    const created = await client.callTool({ name: 'create', arguments: { query: createNote('hello') } });
    expect((created as any).structuredContent?.refused).toBeUndefined();
    const rows = JSON.parse(text(await client.callTool({ name: 'read', arguments: { query: Note.select((n: any) => n.text).toJSON() } })));
    expect(rows.map((r: any) => r.text)).toEqual(['hello']);
  });

  it('refuses what its connection was not given, naming the layer, and changes nothing', async () => {
    const { client } = await connect(['read-notes']);
    const result: any = await client.callTool({ name: 'create', arguments: { query: createNote('nope') } });
    expect(result.structuredContent).toMatchObject({ refused: true, reason: 'not-granted', missing: [{ capability: APP + 'write-notes', withheldBy: ['https://linked.cm/ont/mcp/ConnectionLayer'] }] });
    expect(text(result)).toBe("This connection doesn't allow agents to write notes.");
    expect(await Note.select((n: any) => n.text)).toEqual([]);
  });

  it('refuses what an app layer withholds, and what nothing opens', async () => {
    workspaceGrants = new Set([APP + 'read-notes']);
    const { client } = await connect(['read-notes', 'write-notes']);
    expect(text(await client.callTool({ name: 'create', arguments: { query: createNote('x') } }))).toBe("Your workspace doesn't allow agents to write notes.");
    const folderDelete = (await import('./fixtures/shapes')).Folder.delete({ id: 'https://example.org/folder/1' }).toJSON();
    expect(text(await client.callTool({ name: 'delete', arguments: { query: folderDelete } }))).toBe('Nothing here lets agents delete folders.');
  });

  it("is held to the app's own rules, as the person would be", async () => {
    withAccess(store, { write: (ctx: any) => ctx.delegate === undefined });
    const { client } = await connect(['read-notes', 'write-notes']);
    const result: any = await client.callTool({ name: 'create', arguments: { query: createNote('x') } });
    expect(result.structuredContent).toMatchObject({ refused: true, reason: 'refused-by-app' });
    expect(await Note.select((n: any) => n.text)).toEqual([]);
  });

  it('refuses a query on the wrong tool, and one it cannot read', async () => {
    const { client } = await connect(ALL.map((c) => c.slice(APP.length)));
    expect(((await client.callTool({ name: 'read', arguments: { query: createNote('x') } })) as any).structuredContent.reason).toBe('bad-input');
    expect(((await client.callTool({ name: 'read', arguments: { query: { nonsense: 1 } } })) as any).structuredContent.reason).toBe('bad-input');
  });

  it('calls an opened method as the person, through its connection', async () => {
    const { client, connection } = await connect(['archive']);
    const result = await client.callTool({ name: 'call', arguments: { callable: NOTE + '#archive', input: { id: 'n1' } } });
    expect(JSON.parse(text(result))).toEqual({ archived: true });
    expect(archived).toEqual([{ person: { id: ADA }, delegate: { id: connection.id, label: 'Notes agent', via: 'mcp' }, input: { id: 'n1' } }]);
    const unopened: any = await client.callTool({ name: 'call', arguments: { callable: NOTE + '#delete' } });
    expect(unopened.structuredContent.reason).toBe('unknown-tool');
  });

  it('stops at once when it is disconnected', async () => {
    const { client, connection } = await connect(['read-notes']);
    await client.callTool({ name: 'shapes', arguments: {} });
    await disconnect(connection.id);
    await expect(client.callTool({ name: 'shapes', arguments: {} })).rejects.toThrow(/A connection key is required/);
  });

  it('notes when it acted', async () => {
    const { client, key } = await connect(['read-notes']);
    await client.callTool({ name: 'shapes', arguments: {} });
    expect((await connectionByKey(key))?.lastActedAt).toBeTruthy();
  });

  it('leaves no route behind when it is disposed (hot reload)', async () => {
    const app = express();
    app.use(express.json());
    const Provider = createMcpProvider(host, { path: '/agents' });
    const p = new (Provider as any)(app, {});
    p.setupBeforeControllers();
    const s: any = await new Promise((resolve) => {
      const x = app.listen(0, () => resolve(x));
    });
    const url = `http://127.0.0.1:${s.address().port}/agents`;
    try {
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      await p.dispose();
      expect((await fetch(url, { method: 'POST' })).status).toBe(404);
    } finally {
      s.close();
    }
  });
});

