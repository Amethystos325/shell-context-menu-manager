export type NodeKind =
  | "import"
  | "menu"
  | "item"
  | "separator"
  | "modify"
  | "remove";

export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export type AttributeValueKind = "string" | "number" | "boolean" | "identifier" | "expression";

export interface AttributeValue {
  raw: string;
  kind: AttributeValueKind;
  value: string | number | boolean;
}

export interface Attribute {
  key: string;
  value: AttributeValue;
  range: SourceRange;
}

export interface BaseNode {
  id: string;
  kind: NodeKind;
  range: SourceRange;
}

export interface ImportNode extends BaseNode {
  kind: "import";
  path: string;
}

export interface MenuNode extends BaseNode {
  kind: "menu";
  attributes: Attribute[];
  children: ConfigNode[];
}

export interface ItemNode extends BaseNode {
  kind: "item";
  attributes: Attribute[];
}

export interface SeparatorNode extends BaseNode {
  kind: "separator";
}

export interface ModifyNode extends BaseNode {
  kind: "modify";
  attributes: Attribute[];
}

export interface RemoveNode extends BaseNode {
  kind: "remove";
  attributes: Attribute[];
}

export type ConfigNode = ImportNode | MenuNode | ItemNode | SeparatorNode | ModifyNode | RemoveNode;

export interface ConfigDocument {
  nodes: ConfigNode[];
}

export interface ParseIssue {
  code: "E_PARSE";
  message: string;
  range: SourceRange;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  nodeId?: string;
  range?: SourceRange;
}
