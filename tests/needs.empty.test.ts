// A query whose walk finds no shape would have nothing to check, and so would pass any
// capability check. needsOfQuery must refuse it rather than answer "no needs".
vi.mock('@_linked/server-utils/utils/QueryAccess', async (original) => ({
  ...(await original<object>()),
  collectQueryTargets: () => ({ shapes: new Set(), writtenShapes: new Set(), propertyShapes: new Set() }),
}));

import { needsOfQuery, QueryNotUnderstoodError } from '../src/backend/needs';
import { Note } from './fixtures/shapes';

describe('needsOfQuery, when a walk finds nothing', () => {
  it('refuses instead of answering "no needs"', () => {
    expect(() => needsOfQuery(Note.select((n: any) => n.text).toJSON())).toThrow(QueryNotUnderstoodError);
    expect(() => needsOfQuery(Note.select((n: any) => n.text).toJSON())).toThrow(/touches no shape/);
  });
});
