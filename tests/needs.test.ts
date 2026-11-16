import { KIND } from '../src/declarations';
import { needsOfQuery, QueryNotUnderstoodError } from '../src/backend/needs';
import { Note, NOTE, FOLDER } from './fixtures/shapes';

describe('needsOfQuery', () => {
  it('a select needs Read on every shape it touches, through a traversal too', () => {
    const json = Note.select((n: any) => [n.text, n.folder.title]).toJSON();
    const { operation, needs } = needsOfQuery(json);
    expect(operation).toBe('select');
    expect(needs).toEqual(
      expect.arrayContaining([
        { kind: KIND.read, shape: NOTE },
        { kind: KIND.read, shape: FOLDER },
      ])
    );
    expect(needs).toHaveLength(2);
  });

  it('a create needs Create on what it writes and Read on what it links to', () => {
    const json = Note.create({ text: 'hello', folder: { id: 'https://example.org/folder/1' } } as any).toJSON();
    const { operation, needs } = needsOfQuery(json);
    expect(operation).toBe('create');
    expect(needs).toContainEqual({ kind: KIND.create, shape: NOTE });
    expect(needs.some((n) => n.kind !== KIND.read && 'shape' in n && n.shape === FOLDER)).toBe(false);
  });

  it('an update needs Update, and a delete needs Delete, on the written shape', () => {
    const update = Note.update({ text: 'changed' } as any).for({ id: 'https://example.org/note/1' }).toJSON();
    expect(needsOfQuery(update)).toMatchObject({ operation: 'update', needs: [{ kind: KIND.update, shape: NOTE }] });
    const del = Note.delete({ id: 'https://example.org/note/1' }).toJSON();
    expect(needsOfQuery(del)).toMatchObject({ operation: 'delete', needs: [{ kind: KIND.delete, shape: NOTE }] });
  });

  it('refuses what it cannot read, by name', () => {
    expect(() => needsOfQuery({ nonsense: true })).toThrow(QueryNotUnderstoodError);
    expect(() => needsOfQuery('select * where {?s ?p ?o}')).toThrow(QueryNotUnderstoodError);
  });
});
