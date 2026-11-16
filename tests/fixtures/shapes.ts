// Two small shapes for the tests: a note that may sit in a folder.
import { Shape } from '@_linked/core/shapes/Shape';
import { literalProperty, objectProperty } from '@_linked/core/shapes/SHACL';
import { linkedPackage } from '@_linked/core/utils/Package';

const { linkedShape } = linkedPackage('mcp-test-fixtures');
export const NS = 'https://example.org/mcp-test/';

@linkedShape({ name: 'Folder' })
export class Folder extends Shape {
  static targetClass = { id: NS + 'Folder' };
  @literalProperty({ path: { id: NS + 'title' }, maxCount: 1 })
  get title(): string {
    return '';
  }
}

@linkedShape({ name: 'Note' })
export class Note extends Shape {
  static targetClass = { id: NS + 'Note' };
  @literalProperty({ path: { id: NS + 'text' }, maxCount: 1 })
  get text(): string {
    return '';
  }
  @objectProperty({ path: { id: NS + 'folder' }, shape: Folder, maxCount: 1 })
  get folder(): Folder {
    return null as any;
  }
}

export const NOTE = (Note as any).shape.id as string;
export const FOLDER = (Folder as any).shape.id as string;

/** Capabilities over the fixtures, as an app would declare them. */
export const appTurtle = `
@prefix mcp: <https://linked.cm/ont/mcp/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix app: <https://example.org/app/> .

app:read-notes a mcp:Capability ; mcp:order 1 ; rdfs:label "Read notes"@en ;
  mcp:actionPhrase "read notes"@en ; mcp:kind mcp:Read ; mcp:onShape <${NOTE}>, <${FOLDER}> .
app:write-notes a mcp:Capability ; mcp:order 2 ; rdfs:label "Write notes"@en ;
  mcp:actionPhrase "write notes"@en ; mcp:kind mcp:Create, mcp:Update ; mcp:onShape <${NOTE}> .
app:delete-notes a mcp:Capability ; mcp:order 3 ; rdfs:label "Delete notes"@en ;
  mcp:actionPhrase "delete notes"@en ; mcp:kind mcp:Delete ; mcp:onShape <${NOTE}> .
app:archive a mcp:Capability ; mcp:order 4 ; rdfs:label "Archive a note"@en ;
  mcp:actionPhrase "archive notes"@en ; mcp:kind mcp:Call ; mcp:onCallable "${NOTE}#archive" .

app:workspace a mcp:Layer ; mcp:order "10"^^xsd:integer ; rdfs:label "Your workspace"@en .
app:reader a mcp:Preset ; rdfs:label "Reader"@en ; mcp:grantsCapability app:read-notes .
`;
export const APP = 'https://example.org/app/';
