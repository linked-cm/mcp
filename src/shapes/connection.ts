import { Shape } from '@_linked/core/shapes/Shape';
import { literalProperty, objectProperty } from '@_linked/core/shapes/SHACL';
import * as mcp from '@linked.cm/mcp-ont/ontologies/mcp';
import { linkedShape } from '../package.js';

const XSD_DATETIME = { id: 'http://www.w3.org/2001/XMLSchema#dateTime' };

/**
 * One agent connected by one person (`mcp:Connection`). The agent acts as its
 * person, within the capabilities the connection grants. Its key is shown once
 * when the connection is issued and only its SHA-256 is kept; from
 * `disconnectedAt` on, the key finds nothing.
 */
@linkedShape
export class Connection extends Shape {
  static targetClass = mcp.Connection;

  /** The person the agent acts for. */
  @objectProperty({ path: mcp.person, maxCount: 1, required: true })
  get person(): Shape {
    return null as any;
  }

  /** The agent's name, as the agent reports it. */
  @literalProperty({ path: mcp.agentName, maxCount: 1, required: true })
  get agentName(): string {
    return '';
  }

  /** Who made the agent, as the agent reports it. */
  @literalProperty({ path: mcp.maker, maxCount: 1 })
  get maker(): string {
    return '';
  }

  /** How the agent connects. */
  @literalProperty({ path: mcp.via, maxCount: 1 })
  get via(): string {
    return '';
  }

  /** Where it may work (IRIs; the app gives them meaning). */
  @literalProperty({ path: mcp.scope })
  get scope(): string[] {
    return [];
  }

  /** The capabilities its person gave it (IRIs). */
  @literalProperty({ path: mcp.grants })
  get grants(): string[] {
    return [];
  }

  /** The app's own settings for it, as JSON. */
  @literalProperty({ path: mcp.settings, maxCount: 1 })
  get settings(): string {
    return '';
  }

  /** The SHA-256 of its key. */
  @literalProperty({ path: mcp.keyHash, maxCount: 1, required: true })
  get keyHash(): string {
    return '';
  }

  /** The last characters of its key. */
  @literalProperty({ path: mcp.keyHint, maxCount: 1 })
  get keyHint(): string {
    return '';
  }

  @literalProperty({ path: mcp.connectedAt, datatype: XSD_DATETIME, maxCount: 1 })
  get connectedAt(): Date {
    return null as any;
  }

  @literalProperty({ path: mcp.lastActedAt, datatype: XSD_DATETIME, maxCount: 1 })
  get lastActedAt(): Date {
    return null as any;
  }

  @literalProperty({ path: mcp.disconnectedAt, datatype: XSD_DATETIME, maxCount: 1 })
  get disconnectedAt(): Date {
    return null as any;
  }
}
