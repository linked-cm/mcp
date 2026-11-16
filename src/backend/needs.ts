/**
 * What a DSL-JSON query needs an agent to be allowed: one need per shape it
 * touches. It is decoded and lowered exactly as the server's query plane does
 * (`toQueryBuilder`, `lowerForAccessCheck`) and walked with the same function
 * the store rules use (`collectQueryTargets`), so "what a query touches" has
 * one definition.
 *
 * - A select, count or ask needs Read on every shape it touches.
 * - A create, update or delete needs its kind on every shape it writes, and
 *   Read on every other shape it touches (one it links to or traverses).
 *
 * Server-only.
 */
import type { ShapeCatalog } from '@_linked/core/utils/ShapeCatalog';
import { lowerForAccessCheck, toQueryBuilder } from '@_linked/server/utils/queryPlane';
import { collectQueryTargets } from '@_linked/server-utils/utils/QueryAccess';
import { KIND } from '../declarations.js';
import type { Need } from '../evaluate.js';

export type QueryOperation = 'select' | 'ask' | 'create' | 'update' | 'delete';

const OPERATION_OF_KIND: Readonly<Record<string, QueryOperation>> = {
  select: 'select',
  count: 'select',
  ask: 'ask',
  create: 'create',
  update: 'update',
  update_where: 'update',
  delete: 'delete',
  delete_all: 'delete',
  delete_where: 'delete',
};

const WRITE_KIND = {
  create: KIND.create,
  update: KIND.update,
  delete: KIND.delete,
} as const;

export class QueryNotUnderstoodError extends Error {}

export interface QueryNeeds {
  /** The rehydrated query, to authorize and run (it is closed: run this one, not a new decode). */
  readonly builder: unknown;
  readonly operation: QueryOperation;
  readonly needs: readonly Need[];
}

/** Decode `json` in `catalog` and say what it needs. Throws `QueryNotUnderstoodError` for a query it can't read. */
export function needsOfQuery(json: unknown, catalog?: ShapeCatalog): QueryNeeds {
  let builder: unknown;
  try {
    builder = toQueryBuilder(json, catalog);
  } catch (error) {
    throw new QueryNotUnderstoodError(`The query could not be read: ${(error as Error).message}`);
  }
  const ir = lowerForAccessCheck(builder) as { kind?: string } | undefined;
  const operation = ir?.kind ? OPERATION_OF_KIND[ir.kind] : undefined;
  if (!ir || !operation) throw new QueryNotUnderstoodError('The query could not be read: it is not a select, count, ask, create, update or delete.');
  const targets = collectQueryTargets(ir);
  const needs: Need[] = [];
  const isWrite = operation === 'create' || operation === 'update' || operation === 'delete';
  for (const shape of [...targets.shapes].sort()) {
    if (isWrite && targets.writtenShapes.has(shape)) needs.push({ kind: WRITE_KIND[operation], shape });
    else needs.push({ kind: KIND.read, shape });
  }
  // A query that touches no shape would pass any capability check by having nothing to check.
  if (!needs.length) throw new QueryNotUnderstoodError('The query could not be read: it touches no shape.');
  return { builder, operation, needs };
}
