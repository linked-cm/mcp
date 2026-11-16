import { readFileSync } from 'node:fs';
import { readDeclarations, labelOf, KIND, CONNECTION_LAYER } from '../src/declarations';
import { appTurtle, APP, NOTE } from './fixtures/shapes';

const vocabulary = readFileSync(new URL('../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
const read = (...declared: { name: string; turtle: string }[]) => readDeclarations({ vocabulary, declared });
const PREFIXES = `@prefix mcp: <https://linked.cm/ont/mcp/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix app: <${APP}> .`;

describe('readDeclarations', () => {
  it('reads an app’s capabilities, layers and presets, in order, with no gaps', () => {
    const d = read({ name: 'app', turtle: appTurtle });
    expect(d.gaps).toEqual([]);
    expect(d.capabilities.map((c) => c.iri)).toEqual([APP + 'read-notes', APP + 'write-notes', APP + 'delete-notes', APP + 'archive']);
    expect(d.capabilities[1]).toMatchObject({ label: 'Write notes', action: 'write notes', kinds: [KIND.create, KIND.update], shapes: [NOTE] });
    expect(d.layers.map((l) => l.iri)).toEqual([APP + 'workspace', CONNECTION_LAYER]);
    expect(d.presets).toEqual([{ iri: APP + 'reader', label: 'Reader', grants: [APP + 'read-notes'] }]);
    expect(labelOf(d, 'https://linked.cm/ont/mcp/NotGranted')).toBe('Not allowed');
  });

  it('reports a malformed capability as a gap, and keeps the rest', () => {
    const d = read(
      { name: 'app', turtle: appTurtle },
      {
        name: 'broken',
        turtle: `${PREFIXES}
          app:no-action a mcp:Capability ; rdfs:label "x"@en ; mcp:kind mcp:Read ; mcp:onShape <${NOTE}> .
          app:no-target a mcp:Capability ; rdfs:label "y"@en ; mcp:actionPhrase "y"@en ; mcp:kind mcp:Read .
          app:call-no-callable a mcp:Capability ; rdfs:label "z"@en ; mcp:actionPhrase "z"@en ; mcp:kind mcp:Call ; mcp:onShape <${NOTE}> .
          app:bad-callable a mcp:Capability ; rdfs:label "w"@en ; mcp:actionPhrase "w"@en ; mcp:kind mcp:Call ; mcp:onCallable "archive" .`,
      }
    );
    expect(d.capabilities).toHaveLength(4);
    const problems = (iri: string) => d.gaps.filter((g) => g.subject === APP + iri).map((g) => g.problem).join(' | ');
    expect(problems('no-action')).toMatch(/no action phrase/);
    expect(problems('no-target')).toMatch(/covers nothing/);
    expect(problems('call-no-callable')).toMatch(/mcp:Call needs mcp:onCallable/);
    expect(problems('bad-callable')).toMatch(/not <shape or package>#<method>/);
    expect(d.gaps.every((g) => g.source === 'broken')).toBe(true);
  });

  it('gives an operation two capabilities claim to neither', () => {
    const d = read({
      name: 'app',
      turtle: `${PREFIXES}
        app:a a mcp:Capability ; rdfs:label "a"@en ; mcp:actionPhrase "a"@en ; mcp:kind mcp:Perform ; mcp:coversOperation "propose", "comment" .
        app:b a mcp:Capability ; rdfs:label "b"@en ; mcp:actionPhrase "b"@en ; mcp:kind mcp:Perform ; mcp:coversOperation "propose" .`,
    });
    expect(d.capabilities.map((c) => [c.iri, c.operations])).toEqual([[APP + 'a', ['comment']]]);
    expect(d.gaps.filter((g) => /also claimed/.test(g.problem))).toHaveLength(2);
  });

  it('drops a preset’s unknown capability, and a layer without an order', () => {
    const d = read({
      name: 'app',
      turtle: `${PREFIXES}
        app:p a mcp:Preset ; rdfs:label "p"@en ; mcp:grantsCapability app:nope .
        app:l a mcp:Layer ; rdfs:label "l"@en .`,
    });
    expect(d.presets[0]?.grants).toEqual([]);
    expect(d.gaps.map((g) => g.subject).sort()).toEqual([APP + 'l', APP + 'p']);
  });

  it('reports Turtle it cannot parse as a gap of that source', () => {
    const d = read({ name: 'typo', turtle: 'this is not turtle' });
    expect(d.gaps[0]).toMatchObject({ source: 'typo' });
    expect(d.layers.map((l) => l.iri)).toEqual([CONNECTION_LAYER]);
  });
});
