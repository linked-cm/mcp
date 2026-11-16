import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { InMemoryDataset } from '@_linked/core/memory/InMemoryDataset';
import '../src/shapes/index';
import {
  changeConnection,
  connectionByKey,
  connectionOf,
  connectionsOf,
  disconnect,
  hashKey,
  issueConnection,
  newKey,
  noteActed,
} from '../src/backend/connections';

const ADA = 'https://example.org/person/ada';
const BEN = 'https://example.org/person/ben';
const options = { dataRoot: 'https://example.org/data/' };
let store: InMemoryDataset;
const issue = (person = ADA, extra = {}) =>
  issueConnection({ person, agentName: 'Notes agent', maker: 'Example Inc.', via: 'mcp', scope: ['https://example.org/space/1'], grants: ['https://example.org/app/read-notes'], ...extra }, options);
// Everything the store holds, as text (its private data map; a test may look).
const everythingStored = () =>
  JSON.stringify((store as any).data, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));

beforeEach(() => {
  store = new InMemoryDataset();
  LinkedStorage.setDefaultDataset(store as any);
});

describe('keys', () => {
  it('are a prefix and 32 random bytes, never twice the same', () => {
    expect(newKey('k_')).toMatch(/^k_[A-Za-z0-9_-]{43}$/);
    expect(newKey()).toMatch(/^lmc_/);
    expect(newKey()).not.toBe(newKey());
    expect(hashKey('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('connections', () => {
  it('issue returns the key once and keeps only its fingerprint', async () => {
    const { connection, key } = await issue();
    expect(connection.id.startsWith('https://example.org/data/connection/')).toBe(true);
    expect(connection.keyHint).toBe(key.slice(-4));
    const stored = await connectionByKey(key);
    expect(stored).toMatchObject({ id: connection.id, person: ADA, agentName: 'Notes agent', maker: 'Example Inc.', via: 'mcp' });
    expect(stored?.scope).toEqual(['https://example.org/space/1']);
    expect(stored?.grants).toEqual(['https://example.org/app/read-notes']);
    expect(JSON.stringify(stored)).not.toContain(key);
    // control: the dump does hold the record, its fingerprint included
    expect(everythingStored()).toContain(hashKey(key));
    expect(everythingStored()).not.toContain(key);
  });

  it('a wrong, empty, oversized or non-string key finds nothing', async () => {
    const { key } = await issue();
    for (const wrong of [key + 'x', '', 'x'.repeat(300), undefined, 42, { key }]) expect(await connectionByKey(wrong)).toBeUndefined();
  });

  it('disconnect stops the key at once; the record leaves the list', async () => {
    const { connection, key } = await issue();
    await disconnect(connection.id);
    expect(await connectionByKey(key)).toBeUndefined();
    expect(await connectionsOf(ADA)).toEqual([]);
  });

  it('change keeps the key', async () => {
    const { connection, key } = await issue();
    await changeConnection(connection.id, { scope: ['https://example.org/space/2'], grants: [] });
    const changed = await connectionByKey(key);
    expect(changed?.scope).toEqual(['https://example.org/space/2']);
    expect(changed?.grants).toEqual([]);
  });

  it('one person’s connections are theirs alone', async () => {
    const mine = await issue(ADA);
    await issue(BEN);
    expect((await connectionsOf(ADA)).map((c) => c.id)).toEqual([mine.connection.id]);
    expect(await connectionOf(BEN, mine.connection.id)).toBeUndefined();
  });

  it('notes when it acted', async () => {
    const { connection, key } = await issue();
    await noteActed(connection.id, new Date('2026-11-17T10:00:00Z'));
    expect((await connectionByKey(key))?.lastActedAt).toBe('2026-11-17T10:00:00.000Z');
  });

  it('refuses an issue without a person or a name', async () => {
    await expect(issueConnection({ person: '', agentName: 'x', scope: [], grants: [] }, options)).rejects.toThrow(TypeError);
    await expect(issueConnection({ person: ADA, agentName: ' ', scope: [], grants: [] }, options)).rejects.toThrow(TypeError);
  });
});
