// The forms the package teaches an agent must be ones Linked reads: each example, filled in for a
// real shape, decodes with the server's own decoder (`needsOfQuery`) as the operation it claims.
import { needsOfQuery } from '../src/backend/needs';
import { QUERY_EXAMPLES, exampleRead, queryToolDescription, unreadableQueryText } from '../src/backend/queryGuide';
import { NOTE } from './fixtures/shapes';

/** An example with its placeholders filled for the Note fixture (property `text`). */
const filled = (example: unknown) =>
  JSON.parse(
    JSON.stringify(example)
      .replaceAll('<shape id>', NOTE)
      .replaceAll('<node id>', 'https://example.org/note/1')
      .replaceAll('"friends.name"', '"text"')
      .replaceAll('"name"', '"text"')
  );

describe('the query forms an agent is taught', () => {
  it('each example decodes as its own operation', () => {
    expect(needsOfQuery(filled(QUERY_EXAMPLES.read)).operation).toBe('select');
    expect(needsOfQuery(filled(QUERY_EXAMPLES.create)).operation).toBe('create');
    expect(needsOfQuery(filled(QUERY_EXAMPLES.update)).operation).toBe('update');
    expect(needsOfQuery(filled(QUERY_EXAMPLES.delete)).operation).toBe('delete');
  });

  it('a shape’s ready read decodes as a select of that shape', () => {
    const decoded = needsOfQuery(exampleRead(NOTE, ['text']));
    expect(decoded.operation).toBe('select');
    expect(decoded.needs.map((n: any) => n.shape)).toEqual([NOTE]);
  });

  it('every query tool shows its form, and an unreadable query is answered with it', () => {
    for (const tool of ['read', 'create', 'update', 'delete'] as const)
      expect(queryToolDescription(tool)).toContain(JSON.stringify(QUERY_EXAMPLES[tool]));
    expect(unreadableQueryText('The query could not be read: Invalid query', 'read')).toContain('"fields":["name","friends.name"]');
  });
});
