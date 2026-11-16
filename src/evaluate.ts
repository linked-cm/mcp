/**
 * What an agent may do: the capabilities every layer grants. A need (an act
 * on a shape, a callable or an operation) is allowed when one capability
 * covers it and every layer grants that capability. Nothing is allowed by
 * default: a need no capability covers is refused, and so is one some layer
 * withholds.
 *
 * The person's own rights are not decided here: the app's access rules check
 * every query and call as the person's (the delegated call context).
 */
import { KIND, labelOf, MCP, type Capability, type Declarations, type KindIri, type Layer } from './declarations.js';

/** What one request needs. */
export type Need =
  | { readonly kind: Exclude<KindIri, typeof KIND.call | typeof KIND.perform>; readonly shape: string }
  | { readonly kind: typeof KIND.call; readonly callable: string }
  | { readonly kind: typeof KIND.perform; readonly operation: string };

/** What each layer grants, by layer IRI: the capability IRIs. A layer missing here grants nothing. */
export type Grants = Readonly<Record<string, ReadonlySet<string>>>;

export interface Missing {
  readonly need: Need;
  /** The first capability (in declared order) that would cover it, or null when none does. */
  readonly capability: Capability | null;
  /** The layers that grant none of the capabilities covering it. Empty when nothing covers it. */
  readonly withheldBy: readonly Layer[];
}

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly missing: readonly Missing[] };

export interface EvaluateOptions {
  /** Whether `shape` is `ancestor` or one of its sub-shapes. Default: the same IRI only. */
  readonly isShapeOrSubShape?: (shape: string, ancestor: string) => boolean;
  /**
   * Whether `shape` is one of the app's own, in the catalog the call is decoded in: what
   * `mcp:AnyShape` covers. Absent (no catalog), `mcp:AnyShape` covers nothing.
   */
  readonly isAppShape?: (shape: string) => boolean;
}

/** `mcp:onShape mcp:AnyShape`: every shape of the app's own catalog. */
export const ANY_SHAPE = `${MCP}AnyShape`;

function covers(capability: Capability, need: Need, options: EvaluateOptions): boolean {
  if (!capability.kinds.includes(need.kind)) return false;
  if ('shape' in need) {
    const within = options.isShapeOrSubShape ?? ((a: string, b: string) => a === b);
    return capability.shapes.some((shape) =>
      shape === ANY_SHAPE ? options.isAppShape?.(need.shape) === true : within(need.shape, shape)
    );
  }
  if ('callable' in need) return capability.callables.includes(need.callable);
  return capability.operations.includes(need.operation);
}

/** Decide every need; the verdict lists each one that is not allowed. */
export function evaluate(grants: Grants, needs: readonly Need[], d: Declarations, options: EvaluateOptions = {}): Verdict {
  const missing: Missing[] = [];
  for (const need of needs) {
    const covering = d.capabilities.filter((capability) => covers(capability, need, options));
    const allowed = covering.some((capability) => d.layers.every((layer) => grants[layer.iri]?.has(capability.iri) ?? false));
    if (allowed) continue;
    const withheldBy = covering.length
      ? d.layers.filter((layer) => !covering.some((capability) => grants[layer.iri]?.has(capability.iri)))
      : [];
    missing.push({ need, capability: covering[0] ?? null, withheldBy });
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** The capabilities every layer grants. */
export function effective(grants: Grants, d: Declarations): readonly Capability[] {
  return d.capabilities.filter((capability) => d.layers.every((layer) => grants[layer.iri]?.has(capability.iri) ?? false));
}

const describeNeed = (need: Need, d: Declarations, lang: string, nameOf?: (iri: string) => string | undefined) => {
  const kind = (labelOf(d, need.kind, lang) ?? need.kind.slice(MCP.length)).toLowerCase();
  if ('shape' in need) return `${kind} ${nameOf?.(need.shape) ?? need.shape}`;
  if ('callable' in need) return `${kind} ${need.callable.split('#').pop()}`;
  return `${kind} "${need.operation}"`;
};

/**
 * A refusal in words, for the agent and for its person: what is missing and
 * which layer withheld it. `nameOf` names a shape (its label) when it can.
 */
export function refusalText(
  verdict: Verdict,
  d: Declarations,
  options: { readonly lang?: string; readonly nameOf?: (iri: string) => string | undefined } = {}
): string {
  if (!('missing' in verdict)) return '';
  const lang = options.lang ?? 'en';
  return verdict.missing
    .map((m) => {
      if (!m.capability) return `Nothing here lets agents ${describeNeed(m.need, d, lang, options.nameOf)}.`;
      const action = m.capability.action;
      const layers = m.withheldBy.map((layer) => labelOf(d, layer.iri, lang) ?? layer.label);
      return layers.length
        ? `${layers.join(' and ')} ${layers.length > 1 ? "don't" : "doesn't"} allow agents to ${action}.`
        : `Agents can't ${action} here.`;
    })
    .join(' ');
}
