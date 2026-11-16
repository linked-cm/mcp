---
summary: Plan for Linked MCP — the agent face of a shape. A Linked app's shapes, queries and declared backend methods become what a connected agent can read, change and call, as a named person, within declared limits. Two packages: the vocabulary (mcp-ont) and the code (mcp). Revised 2026-11-17 after reviewing linked-fw; replaces the first draft, which treated MCP as a generic tool server.
status: Implementation
packages: [mcp-ont, mcp]
---

# 001 — Linked MCP: agents come in through the shapes

**Where this lives.** `mcp/docs/plans/001-linked-mcp.md`; it covers both packages.

**Naming rule.** Open-source side. Nothing in either package names an app. Apps are "the host".

## 1. Why the first draft was wrong

It made the host hand-write every tool and had the package only guard them. Nothing in it used a shape. Linked's point is that **a shape is the one contract** that data, backend and UI all bind to:

| Face | Package | What it does with a shape |
|---|---|---|
| Data | `@_linked/core` | queries it; every query has one wire form, DSL-JSON |
| Backend | `@_linked/server`, `server-utils` | providers attach declared methods to it (`@callable`) |
| UI | `@_linked/react`, `shape-ui` | renders and edits *any* shape, not a known one |
| **Agents** | **Linked MCP (this plan)** | **lets an agent read, change and call *any* shape the host opens to it** |

So this package is to agents what `shape-ui` is to screens. An app that adds a shape gets an agent surface for it without writing a tool.

## 2. What linked-fw already gives us (reviewed 2026-11-17)

- **DSL-JSON** (`core`): select, count, ask, create, update and delete as lossless JSON with a wire version. It is already "the format to send over HTTP … or implement on a non-JS backend". It is the natural input of an agent's query tool; we add no query language.
- **Shape catalogs** (`core`): `ShapeCatalog` and the shape wire metadata describe every shape of a scope (a host with several projects resolves one per request). This is what an agent reads to learn what exists.
- **The generic query plane** (`server`): `readQuery`, `createQuery`, `updateQuery`, `deleteQuery` run a client-built DSL-JSON query under the store's access rule (`QueryAccess`), as the signed-in user from the call context.
- **Declared callables** (`server-utils`): only `@callable('public' | 'signed-in')` methods are reachable; the body reads the user with `requireSessionUser()`, never from arguments.
- **Provider lifecycle** (`server`): `BackendProvider.registerRoute` / `disposeRoutes` for an endpoint that survives hot reload; server code under `backend/` is server-only by convention.
- **Package kinds** (`cli`): a package is an ontology package (`<name>-ont`, one ontology as Turtle, no shapes) or an asset package (`<name>-assets`, shapes, components and a backend, no ontology). `create-package --kind both` makes the pair.
- **SHACL validation** on writes, and **rate limits** in the style `auth` documents.

## 3. The design

### 3.1 Two packages

- **`@linked.cm/mcp-ont`** — the vocabulary, as Turtle (`https://linked.cm/ont/mcp/`):
  - `mcp:Connection` and its properties;
  - `mcp:Capability`, with what it covers: operation kinds (`mcp:Read`, `mcp:Create`, `mcp:Update`, `mcp:Delete`, `mcp:Call`) on shapes (`mcp:onShape`), on callables (`mcp:onCallable`) or on host operations (`mcp:coversOperation`);
  - `mcp:Layer`, `mcp:Preset`;
  - refusal reasons with `rdfs:label`.
- **`@linked.cm/mcp`** — everything that binds it:
  - **shape:** `Connection` (data);
  - **backend:** the MCP endpoint, the key check, the evaluator (backend);
  - **components:** shape-driven consent form and connection list (UI).
  
  One shape, all three faces, which is the Linked pattern.

### 3.2 What an agent gets, with no tool written by the host

| MCP tool | Backed by | Checked by |
|---|---|---|
| `shapes` — the shapes open to this connection: fields, types, constraints, labels | the request's `ShapeCatalog` wires | capability covers `Read` on the shape |
| `read` — a DSL-JSON select, count or ask | the same path as `readQuery` | capability, then the store's `QueryAccess` rule as the person |
| `create`, `update`, `delete` — a DSL-JSON mutation | the same paths as the generic plane; SHACL validates | capability per shape touched, then `QueryAccess` |
| `call` — a declared provider method on a shape | the provider's `@callable('signed-in')` method | capability covers `Call` on that callable; the method must also be opened to agents (3.4) |
| host tools — anything the shapes can't express | the host's handler | the capability the tool declares |

A query that touches several shapes must be covered for every one of them, the same rule `QueryAccess` already applies to stores.

### 3.3 The agent acts as its person, and never more

- Each call runs in a call context for the **person** the connection belongs to, marked as made through a connection. `requireSessionUser()` returns the person, so every existing access rule applies unchanged. Providers can see that an agent is acting and which one.
- The effective capability is the intersection of every layer (the person's own rights are enforced by the existing rules; the other layers are declarations).
- A refusal is a result that names the missing capability and the layer that withheld it, from the vocabulary's labels.
- Every call re-reads the connection by its key and re-evaluates; nothing is cached across calls. Stateless Streamable HTTP.

### 3.4 Opening things to agents is a declaration

Nothing is open by default.
- A shape is opened by a capability that names it (Turtle).
- A provider method is opened by declaring it beside its `@callable`, with the description and input schema an agent needs:

```ts
@callable('signed-in')
@agentCallable({ title: 'Send a message', input: z.object({ subject: z.string(), body: z.string() }) })
sendMessage(person: Person, subject: string, body: string) { … }
```

`agentCallable` / `declareAgentCallable` live in `mcp` (a small, import-light module like `callable`). A method without `@callable('signed-in')` can't be opened.

### 3.5 Connections

- `Connection` shape: person, name, maker and transport as the agent reports them, scope (IRIs of where it may work), grants (capability IRIs), host settings (opaque JSON), key hash, key hint, timestamps.
- The key: random, shown once, stored only as SHA-256, found by hash, dead on disconnect. `Authorization: Bearer`.
- Components, driven by the declarations and the shape: `ConnectionConsent` (where, what, approve) and `ConnectionList` (each connection, edit, disconnect), on `@_linked/primitives`, styled by the host's tokens.

### 3.6 A host that must not let agents write directly

A host can leave `create`/`update`/`delete` uncovered for some shapes and offer its own tool instead (for example "propose a change", which waits for a person). That is host policy expressed in declarations; the package needs no special case.

## 4. Contracts (sketch)

```ts
// mcp, root entry: no core, no server
export function readDeclarations(input: { declared: string; extensions?: { name: string; turtle: string }[] }): Declarations;
export function evaluate(grants: Grants, needs: Need[], d: Declarations): Verdict;   // Need = { kind, shape? , callable?, operation? }
export function needsOfQuery(dslJson: unknown, catalog: ShapeCatalog): Need[];      // every shape a query reads or writes

// mcp/backend
export interface McpHost {
  declarations: Declarations;
  catalogFor(connection: ConnectionRecord, place?: string): Promise<ShapeCatalog>;
  grantsFor(connection: ConnectionRecord, place?: string): Promise<Grants>;          // the non-person layers
  tools?: readonly HostTool<any>[];
  rateLimit?: { perMinute: number };
  onCall?(e: CallEvent): void; onRefusal?(e: RefusalEvent): void;
}
export function createMcpProvider(host: McpHost, options?: { path?: string }): typeof BackendProvider;
```

## 5. What this needs from linked-fw

Checked against `main` on 2026-11-17 (server-utils 1.17.0, server 3.14.1). Two of the three things first listed are already exported:
- the query plane's functions (`@_linked/server/utils/queryPlane`: `resolveQueryCatalog`, `toReadQuery`, `toQueryBuilder`, `lowerForAccessCheck`, `authorizeGenericQuery`);
- the shape walk (`@_linked/server-utils/utils/QueryAccess`: `collectQueryTargets`, `checkQueryAccess`).

**One real gap: a call context for delegated calls.** `checkQueryAccess` trusts any call that is not `http`, so a query run for an agent outside a request would skip every store rule. Planned as its own change in linked-fw: `server-utils/docs/plans/001-delegated-call-context.md` on branch `delegated-call-context` (server-utils, with a small follow-up in server). This package depends on it and has no fallback worth shipping.

## 6. Pitfalls

- A hosted model connector can't reach a local server; the live check runs a local MCP client driven by the ordinary API.
- DSL-JSON is powerful; a query's cost needs a bound (limit required on selects, a depth cap) before it is run for an agent.
- `QueryAccess` calls itself an interim model. The package depends only on "run this query as this person under the store's rule", not on how rules are written.
- The package name and base decide shape IRIs; fixed at scaffold, changed only with a migration.
- A catalog per request: a host with several scopes must resolve the catalog for the place the call names, never a global one.

## 7. Architecture compliance

- `core` `docs/architecture/runtime-instances.md` (shape catalogs): queries are built inside the request's catalog; the wire never carries one.
- `server` `docs/architecture/01-server-only-surface.md`: server code under `backend/`; the root entry imports no server code.
- `cli` package kinds: one ontology package and one asset package; the ontology is Turtle with generated accessors (`linked generate-ontology`).
- `server-utils` callable rules: nothing undeclared becomes reachable; `agentCallable` only narrows.
- No change to an existing architecture doc is proposed; §5 lists the three extensions it asks for.

## 8. Test strategy

- **Packages:** `mcp-ont`, `mcp`.
- **Quick gate, each phase, under a minute:** `npm run typecheck && npm test` in the package changed.
- **Covers:**
  - the vocabulary loading;
  - `needsOfQuery` on selects with traversals and on each mutation;
  - the evaluator and refusals;
  - keys;
  - the endpoint over real HTTP with the MCP SDK's client against an in-memory store and two test shapes: `shapes` lists only opened shapes; `read` returns rows and is refused for an unopened shape; `update` is validated by SHACL; `call` runs an opened callable as the person; a disconnect stops the next call.
- **Deferred to review:** the live check with a real model; the consent components in a browser.

## 9. Decisions for Carlen

1. ~~Centre~~ **Decided (Carlen, 2026-11-17, "build now"):** shapes, DSL-JSON queries and declared callables are the agent's tools; host tools are the exception.
2. ~~Package names~~ **Decided (Carlen, 2026-11-17): `@linked.cm/mcp-ont` + `@linked.cm/mcp`**, the ontology/code split linked-fw now uses, named like `notifications-ont` + `notifications`. Scaffold: `linked create-ont-package @linked.cm/mcp` for the vocabulary; `linked create-asset-package` for the code, renamed from `mcp-assets` to `mcp` and keeping `"linked": {"kind": "assets"}`.
3. ~~The linked-fw requests~~ **Decided (Carlen, 2026-11-17): proper PRs.** Only one is needed (§5); it is planned in linked-fw.
4. ~~Components~~ **Decided:** after the endpoint works (a later phase).
5. ~~Host records~~ **Decided:** a host moves its connection records onto the package's `Connection` shape when it adopts the package.

## 10. Phases

Built locally against the linked-fw branch `delegated-call-context` (server-utils, server), "as if approved"; a change René asks for is a refactor. One commit per phase per repository. Quick gate everywhere: `npm run typecheck && npm test`.

1. ✅ **Scaffold** (both repos) — done. Deviation: the CLI wrote a scoped name (`@linked.cm/mcp`) into one folder named `linked` (both packages in it, the ontology named `linked`); scaffolded with the bare name `mcp` and scoped after. The server-utils branch is installed from a packed tarball (`npm install --no-save`), so one `@_linked/core` is loaded: `linked create-package @linked.cm/mcp --kind both --skip-install` in `/Volumes/LIGHT/linked-cm/main`; rename `mcp-assets` to `mcp` (keeping `"linked": {"kind": "assets"}`); AGENTS.md, README, LICENSE (MIT), changesets, vitest; `git init`; install; this plan moves to `mcp/docs/plans/001-linked-mcp.md`.
   - **Validation:** each repo typechecks and runs one test; the name grep for any app prints nothing; no remote.
2. ✅ **mcp-ont: the vocabulary** — done (38 terms, 6 tests). An ontology package holds no shapes, so the SHACL that checks declarations moves to `mcp` (phase 3). Turtle for Connection, Capability (with `onShape`, `onCallable`, `coversOperation` and the kinds Read/Create/Update/Delete/Call), Layer, Preset and the refusal reasons; generated accessors.
   - **Validation:** the Turtle parses; every term the code names exists; every refusal reason has an English label.
3. ✅ **mcp: declarations, evaluator, needs** — done (18 tests; adversarial probe: a query whose walk finds no shape is refused, with a paired control that fails without the guard). Deviation: declarations are checked in code, not SHACL — linked-fw has no SHACL checker to share yet (`@linked.cm/interaction` carries its own); they move to shapes when one exists. `needsOfQuery` lives in `./backend` (it uses the server's query plane). `readDeclarations`, `evaluate`, `refusalText`, and `needsOfQuery` (lowering a DSL-JSON query inside a catalog and walking it with `collectQueryTargets`).
   - **Validation:** intersection and refusals; `needsOfQuery` on a select with a traversal names both shapes; on a create, update and delete names the written shape and the kind.
4. ✅ **mcp: Connection shape and keys** — done (8 tests on core's `InMemoryDataset`, with a control that the store dump holds the fingerprint and never the key). Deviation: the store module is `./backend/connections` (it needs `node:crypto`), not `./storage`; the shape was created with `linked create-shape` (file `src/shapes/connection.ts`).
   - **Validation:** issued once, only the hash stored, found by hash, nothing after disconnect, one person's only.
5. ✅ **mcp: the endpoint** (`./backend`) — done (38 tests in all; over real HTTP with the SDK's client on core's `InMemoryDataset`). Deviations: (a) the SDK's low-level `Server` with JSON-Schema tool inputs, not its zod `McpServer` — Linked describes shapes as data; (b) callables opened by the host as a list (`McpHost.callables`), the `@agentCallable` decorator later; (c) over-limit is a tool refusal (`rate-limited`), not HTTP 429, so the agent reads why; (d) reads are capped at `readLimit` rows (default 100). Tools `shapes`, `read`, `create`, `update`, `delete`, `call` and host tools; each call under `runAsDelegate`, through the query plane's own decode and authorize; stateless Streamable HTTP.
   - **Validation:** over real HTTP with the SDK's client and an in-memory store with two shapes:
     - only opened shapes are listed;
     - a read returns rows;
     - an unopened shape is refused by name;
     - a store rule refuses a delegated write (control: the person's own request);
     - a call runs as the person;
     - a disconnect stops the next call;
     - no route is left after dispose.
6. ✅ **Live check** — built, waiting for the key: `npm run live-check` (`tests/live/live-check.live.ts`, its own vitest config). A real `claude-opus-5-5` (server-side fallbacks on, effort medium) drives the endpoint through the SDK's manual tool loop with a read-only connection; it passes when the read succeeds, the write is refused by name and nothing is written. Without `.env.local` it fails naming the file. Adds `@anthropic-ai/sdk` as a dev dependency.
7. ✅ **Places** (added 2026-11-17, from the first host). A host with more than one place (projects, apps …) needs each call to say where it works, and to be decided and run there. Three `McpHost` seams (41 tests in all):
   - `placeInput`: a JSON Schema added to every tool's input as `place` (required when the host says so; a call without it is `bad-input`, before anything runs);
   - `grantsFor(connection, call)`: a host layer may grant differently per place, which is how a host restricts what agents may do with data there;
   - `within(connection, call, run)`: runs the call where it works (the host's data routing), inside the delegated context, around the access check and the store. `catalogFor` also gets the call.
   - **Validation (`tests/place.test.ts`):** every tool asks for `place`; a create runs in its place as the person's delegate; the same create in a place whose layer withholds writing is refused by name and never runs; a place outside the scope is `out-of-scope`; a call without a place runs nothing.

