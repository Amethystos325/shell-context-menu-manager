import type {
  Attribute,
  AttributeValue,
  ConfigDocument,
  ConfigNode,
  ImportNode,
  RawNode,
  SourcePosition,
  SourceRange,
} from "./types.js";

const IDENTIFIER_RE = /^[A-Za-z_@][A-Za-z0-9_.@-]*$/;

class ParseError extends Error {
  public readonly range: SourceRange;

  constructor(message: string, range: SourceRange) {
    super(message);
    this.name = "ParseError";
    this.range = range;
  }
}

class Parser {
  private readonly text: string;
  private index = 0;
  private line = 1;
  private column = 1;
  private nodeCounter = 0;

  constructor(text: string) {
    this.text = text;
  }

  public parse(): ConfigDocument {
    const nodes: ConfigNode[] = [];
    this.skipWhitespaceAndComments();

    while (!this.isAtEnd()) {
      nodes.push(this.parseStatement());
      this.skipTrailingSeparators();
    }

    return { nodes };
  }

  private parseStatement(): ConfigNode {
    const start = this.getPosition();

    if (this.peek() === "$" || this.peek() === "@") {
      this.consumeToStatementEnd();
      return this.createRawNode(start);
    }

    const keyword = this.parseIdentifier("Expected statement keyword.");

    if (keyword === "import") {
      return this.parseImport(start);
    }

    if (keyword === "menu") {
      return this.parseMenu(start);
    }

    if (keyword === "item") {
      return this.parseFlatNode(start, "item");
    }

    if (keyword === "separator") {
      const attributes = this.parseOptionalAttributes();
      return this.createNode(start, "separator", { attributes });
    }

    if (keyword === "modify") {
      return this.parseFlatNode(start, "modify");
    }

    if (keyword === "remove") {
      return this.parseFlatNode(start, "remove");
    }

    this.skipWhitespaceAndComments();
    this.consumeToStatementEnd();
    return this.createRawNode(start);
  }

  private parseImport(start: SourcePosition): ImportNode {
    this.skipWhitespaceAndComments();
    let path = "";
    let section: string | undefined;

    if (this.peek() === '"' || this.peek() === "'") {
      const parsed = this.parseStringLiteral();
      path = parsed.value;
    } else {
      const first = this.parseBareToken();
      this.skipWhitespaceAndComments();
      if (this.peek() === '"' || this.peek() === "'") {
        section = first;
        const parsed = this.parseStringLiteral();
        path = parsed.value;
      } else {
        path = first;
      }
    }

    if (!path.trim()) {
      throw this.errorAtCurrent("Import path cannot be empty.");
    }

    return this.createNode(start, "import", { path, section });
  }

  private parseMenu(start: SourcePosition): ConfigNode {
    const attributes = this.parseOptionalAttributes();
    this.skipWhitespaceAndComments();

    this.expectChar("{", "Expected '{' after menu declaration.");
    this.skipWhitespaceAndComments();

    const children: ConfigNode[] = [];
    while (!this.isAtEnd() && this.peek() !== "}") {
      children.push(this.parseStatement());
      this.skipTrailingSeparators();
    }

    this.expectChar("}", "Expected '}' to close menu block.");

    return this.createNode(start, "menu", { attributes, children });
  }

  private parseFlatNode(start: SourcePosition, kind: "item" | "modify" | "remove"): ConfigNode {
    const attributes = this.parseOptionalAttributes();
    return this.createNode(start, kind, { attributes });
  }

  private parseOptionalAttributes(): Attribute[] {
    this.skipWhitespaceAndComments();
    if (this.peek() !== "(") {
      return [];
    }
    return this.parseAttributes();
  }

  private parseAttributes(): Attribute[] {
    const attributes: Attribute[] = [];
    this.expectChar("(", "Expected '(' to start attributes.");
    this.skipWhitespaceAndComments();

    while (!this.isAtEnd() && this.peek() !== ")") {
      const keyStart = this.getPosition();
      const key = this.parseIdentifier("Expected attribute key.");
      this.skipWhitespaceAndComments();
      this.expectChar("=", "Expected '=' after attribute key.");
      this.skipWhitespaceAndComments();

      const value = this.parseAttributeValue();
      const attrEnd = this.getPosition();
      attributes.push({
        key,
        value,
        range: this.createRange(keyStart, attrEnd),
      });

      this.skipWhitespaceAndComments();
      if (this.peek() === ",") {
        this.advance();
        this.skipWhitespaceAndComments();
      } else if (this.peek() === ")") {
        break;
      } else if (this.isAttributeKeyStart(this.peek())) {
        // Nilesoft Shell also supports space-separated attributes.
        continue;
      } else {
        throw this.errorAtCurrent("Expected ',' or ')' after attribute value.");
      }
    }

    this.expectChar(")", "Expected ')' to close attributes.");
    return attributes;
  }

  private parseAttributeValue(): AttributeValue {
    const raw = this.parseRawExpression({ stopOnAttributeBoundary: true });
    const parsedString = this.tryParseQuotedLiteral(raw);
    if (parsedString) {
      return {
        raw,
        kind: "string",
        value: parsedString,
      };
    }

    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      return {
        raw,
        kind: "number",
        value: Number(raw),
      };
    }

    if (/^(true|false)$/i.test(raw)) {
      return {
        raw,
        kind: "boolean",
        value: /^true$/i.test(raw),
      };
    }

    if (IDENTIFIER_RE.test(raw)) {
      return {
        raw,
        kind: "identifier",
        value: raw,
      };
    }

    return {
      raw,
      kind: "expression",
      value: raw,
    };
  }

  private parseRawExpression(options: { stopOnAttributeBoundary?: boolean } = {}): string {
    const start = this.getPosition();
    const valueStart = this.index;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        this.advance();
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        this.advance();
        continue;
      }

      if (ch === "(") {
        parenDepth += 1;
        this.advance();
        continue;
      }

      if (ch === ")") {
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          break;
        }
        if (parenDepth === 0) {
          throw this.errorAtCurrent("Unexpected ')' in attribute value.");
        }
        parenDepth -= 1;
        this.advance();
        continue;
      }

      if (ch === "[") {
        bracketDepth += 1;
        this.advance();
        continue;
      }

      if (ch === "]") {
        if (bracketDepth === 0) {
          throw this.errorAtCurrent("Unexpected ']' in attribute value.");
        }
        bracketDepth -= 1;
        this.advance();
        continue;
      }

      if (ch === "{") {
        braceDepth += 1;
        this.advance();
        continue;
      }

      if (ch === "}") {
        if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
          break;
        }
        if (braceDepth === 0) {
          throw this.errorAtCurrent("Unexpected '}' in attribute value.");
        }
        braceDepth -= 1;
        this.advance();
        continue;
      }

      if (ch === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        break;
      }

      if (
        options.stopOnAttributeBoundary &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0 &&
        /\s/.test(ch)
      ) {
        const boundaryIndex = this.findNextNonWhitespaceIndex(this.index);
        if (this.isAttributeBoundaryAt(boundaryIndex)) {
          break;
        }
      }

      this.advance();
    }

    if (quote || parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) {
      throw this.errorAtPosition("Unclosed expression in attribute value.", start);
    }

    const raw = this.text.slice(valueStart, this.index).trim();
    if (!raw) {
      throw this.errorAtPosition("Attribute value cannot be empty.", start);
    }

    return raw;
  }

  private consumeToStatementEnd(): void {
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    while (!this.isAtEnd()) {
      const ch = this.peek();

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === quote) {
          quote = null;
        }
        this.advance();
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        this.advance();
        continue;
      }

      if (ch === "(") {
        parenDepth += 1;
        this.advance();
        continue;
      }

      if (ch === ")") {
        if (parenDepth > 0) {
          parenDepth -= 1;
          this.advance();
          continue;
        }
        if (bracketDepth === 0 && braceDepth === 0) {
          break;
        }
        this.advance();
        continue;
      }

      if (ch === "[") {
        bracketDepth += 1;
        this.advance();
        continue;
      }

      if (ch === "]") {
        if (bracketDepth > 0) {
          bracketDepth -= 1;
          this.advance();
          continue;
        }
        break;
      }

      if (ch === "{") {
        braceDepth += 1;
        this.advance();
        continue;
      }

      if (ch === "}") {
        if (braceDepth > 0) {
          braceDepth -= 1;
          this.advance();
          continue;
        }
        if (parenDepth === 0 && bracketDepth === 0) {
          break;
        }
        this.advance();
        continue;
      }

      if (ch === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        this.advance();
        break;
      }

      if ((ch === "\n" || ch === "\r") && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        break;
      }

      this.advance();
    }
  }

  private parseStringLiteral(): { raw: string; value: string } {
    const quote = this.peek() as '"' | "'";
    const startIndex = this.index;
    this.advance();
    let escaped = false;

    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        this.advance();
        const raw = this.text.slice(startIndex, this.index);
        return {
          raw,
          value: this.decodeString(raw, quote),
        };
      }
      this.advance();
    }

    throw this.errorAtCurrent("Unclosed string literal.");
  }

  private decodeString(raw: string, quote: '"' | "'"): string {
    if (quote === '"') {
      return JSON.parse(raw);
    }

    const body = raw.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return JSON.parse(`"${body}"`);
  }

  private parseIdentifier(message: string): string {
    const start = this.index;
    if (this.isAtEnd()) {
      throw this.errorAtCurrent(message);
    }

    const first = this.peek();
    if (!/[A-Za-z_@]/.test(first)) {
      throw this.errorAtCurrent(message);
    }

    this.advance();
    while (!this.isAtEnd() && /[A-Za-z0-9_.@-]/.test(this.peek())) {
      this.advance();
    }

    return this.text.slice(start, this.index);
  }

  private parseBareToken(): string {
    const start = this.index;
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (/\s/.test(ch) || ch === ";" || ch === "\n" || ch === "\r") {
        break;
      }
      this.advance();
    }

    const token = this.text.slice(start, this.index).trim();
    if (!token) {
      throw this.errorAtCurrent("Expected token.");
    }
    return token;
  }

  private tryParseQuotedLiteral(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length < 2) {
      return null;
    }

    const quote = trimmed[0];
    if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
      return null;
    }

    try {
      return this.decodeString(trimmed, quote);
    } catch {
      return null;
    }
  }

  private isAttributeKeyStart(ch: string): boolean {
    return /[A-Za-z_@]/.test(ch);
  }

  private findNextNonWhitespaceIndex(fromIndex: number): number {
    let cursor = fromIndex;
    while (cursor < this.text.length) {
      const ch = this.text[cursor];
      const next = this.text[cursor + 1] ?? "";

      if (/\s/.test(ch)) {
        cursor += 1;
        continue;
      }

      if (ch === "/" && next === "/") {
        cursor += 2;
        while (cursor < this.text.length && this.text[cursor] !== "\n") {
          cursor += 1;
        }
        continue;
      }

      if (ch === "/" && next === "*") {
        cursor += 2;
        while (cursor < this.text.length && !(this.text[cursor] === "*" && this.text[cursor + 1] === "/")) {
          cursor += 1;
        }
        cursor += 2;
        continue;
      }

      break;
    }

    return cursor;
  }

  private isAttributeBoundaryAt(index: number): boolean {
    if (index >= this.text.length) {
      return false;
    }

    const first = this.text[index];
    if (!this.isAttributeKeyStart(first)) {
      return false;
    }

    let cursor = index + 1;
    while (cursor < this.text.length && /[A-Za-z0-9_.@-]/.test(this.text[cursor])) {
      cursor += 1;
    }

    cursor = this.findNextNonWhitespaceIndex(cursor);
    return this.text[cursor] === "=";
  }

  private skipTrailingSeparators(): void {
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments();
      if (this.peek() === ";") {
        this.advance();
        continue;
      }
      break;
    }
    this.skipWhitespaceAndComments();
  }

  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (/\s/.test(ch)) {
        this.advance();
        continue;
      }

      if (ch === "/" && this.peekNext() === "/") {
        while (!this.isAtEnd() && this.peek() !== "\n") {
          this.advance();
        }
        continue;
      }

      if (ch === "/" && this.peekNext() === "*") {
        this.advance(2);
        while (!this.isAtEnd() && !(this.peek() === "*" && this.peekNext() === "/")) {
          this.advance();
        }
        if (this.isAtEnd()) {
          throw this.errorAtCurrent("Unclosed block comment.");
        }
        this.advance(2);
        continue;
      }

      break;
    }
  }

  private expectChar(expected: string, message: string): void {
    if (this.peek() !== expected) {
      throw this.errorAtCurrent(message);
    }
    this.advance();
  }

  private createNode<TKind extends ConfigNode["kind"], TExtra extends object>(
    start: SourcePosition,
    kind: TKind,
    extra: TExtra,
  ): Extract<ConfigNode, { kind: TKind }> {
    const node = {
      id: `${kind}_${++this.nodeCounter}`,
      kind,
      range: this.createRange(start, this.getPosition()),
      ...extra,
    };

    return node as unknown as Extract<ConfigNode, { kind: TKind }>;
  }

  private createRawNode(start: SourcePosition): RawNode {
    const text = this.text.slice(start.offset, this.index).trim();
    return this.createNode(start, "raw", {
      text,
    });
  }

  private createRange(start: SourcePosition, end: SourcePosition): SourceRange {
    return { start, end };
  }

  private errorAtCurrent(message: string): ParseError {
    const position = this.getPosition();
    return new ParseError(message, this.createRange(position, position));
  }

  private errorAtPosition(message: string, position: SourcePosition): ParseError {
    return new ParseError(message, this.createRange(position, this.getPosition()));
  }

  private getPosition(): SourcePosition {
    return {
      offset: this.index,
      line: this.line,
      column: this.column,
    };
  }

  private isAtEnd(): boolean {
    return this.index >= this.text.length;
  }

  private peek(): string {
    return this.text[this.index] ?? "";
  }

  private peekNext(): string {
    return this.text[this.index + 1] ?? "";
  }

  private advance(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      const ch = this.text[this.index];
      if (ch === undefined) {
        return;
      }
      this.index += 1;
      if (ch === "\n") {
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
    }
  }
}

export function parseConfig(text: string): ConfigDocument {
  const parser = new Parser(text);
  return parser.parse();
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError;
}
