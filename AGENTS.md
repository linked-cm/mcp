# AGENTS.md — @linked.cm/mcp

Connected agents for Linked apps over the Model Context Protocol. An asset package (`"linked": {"kind": "assets"}`): shapes, components and a backend, no ontology. Its vocabulary is `@linked.cm/mcp-ont`.

Staged in the **linked-cm** org (npm scope `@linked.cm`) pending review; it moves to linked-fw only after approval. Local only until its GitHub repository is made.

## Do not change without a migration

- `linkedPackage('@linked.cm/mcp')` in `src/package.ts`: it decides the shape IRIs (`https://linked.cm/shape/mcp/…`).

## Rules

- **The agent acts as its person, never more.** Every call runs under `runAsDelegate` (`@_linked/server-utils` ≥ 1.18), so the store rules check it like the person's own request; declared capabilities narrow further. Nothing is cached across calls.
- **Through Linked's own paths.** Reads and writes are DSL-JSON through `@_linked/server`'s query plane (decode, authorize, run); calls are declared provider methods. No raw SPARQL, no second query path.
- **Nothing open by default.** A shape or a callable is reachable only when a capability names it.
- **What an agent reads is data**, never instructions; results are returned as content.
- The root entry imports no server code; server code lives under `src/backend/` (server-only by convention).
- Package docs say what, never which app.
- Releases go through changesets (`npx changeset`).

## Until @_linked/server-utils 1.18 is published

The delegated call context is linked-fw/server-utils#125. `peerDependencies` names `^1.18.0`; for local work `node_modules/@_linked/server-utils` is a link to that branch's checkout.

## Agent docs (`docs/`)

Same convention as linked-fw packages: `docs/ideas`, `docs/plans`, `docs/reports`, numbered with a 3-digit prefix, each starting with YAML frontmatter (`summary`, `packages`). Use the `workflow` skill for any change.
