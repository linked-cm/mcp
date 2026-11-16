import { readFileSync } from 'node:fs';
import { readDeclarations, KIND, CONNECTION_LAYER } from '../src/declarations';
import { evaluate, effective, refusalText } from '../src/evaluate';
import { appTurtle, APP, NOTE, FOLDER } from './fixtures/shapes';

const vocabulary = readFileSync(new URL('../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
const d = readDeclarations({ vocabulary, declared: [{ name: 'app', turtle: appTurtle }] });
const WORKSPACE = APP + 'workspace';
const grants = (workspace: string[], connection: string[]) => ({
  [WORKSPACE]: new Set(workspace.map((c) => APP + c)),
  [CONNECTION_LAYER]: new Set(connection.map((c) => APP + c)),
});
const nameOf = (iri: string) => (iri === NOTE ? 'notes' : iri === FOLDER ? 'folders' : undefined);

describe('evaluate', () => {
  it('allows what every layer grants', () => {
    expect(evaluate(grants(['read-notes'], ['read-notes']), [{ kind: KIND.read, shape: NOTE }], d)).toEqual({ ok: true });
    expect(effective(grants(['read-notes', 'write-notes'], ['read-notes']), d).map((c) => c.iri)).toEqual([APP + 'read-notes']);
  });

  it('names the capability and exactly the layers that withheld it', () => {
    const verdict = evaluate(grants(['read-notes', 'write-notes'], ['read-notes']), [{ kind: KIND.update, shape: NOTE }], d);
    expect(verdict.ok).toBe(false);
    const [missing] = (verdict as any).missing;
    expect(missing.capability.iri).toBe(APP + 'write-notes');
    expect(missing.withheldBy.map((l: any) => l.iri)).toEqual([CONNECTION_LAYER]);
    expect(refusalText(verdict, d)).toBe("This connection doesn't allow agents to write notes.");
  });

  it('names every withholding layer', () => {
    const verdict = evaluate(grants([], []), [{ kind: KIND.delete, shape: NOTE }], d);
    expect((verdict as any).missing[0].withheldBy.map((l: any) => l.iri)).toEqual([WORKSPACE, CONNECTION_LAYER]);
    expect(refusalText(verdict, d)).toBe("Your workspace and This connection don't allow agents to delete notes.");
  });

  it('refuses what no capability covers, and says so', () => {
    const verdict = evaluate(grants(['read-notes'], ['read-notes']), [{ kind: KIND.delete, shape: FOLDER }], d);
    expect((verdict as any).missing[0]).toMatchObject({ capability: null, withheldBy: [] });
    expect(refusalText(verdict, d, { nameOf })).toBe('Nothing here lets agents delete folders.');
  });

  it('a layer missing from the grants grants nothing', () => {
    const verdict = evaluate({ [CONNECTION_LAYER]: new Set([APP + 'read-notes']) }, [{ kind: KIND.read, shape: NOTE }], d);
    expect((verdict as any).missing[0].withheldBy.map((l: any) => l.iri)).toEqual([WORKSPACE]);
  });

  it('covers callables and sub-shapes only as declared', () => {
    const all = grants(['archive', 'read-notes'], ['archive', 'read-notes']);
    expect(evaluate(all, [{ kind: KIND.call, callable: NOTE + '#archive' }], d).ok).toBe(true);
    expect(evaluate(all, [{ kind: KIND.call, callable: NOTE + '#delete' }], d).ok).toBe(false);
    const SUB = 'https://example.org/mcp-test/shape/PinnedNote';
    expect(evaluate(all, [{ kind: KIND.read, shape: SUB }], d).ok).toBe(false);
    expect(evaluate(all, [{ kind: KIND.read, shape: SUB }], d, { isShapeOrSubShape: (s, a) => s === a || (s === SUB && a === NOTE) }).ok).toBe(true);
  });
});
