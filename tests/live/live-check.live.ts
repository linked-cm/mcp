// The live check: a real Claude model, connected through this package's MCP endpoint, is asked
// to read a note and then change it. Its connection may only read. It passes when the model's
// read succeeds and its write comes back as a named refusal — and nothing was written.
//
// The key is read from `.env.local` (ANTHROPIC_API_KEY=…) into this process only; it is never
// printed. Run: `npm run live-check`.
import { readFileSync, existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LinkedStorage } from '@_linked/core/utils/LinkedStorage';
import { InMemoryDataset } from '@_linked/core/memory/InMemoryDataset';
import { readDeclarations } from '../../src/declarations';
import { createMcpProvider, issueConnection } from '../../src/backend/index';
import { appTurtle, APP, Note, NOTE } from '../fixtures/shapes';
import '../../src/shapes/index';

const ENV_FILE = new URL('../../.env.local', import.meta.url);

function apiKey(): string {
  if (!existsSync(ENV_FILE))
    throw new Error(`No key: create ${ENV_FILE.pathname} with one line, ANTHROPIC_API_KEY=… (it is git-ignored).`);
  const line = readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).find((l) => /^\s*ANTHROPIC_API_KEY\s*=/.test(l));
  const value = line?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  if (!value) throw new Error(`No ANTHROPIC_API_KEY line in ${ENV_FILE.pathname}.`);
  return value;
}

describe('a real model through the MCP endpoint', () => {
  it('reads what it may, and is refused by name what it may not', async () => {
    const anthropic = new Anthropic({ apiKey: apiKey() });

    // The app: notes in memory, one note, and capabilities as an app would declare them.
    const store = new InMemoryDataset();
    LinkedStorage.setDefaultDataset(store as any);
    await Note.create({ __id: 'https://example.org/note/1', text: 'Buy seed trays' } as any);
    const vocabulary = readFileSync(new URL('../../../mcp-ont/src/data/mcp.ttl', import.meta.url), 'utf8');
    const declarations = readDeclarations({ vocabulary, declared: [{ name: 'app', turtle: appTurtle }] });
    const app = express();
    app.use(express.json());
    const Provider = createMcpProvider({
      declarations,
      grantsFor: async () => ({ [APP + 'workspace']: new Set([APP + 'read-notes', APP + 'write-notes']) }),
      accountOf: async (person) => ({ id: person }),
      nameOf: (iri) => (iri === NOTE ? 'notes' : undefined),
    });
    new (Provider as any)(app, {}).setupBeforeControllers();
    const server: any = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      // The connection may only read.
      const { key } = await issueConnection(
        { person: 'https://example.org/person/ada', agentName: 'Claude', maker: 'Anthropic', via: 'mcp', scope: [], grants: [APP + 'read-notes'] },
        { dataRoot: 'https://example.org/data/' }
      );
      const mcp = new Client({ name: 'live-check', version: '0.0.0' });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${key}` } },
        })
      );
      const { tools } = await mcp.listTools();
      const claudeTools: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description ?? t.title ?? t.name,
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      }));

      const calls: { name: string; input: unknown; refused: boolean; text: string }[] = [];
      const messages: Anthropic.Beta.BetaMessageParam[] = [
        {
          role: 'user',
          content:
            'You are connected to an app through these tools. ' +
            'First call `shapes`, then read the text of every note, then change the note\'s text to "Buy seed trays and pots". ' +
            'Finish by saying in one sentence what you read and whether the change was made.',
        },
      ];
      for (let turn = 0; turn < 10; turn++) {
        const response = await anthropic.beta.messages.create({
          model: 'claude-opus-5-5',
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          tools: claudeTools,
          messages,
        });
        if (response.stop_reason === 'refusal') throw new Error(`The model declined: ${JSON.stringify(response.stop_details)}`);
        messages.push({ role: 'assistant', content: response.content as any });
        if (response.stop_reason !== 'tool_use') {
          const said = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ');
          console.log(`[live-check] the model said: ${said}`);
          break;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content as any[]) {
          if (block.type !== 'tool_use') continue;
          const result: any = await mcp.callTool({ name: block.name, arguments: block.input });
          const text = result.content?.[0]?.text ?? '';
          const refused = !!result.structuredContent?.refused;
          calls.push({ name: block.name, input: block.input, refused, text });
          console.log(`[live-check] ${block.name}${refused ? ' REFUSED' : ''}: ${text.slice(0, 200)}`);
          if (refused) console.log(`[live-check]   it sent: ${JSON.stringify(block.input).slice(0, 400)}`);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: text });
        }
        messages.push({ role: 'user', content: results });
      }

      // The read succeeded and returned the note.
      expect(calls.some((c) => c.name === 'read' && !c.refused && c.text.includes('Buy seed trays'))).toBe(true);
      // The write was refused by name, and nothing changed.
      const writes = calls.filter((c) => c.name === 'update' || c.name === 'create');
      expect(writes.length).toBeGreaterThan(0);
      // Every write is refused; the one it got right is refused by name (a malformed one is bad input).
      expect(writes.every((c) => c.refused)).toBe(true);
      expect(writes.some((c) => /doesn't allow agents to write notes/.test(c.text))).toBe(true);
      expect((await Note.select((n: any) => n.text)).map((r: any) => r.text)).toEqual(['Buy seed trays']);
    } finally {
      server.close();
    }
  });
});
