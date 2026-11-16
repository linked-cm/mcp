---
"@linked.cm/mcp": minor
---

The MCP endpoint (`createMcpProvider`, `@linked.cm/mcp/backend`): stateless Streamable HTTP; a connection's key on every request; tools `shapes`, `read`, `create`, `update`, `delete` (DSL-JSON through the server's query plane), `call` (methods the app opens) and the app's own tools. Every request is decided against what every layer grants, then run as the person in a delegated call context, so the app's access rules apply as to the person. Refusals are results that name what is missing and who withheld it.
