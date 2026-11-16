// mcp:AnyShape: a capability over every shape of the app's own catalog. It covers what the
// host's catalog for the call holds, never Linked's built-in shapes or the package's own
// Connection, and nothing at all when the host gives no catalog.
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { InMemoryDataset } from '@_linked/core/memory/InMemoryDataset';
import { ShapeCatalog } from '@_linked/core/utils/ShapeCatalog';
import { getNodeShape } from '@_linked/core/utils/ShapeClass';
import { toWire } from '@_linked/core/shapes/nodeShapeWire';
import { readDeclarations } from '../src/declarations';
import { createMcpProvider, issueConnection, connectionByKey, noteActed, type McpHost } from '../src/backend/index';
import { Connection } from '../src/shapes/connection';
import { Note, NOTE, FOLDER } from './fixtures/shapes';
import '../src/shapes/index';

const vocabulary = readFileSync(new URL('../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
const ANY = 'https://example.org/any/';
const declarations = readDeclarations({
  vocabulary,
  declared: [
    {
      name: 'any',
      turtle: `@prefix mcp: <https://linked.cm/ont/mcp/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        <${ANY}read-app-data> a mcp:Capability ; rdfs:label "Read the app's data"@en ; mcp:actionPhrase "read the app's data"@en ;
          mcp:kind mcp:Read ; mcp:onShape mcp:AnyShape .
        <${ANY}layer> a mcp:Layer ; rdfs:label "The app"@en ; mcp:order 1 .`,
    },
  ],
});
expect(declarations.gaps).toEqual([]);

/** The app's catalog: notes only. */
const catalog = ShapeCatalog.from([toWire(getNodeShape({ id: NOTE } as never) as never)]);
let withCatalog = true;
const host: McpHost = {
  declarations,
  placeInput: { schema: { type: 'string' }, required: true },
  grantsFor: async () => ({ [`${ANY}layer`]: new Set([`${ANY}read-app-data`]) }),
  accountOf: async (person) => ({ id: person }),
  inScope: (_c, { input }) => input.place === 'mine',
  catalogFor: async () => (withCatalog ? catalog : undefined),
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
beforeEach(async () => {
  LinkedStorage.setDefaultDataset(new InMemoryDataset() as any);
  withCatalog = true;
});

const connect = async () => {
  const { key } = await issueConnection(
    { person: 'https://example.org/person/ada', agentName: 'Reader', scope: [], grants: [`${ANY}read-app-data`] },
    { dataRoot: 'https://example.org/data/' }
  );
  const client = new Client({ name: 'any-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return client;
};
const readNotes = () => (Note.select((n: any) => n.text) as any).toJSON();

describe('mcp:AnyShape', () => {
  it('reads a shape of the app’s catalog; without a catalog it covers nothing', async () => {
    await Note.create({ text: 'seed trays' } as any);
    const client = await connect();
    const read: any = await client.callTool({ name: 'read', arguments: { query: readNotes(), place: 'mine' } });
    expect(read.structuredContent?.refused).toBeUndefined();
    expect(read.content[0].text).toContain('seed trays');

    withCatalog = false; // control: the same read, no catalog from the host
    const refused: any = await client.callTool({ name: 'read', arguments: { query: readNotes(), place: 'mine' } });
    expect(refused.structuredContent).toMatchObject({ refused: true, reason: 'not-granted' });
  });

  it('never reaches the package’s own Connection records or a shape outside the catalog', async () => {
    const client = await connect();
    const connections: any = await client.callTool({
      name: 'read',
      arguments: { query: (Connection.select((c: any) => c.keyHash) as any).toJSON(), place: 'mine' },
    });
    expect(connections.structuredContent?.refused).toBe(true);
    expect(connections.content[0].text).not.toMatch(/[0-9a-f]{64}/);
  });

  it('lists what it opens with `shapes`, only where the agent may work', async () => {
    const client = await connect();
    const listed: any = await client.callTool({ name: 'shapes', arguments: { place: 'mine' } });
    const ids = JSON.parse(listed.content[0].text).map((s: any) => s.id);
    // Only the app's own shape: the catalog's 13 built-in shapes are never opened.
    expect(catalog.size).toBeGreaterThan(1);
    expect(ids).toEqual([NOTE]);
    expect(ids).not.toContain(FOLDER);
    const outside: any = await client.callTool({ name: 'shapes', arguments: { place: 'theirs' } });
    expect(outside.structuredContent).toMatchObject({ refused: true, reason: 'out-of-scope' });
  });
});
