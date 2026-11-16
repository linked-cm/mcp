/**
 * Connections and their keys. A key is random, shown once when the connection
 * is issued, and never stored: only its SHA-256 is kept, and a lookup goes by
 * that. A disconnected connection's key finds nothing.
 *
 * Every read here is fresh: the endpoint looks the connection up on every call
 * and caches nothing, so a disconnect or a change of grants takes effect on
 * the agent's next call.
 *
 * Server-only (node:crypto). Queries go through Linked Query on the
 * `Connection` shape; where its data lives is the app's storage routing.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Connection } from '../shapes/connection.js';

/** A connection as the app and the endpoint see it. Its key is never part of it. */
export interface ConnectionRecord {
  readonly id: string;
  readonly person: string;
  readonly agentName: string;
  readonly maker?: string;
  readonly via?: string;
  /** Where it may work (IRIs). */
  readonly scope: readonly string[];
  /** The capability IRIs its person gave it. */
  readonly grants: readonly string[];
  /** The app's own settings for it, as JSON text. */
  readonly settings?: string;
  readonly keyHint: string;
  readonly connectedAt: string;
  readonly lastActedAt?: string;
}

export interface IssueConnectionInput {
  readonly person: string;
  readonly agentName: string;
  readonly maker?: string;
  readonly via?: string;
  readonly scope: readonly string[];
  readonly grants: readonly string[];
  readonly settings?: string;
}

export interface IssueOptions {
  /** Where new connection IRIs are minted; the app's data root. */
  readonly dataRoot: string;
  /** Put in front of every key, so a key pasted in the wrong place is recognisable. Default `lmc_`. */
  readonly keyPrefix?: string;
  readonly now?: Date;
}

/** Keys longer than this are refused before hashing. */
const MAX_KEY_LENGTH = 200;

/** A new key: the prefix and 32 random bytes, URL-safe. */
export const newKey = (prefix = 'lmc_'): string => `${prefix}${randomBytes(32).toString('base64url')}`;

/** The fingerprint kept for a key. */
export const hashKey = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

const iso = (value: unknown): string | undefined =>
  value instanceof Date ? (Number.isNaN(value.getTime()) ? undefined : value.toISOString()) : typeof value === 'string' && value ? value : undefined;
const idOf = (value: unknown): string =>
  typeof value === 'string' ? value : ((value as { id?: string } | null | undefined)?.id ?? '');
const list = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]).map((v) => idOf(v)).filter(Boolean);

type Row = Record<string, unknown> & { id: string };

const selectConnections = () =>
  Connection.select((c) => [
    c.person,
    c.agentName,
    c.maker,
    c.via,
    c.scope,
    c.grants,
    c.settings,
    c.keyHash,
    c.keyHint,
    c.connectedAt,
    c.lastActedAt,
    c.disconnectedAt,
  ]);

const asRecord = (row: Row): ConnectionRecord => {
  const lastActedAt = iso(row.lastActedAt);
  const maker = typeof row.maker === 'string' && row.maker ? row.maker : undefined;
  const via = typeof row.via === 'string' && row.via ? row.via : undefined;
  const settings = typeof row.settings === 'string' && row.settings ? row.settings : undefined;
  return {
    id: row.id,
    person: idOf(row.person),
    agentName: String(row.agentName ?? ''),
    ...(maker ? { maker } : {}),
    ...(via ? { via } : {}),
    scope: list(row.scope),
    grants: list(row.grants),
    ...(settings ? { settings } : {}),
    keyHint: String(row.keyHint ?? ''),
    connectedAt: iso(row.connectedAt) ?? '',
    ...(lastActedAt ? { lastActedAt } : {}),
  };
};

const live = (row: Row) => !iso(row.disconnectedAt);

async function rowsWhere(filter: (c: any) => any): Promise<Row[]> {
  return ((await selectConnections().where(filter)) ?? []) as unknown as Row[];
}

/** Issue a connection: the record, and its key, which is returned this once and never again. */
export async function issueConnection(
  input: IssueConnectionInput,
  options: IssueOptions
): Promise<{ connection: ConnectionRecord; key: string }> {
  if (!input.person) throw new TypeError('issueConnection: a person is required');
  if (!input.agentName?.trim()) throw new TypeError('issueConnection: an agent name is required');
  const key = newKey(options.keyPrefix);
  const now = options.now ?? new Date();
  const id = `${options.dataRoot.replace(/\/+$/, '')}/connection/${randomUUID()}`;
  await Connection.create({
    __id: id,
    person: { id: input.person },
    agentName: input.agentName.trim(),
    ...(input.maker ? { maker: input.maker } : {}),
    ...(input.via ? { via: input.via } : {}),
    scope: [...input.scope],
    grants: [...input.grants],
    ...(input.settings ? { settings: input.settings } : {}),
    keyHash: hashKey(key),
    keyHint: key.slice(-4),
    connectedAt: now,
  } as never);
  return {
    connection: {
      id,
      person: input.person,
      agentName: input.agentName.trim(),
      ...(input.maker ? { maker: input.maker } : {}),
      ...(input.via ? { via: input.via } : {}),
      scope: [...input.scope],
      grants: [...input.grants],
      ...(input.settings ? { settings: input.settings } : {}),
      keyHint: key.slice(-4),
      connectedAt: now.toISOString(),
    },
    key,
  };
}

/** The live connection a key belongs to, or nothing. Same answer for an unknown and a disconnected key. */
export async function connectionByKey(key: unknown): Promise<ConnectionRecord | undefined> {
  if (typeof key !== 'string' || !key || key.length > MAX_KEY_LENGTH) return undefined;
  const hash = hashKey(key);
  const rows = await rowsWhere((c) => c.keyHash.equals(hash));
  const row = rows.find((r) => r.keyHash === hash && live(r));
  return row ? asRecord(row) : undefined;
}

/** One person's live connections, newest first. */
export async function connectionsOf(person: string): Promise<ConnectionRecord[]> {
  const rows = await rowsWhere((c) => c.person.equals({ id: person }));
  return rows
    .filter((r) => idOf(r.person) === person && live(r))
    .map(asRecord)
    .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
}

/** One live connection of this person's, or nothing. */
export async function connectionOf(person: string, id: string): Promise<ConnectionRecord | undefined> {
  return (await connectionsOf(person)).find((c) => c.id === id);
}

/** Change where it may work, what it may do, or the app's settings. Its key stays. */
export async function changeConnection(
  id: string,
  change: { readonly scope?: readonly string[]; readonly grants?: readonly string[]; readonly settings?: string }
): Promise<void> {
  await Connection.update({
    ...(change.scope ? { scope: [...change.scope] } : {}),
    ...(change.grants ? { grants: [...change.grants] } : {}),
    ...(change.settings !== undefined ? { settings: change.settings } : {}),
  } as never).for({ id });
}

/** Disconnect: from now on its key finds nothing. Its record stays, for History. */
export async function disconnect(id: string, now: Date = new Date()): Promise<void> {
  await Connection.update({ disconnectedAt: now } as never).for({ id });
}

/** Note that it acted. */
export async function noteActed(id: string, now: Date = new Date()): Promise<void> {
  await Connection.update({ lastActedAt: now } as never).for({ id });
}
