# @linked.cm/mcp

Connected agents for Linked apps, over the [Model Context Protocol](https://modelcontextprotocol.io).

A shape is the one contract a Linked app's data, backend and UI bind to. This package adds agents to that list: an app that installs it lets a person connect an agent, and the agent can read, change and call **the app's own shapes**, as that person, within declared capabilities. An app that adds a shape gets an agent surface for it without writing a tool.

- **Through Linked's own paths.** Reads and writes are DSL-JSON queries through the server's query plane; calls are declared provider methods.
- **As the person.** Every call runs as the person the connection belongs to, so the app's existing access rules apply unchanged.
- **Nothing open by default.** Capabilities (Turtle, [`@linked.cm/mcp-ont`](../mcp-ont)) name the shapes and callables an agent may use; layers narrow them.
- **Refusals name what is missing** and which layer withheld it.

## Status

Staged in linked-cm (npm scope `@linked.cm`, repository [linked-cm/mcp](https://github.com/linked-cm/mcp)); it moves to linked-fw once approved. Not published to npm yet. In development it reads [`@linked.cm/mcp-ont`](https://github.com/linked-cm/mcp-ont) from a sibling checkout (`file:../mcp-ont`). Requires `@_linked/server-utils` 1.18 (the delegated call context, linked-fw/server-utils#125).

## Places

An app with more than one place (projects, apps, branches …) gives the endpoint three things:

- `placeInput`: a JSON Schema for `place`, added to every tool's input;
- `grantsFor(connection, call)`: its layers for that call, so a place can grant less (for example, to keep agents away from some data there);
- `within(connection, call, run)`: runs the call where it works, for the app's data routing.

`inScope` and `catalogFor` see the call too.

## Develop

```sh
npm install
npm run build
npm test
```

## Live check

A real Claude model, connected through the endpoint with a connection that may only read, is asked to read a note and then change it. It passes when the read succeeds and the change comes back as a named refusal, with nothing written.

```sh
echo 'ANTHROPIC_API_KEY=…' > .env.local   # git-ignored; read into the test process only, never printed
npm run live-check
```

It uses `claude-opus-5-5` with server-side fallbacks on, and costs a few cents per run. It is never part of `npm test`.

## Changelog

See `CHANGELOG.md`.
