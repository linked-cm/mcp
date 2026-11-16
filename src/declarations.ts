/**
 * Reading what an app declares about agents: its capabilities, layers and
 * presets, as Turtle in the `mcp:` vocabulary (`@linked.cm/mcp-ont`).
 *
 * Nothing malformed is used. Every problem is reported as a gap naming the
 * source, the subject and what is wrong, and the rest is still returned, so
 * one broken declaration never takes the others down with it.
 *
 * The checks are written out here rather than as SHACL: linked-fw has no SHACL
 * checker to share yet. They follow the vocabulary's rules one for one, and
 * move to shapes when there is one.
 */
import { Parser, Store, type Quad_Object, type Quad_Subject } from 'n3';

export const MCP = 'https://linked.cm/ont/mcp/';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';

/** The kinds of act, by IRI. */
export const KIND = Object.freeze({
  read: `${MCP}Read`,
  create: `${MCP}Create`,
  update: `${MCP}Update`,
  delete: `${MCP}Delete`,
  call: `${MCP}Call`,
  perform: `${MCP}Perform`,
});
export type KindIri = (typeof KIND)[keyof typeof KIND];
const KINDS = new Set<string>(Object.values(KIND));
const SHAPE_KINDS = new Set<string>([KIND.read, KIND.create, KIND.update, KIND.delete]);

/** The layer every connection has: what its person gave it. */
export const CONNECTION_LAYER = `${MCP}ConnectionLayer`;

export interface Capability {
  readonly iri: string;
  readonly label: string;
  readonly description: string;
  /** How a refusal says it: "… doesn't allow agents to {action}". */
  readonly action: string;
  readonly order: number;
  readonly kinds: readonly KindIri[];
  readonly shapes: readonly string[];
  readonly callables: readonly string[];
  readonly operations: readonly string[];
}

export interface Layer {
  readonly iri: string;
  readonly label: string;
  readonly order: number;
}

export interface Preset {
  readonly iri: string;
  readonly label: string;
  readonly grants: readonly string[];
}

export interface Gap {
  /** Which source it came from (the name it was given). */
  readonly source: string;
  readonly subject: string;
  readonly problem: string;
}

export interface Declarations {
  readonly capabilities: readonly Capability[];
  readonly layers: readonly Layer[];
  readonly presets: readonly Preset[];
  /** Labels of the vocabulary's own terms (kinds, refusal reasons), by language. */
  readonly labels: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly gaps: readonly Gap[];
}

export interface DeclarationSource {
  readonly name: string;
  readonly turtle: string;
}

/**
 * Read the vocabulary and an app's declarations together.
 *
 * `vocabulary` is the `mcp:` Turtle (`@linked.cm/mcp-ont`'s `src/data/mcp.ttl`);
 * `declared` is the app's own Turtle, in order.
 */
export function readDeclarations(input: {
  readonly vocabulary: string;
  readonly declared: readonly DeclarationSource[];
}): Declarations {
  const gaps: Gap[] = [];
  const store = new Store();
  const sourceOf = new Map<string, string>();
  for (const source of [{ name: 'vocabulary', turtle: input.vocabulary }, ...input.declared]) {
    let quads;
    try {
      quads = new Parser().parse(source.turtle);
    } catch (error) {
      gaps.push({ source: source.name, subject: '', problem: `not Turtle: ${(error as Error).message}` });
      continue;
    }
    for (const quad of quads) {
      store.addQuad(quad);
      if (!sourceOf.has(quad.subject.value)) sourceOf.set(quad.subject.value, source.name);
    }
  }
  const from = (iri: string) => sourceOf.get(iri) ?? 'vocabulary';
  const objects = (s: string, p: string) => store.getObjects(s as unknown as Quad_Subject, p, null);
  const literals = (s: string, p: string) => objects(s, p).filter((o) => o.termType === 'Literal');
  const iris = (s: string, p: string) => objects(s, p).filter((o) => o.termType === 'NamedNode').map((o) => o.value);
  const english = (s: string, p: string) =>
    literals(s, p).find((o) => (o as Quad_Object & { language: string }).language === 'en')?.value ??
    literals(s, p).find((o) => !(o as Quad_Object & { language: string }).language)?.value;
  const order = (s: string): number | undefined => {
    const value = literals(s, `${MCP}order`)[0] as (Quad_Object & { datatype: { value: string } }) | undefined;
    if (!value) return undefined;
    const n = Number(value.value);
    return value.datatype?.value === XSD_INTEGER && Number.isInteger(n) ? n : undefined;
  };
  const membersOf = (cls: string) =>
    store.getSubjects(RDF_TYPE, cls, null).filter((s) => s.termType === 'NamedNode').map((s) => s.value);

  const labels = new Map<string, Map<string, string>>();
  for (const quad of store.getQuads(null, RDFS_LABEL, null, null)) {
    if (quad.object.termType !== 'Literal') continue;
    const byLanguage = labels.get(quad.subject.value) ?? new Map<string, string>();
    byLanguage.set((quad.object as Quad_Object & { language: string }).language || '', quad.object.value);
    labels.set(quad.subject.value, byLanguage);
  }

  const capabilities: Capability[] = [];
  for (const iri of membersOf(`${MCP}Capability`)) {
    const gap = (problem: string) => gaps.push({ source: from(iri), subject: iri, problem });
    const label = english(iri, RDFS_LABEL);
    const action = english(iri, `${MCP}actionPhrase`);
    const kinds = iris(iri, `${MCP}kind`);
    const shapes = iris(iri, `${MCP}onShape`);
    const callables = literals(iri, `${MCP}onCallable`).map((o) => o.value);
    const operations = literals(iri, `${MCP}coversOperation`).map((o) => o.value);
    const problems: string[] = [];
    if (!label) problems.push('no label');
    if (!action) problems.push('no action phrase (mcp:actionPhrase)');
    if (!kinds.length) problems.push('no kind (mcp:kind)');
    for (const kind of kinds) if (!KINDS.has(kind)) problems.push(`unknown kind ${kind}`);
    if (!shapes.length && !callables.length && !operations.length)
      problems.push('covers nothing (mcp:onShape, mcp:onCallable or mcp:coversOperation)');
    if (kinds.some((k) => SHAPE_KINDS.has(k)) && !shapes.length) problems.push('a read, create, update or delete kind needs mcp:onShape');
    if (kinds.includes(KIND.call) && !callables.length) problems.push('mcp:Call needs mcp:onCallable');
    if (kinds.includes(KIND.perform) && !operations.length) problems.push('mcp:Perform needs mcp:coversOperation');
    for (const callable of callables)
      if (!/^.+#[A-Za-z_$][\w$]*$/.test(callable)) problems.push(`callable "${callable}" is not <shape or package>#<method>`);
    if (problems.length) {
      for (const problem of problems) gap(problem);
      continue;
    }
    capabilities.push({
      iri,
      label: label!,
      description: english(iri, RDFS_COMMENT) ?? '',
      action: action!,
      order: order(iri) ?? Number.MAX_SAFE_INTEGER,
      kinds: kinds as KindIri[],
      shapes,
      callables,
      operations,
    });
  }

  // One operation, one capability: an operation two capabilities claim is used by neither.
  const claims = new Map<string, string[]>();
  for (const capability of capabilities)
    for (const operation of capability.operations) claims.set(operation, [...(claims.get(operation) ?? []), capability.iri]);
  const contested = new Set<string>();
  for (const [operation, claimants] of claims)
    if (claimants.length > 1) {
      contested.add(operation);
      for (const iri of claimants)
        gaps.push({ source: from(iri), subject: iri, problem: `operation "${operation}" is also claimed by ${claimants.filter((c) => c !== iri).join(', ')}; neither covers it` });
    }
  const finalCapabilities = capabilities
    .map((c) => (c.operations.some((o) => contested.has(o)) ? { ...c, operations: c.operations.filter((o) => !contested.has(o)) } : c))
    .filter((c) => c.shapes.length || c.callables.length || c.operations.length)
    .sort((a, b) => a.order - b.order || a.iri.localeCompare(b.iri));
  const known = new Set(finalCapabilities.map((c) => c.iri));

  const layers: Layer[] = [];
  for (const iri of membersOf(`${MCP}Layer`)) {
    const label = english(iri, RDFS_LABEL);
    const layerOrder = order(iri);
    if (!label || layerOrder === undefined) {
      gaps.push({ source: from(iri), subject: iri, problem: !label ? 'no label' : 'no integer mcp:order' });
      continue;
    }
    layers.push({ iri, label, order: layerOrder });
  }
  layers.sort((a, b) => a.order - b.order || a.iri.localeCompare(b.iri));

  const presets: Preset[] = [];
  for (const iri of membersOf(`${MCP}Preset`)) {
    const label = english(iri, RDFS_LABEL);
    if (!label) {
      gaps.push({ source: from(iri), subject: iri, problem: 'no label' });
      continue;
    }
    const grants = iris(iri, `${MCP}grantsCapability`);
    for (const grant of grants)
      if (!known.has(grant)) gaps.push({ source: from(iri), subject: iri, problem: `grants ${grant}, which is not a usable capability` });
    presets.push({ iri, label, grants: grants.filter((g) => known.has(g)) });
  }

  return Object.freeze({
    capabilities: Object.freeze(finalCapabilities),
    layers: Object.freeze(layers),
    presets: Object.freeze(presets),
    labels,
    gaps: Object.freeze(gaps),
  });
}

/** A term's label in `lang`, else English, else any. */
export function labelOf(d: Declarations, iri: string, lang = 'en'): string | undefined {
  const byLanguage = d.labels.get(iri);
  return byLanguage?.get(lang) ?? byLanguage?.get('en') ?? byLanguage?.get('') ?? byLanguage?.values().next().value;
}
