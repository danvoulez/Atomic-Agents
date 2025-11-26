// AST types
export type LogLineValue =
  | string
  | number
  | boolean
  | LogLineReference
  | LogLineFunctionCall
  | LogLineInterpolation
  | LogLineValue[];
export type LogLineReference = { type: 'reference'; value: string };
export type LogLineFunctionCall = { type: 'function_call'; name: string; args: LogLineValue[] };
export type LogLineInterpolation = { type: 'interpolation'; base: string; key: string };
export interface LogLineSpan {
  type: string;
  name?: string;
  id?: string;
  params?: Record<string, LogLineValue>;
  template?: string;
  trace_id?: string;
  children?: LogLineSpan[];
  meta?: Record<string, any>; // preserve source format or comments
}
// Parser: from LogLine block (OPERATION, CONTEXT, etc.) to AST
export function parseLogLineBlock(text: string): LogLineSpan {
  const lines = text.trim().split('\n');
  const header = lines[0].match(/^(\w+):\s*(\w+)/);
  if (!header) throw new Error('Invalid block header');
  const [, typeRaw, name] = header;
  const type = typeRaw.toLowerCase();
  const params: Record<string, LogLineValue> = {};
  let template: string | undefined;
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line.startsWith('TEMPLATE:')) {
      template = line.split(':')[1].trim();
      continue;
    }
    const match = line.match(/^(\w+):\s+(.+)$/);
    if (match) {
      const [, key, value] = match;
      params[key.toLowerCase()] = parseValue(value);
    }
  }
  return {
    type,
    name,
    template,
    params
  };
}
// Serializer: from AST to JSON✯Atomic
export function serializeToJsonAtomic(span: LogLineSpan): string {
  return JSON.stringify(span, null, 2);
}
// Serializer: from AST to .logline format
export function serializeToLogLine(span: LogLineSpan): string {
  let out = `${span.type.toUpperCase()}: ${span.name || ''}\n`;
  if (span.template) {
    out += `  TEMPLATE: ${span.template}\n`;
  }
  if (span.params) {
    for (const [k, v] of Object.entries(span.params)) {
      out += `  ${k.toUpperCase()}: ${renderValue(v)}\n`;
    }
  }
  out += 'END';
  return out;
}
function parseValue(val: string): LogLineValue {
  val = val.trim();
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (!isNaN(Number(val))) return Number(val);
  if (/^@\w+(\.\w+)?$/.test(val)) return { type: 'reference', value: val };
  if (/^\w+\(.+\)$/.test(val)) {
    const [fname, argsRaw] = val.split(/\((.*)\)/).filter(Boolean);
    const args = argsRaw.split(',').map(s => parseValue(s.trim()));
    return { type: 'function_call', name: fname, args };
  }
  if (/^\w+\s*\{\w+\}$/.test(val)) {
    const [base, key] = val.split(/[{}]/).filter(Boolean);
    return { type: 'interpolation', base: base.trim(), key: key.trim() };
  }
  if (/^\[.*\]$/.test(val)) {
    const items = val
      .slice(1, -1)
      .split(',')
      .map(v => parseValue(v.trim()));
    return items;
  }
  return val.replace(/^"|"$/g, '');
}
function renderValue(val: LogLineValue): string {
  if (typeof val === 'string') return `"${val}"`;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return `[${val.map(renderValue).join(', ')}]`;
  if (typeof val === 'object' && 'type' in val) {
    if (val.type === 'reference') return val.value;
    if (val.type === 'function_call') return `${val.name}(${val.args.map(renderValue).join(', ')})`;
    if (val.type === 'interpolation') return `${val.base} {${val.key}}`;
  }
  return JSON.stringify(val);
}



// ============================================================================
// LogLine Parser & Serializer - Enhanced Edition
// ============================================================================

// AST Types
export type LogLineValue =
  | string
  | number
  | boolean
  | null
  | LogLineReference
  | LogLineFunctionCall
  | LogLineInterpolation
  | LogLineValue[];

export type LogLineReference = { 
  type: 'reference'; 
  value: string;
  path?: string[]; // for @entity.field.subfield -> ['entity', 'field', 'subfield']
};

export type LogLineFunctionCall = { 
  type: 'function_call'; 
  name: string; 
  args: LogLineValue[];
};

export type LogLineInterpolation = { 
  type: 'interpolation'; 
  base: string; 
  key: string;
};

export interface LogLineSpan {
  type: string;
  name?: string;
  id?: string;
  params?: Record<string, LogLineValue>;
  template?: string;
  trace_id?: string;
  parent_id?: string;
  children?: LogLineSpan[];
  meta?: Record<string, unknown>;
}

export interface ParseError {
  line: number;
  column?: number;
  message: string;
  source?: string;
}

export interface ParseResult {
  span: LogLineSpan | null;
  errors: ParseError[];
  warnings: ParseError[];
}

// ============================================================================
// Tokenizer
// ============================================================================

type TokenType = 
  | 'KEYWORD'      // OPERATION, CONTEXT, etc.
  | 'IDENTIFIER'   // names, keys
  | 'REFERENCE'    // @something
  | 'STRING'       // "quoted"
  | 'NUMBER'       // 123, 3.14
  | 'BOOLEAN'      // true, false
  | 'NULL'         // null
  | 'LPAREN'       // (
  | 'RPAREN'       // )
  | 'LBRACKET'     // [
  | 'RBRACKET'     // ]
  | 'LBRACE'       // {
  | 'RBRACE'       // }
  | 'COLON'        // :
  | 'COMMA'        // ,
  | 'NEWLINE'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

class Tokenizer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];

  constructor(private input: string) {}

  tokenize(): Token[] {
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      if (ch === '\n') {
        this.addToken('NEWLINE', '\n');
        this.pos++;
        this.line++;
        this.column = 1;
        continue;
      }

      if (ch === '#') {
        this.skipComment();
        continue;
      }

      if (ch === '"') {
        this.readString();
        continue;
      }

      if (ch === '@') {
        this.readReference();
        continue;
      }

      if (this.isDigit(ch) || (ch === '-' && this.isDigit(this.peek(1)))) {
        this.readNumber();
        continue;
      }

      if (this.isAlpha(ch)) {
        this.readIdentifier();
        continue;
      }

      // Single-character tokens
      const singles: Record<string, TokenType> = {
        '(': 'LPAREN',
        ')': 'RPAREN',
        '[': 'LBRACKET',
        ']': 'RBRACKET',
        '{': 'LBRACE',
        '}': 'RBRACE',
        ':': 'COLON',
        ',': 'COMMA',
      };

      if (singles[ch]) {
        this.addToken(singles[ch], ch);
        this.pos++;
        this.column++;
        continue;
      }

      // Unknown character - skip it
      this.pos++;
      this.column++;
    }

    this.addToken('EOF', '');
    return this.tokens;
  }

  private skipWhitespace() {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }
  }

  private skipComment() {
    while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
      this.pos++;
    }
  }

  private readString() {
    const startCol = this.column;
    this.pos++; // skip opening quote
    this.column++;

    let value = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];

      if (ch === '"') {
        this.pos++;
        this.column++;
        this.tokens.push({ type: 'STRING', value, line: this.line, column: startCol });
        return;
      }

      if (ch === '\\' && this.pos + 1 < this.input.length) {
        const next = this.input[this.pos + 1];
        const escapes: Record<string, string> = {
          'n': '\n',
          't': '\t',
          'r': '\r',
          '"': '"',
          '\\': '\\',
        };
        if (escapes[next]) {
          value += escapes[next];
          this.pos += 2;
          this.column += 2;
          continue;
        }
      }

      if (ch === '\n') {
        // Unterminated string
        this.tokens.push({ type: 'STRING', value, line: this.line, column: startCol });
        return;
      }

      value += ch;
      this.pos++;
      this.column++;
    }

    // EOF in string
    this.tokens.push({ type: 'STRING', value, line: this.line, column: startCol });
  }

  private readReference() {
    const startCol = this.column;
    let value = '@';
    this.pos++;
    this.column++;

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (this.isAlphaNumeric(ch) || ch === '.' || ch === '_') {
        value += ch;
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }

    this.tokens.push({ type: 'REFERENCE', value, line: this.line, column: startCol });
  }

  private readNumber() {
    const startCol = this.column;
    let value = '';

    if (this.input[this.pos] === '-') {
      value += '-';
      this.pos++;
      this.column++;
    }

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (this.isDigit(ch) || ch === '.') {
        value += ch;
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }

    this.tokens.push({ type: 'NUMBER', value, line: this.line, column: startCol });
  }

  private readIdentifier() {
    const startCol = this.column;
    let value = '';

    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (this.isAlphaNumeric(ch) || ch === '_' || ch === '.' || ch === '-') {
        value += ch;
        this.pos++;
        this.column++;
      } else {
        break;
      }
    }

    // Check for keywords/booleans (only exact matches, not dotted paths)
    const upper = value.toUpperCase();
    // Note: TEMPLATE is NOT a block keyword - it's a parameter
    const keywords = ['OPERATION', 'CONTEXT', 'END', 'SPAN', 'EVENT', 'TRACE', 'PACT', 'AGENT'];

    if (value === 'true' || value === 'false') {
      this.tokens.push({ type: 'BOOLEAN', value, line: this.line, column: startCol });
    } else if (value === 'null') {
      this.tokens.push({ type: 'NULL', value, line: this.line, column: startCol });
    } else if (keywords.includes(upper)) {
      this.tokens.push({ type: 'KEYWORD', value: upper, line: this.line, column: startCol });
    } else {
      this.tokens.push({ type: 'IDENTIFIER', value, line: this.line, column: startCol });
    }
  }

  private addToken(type: TokenType, value: string) {
    this.tokens.push({ type, value, line: this.line, column: this.column });
  }

  private peek(offset: number): string {
    return this.input[this.pos + offset] || '';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}

// ============================================================================
// Parser
// ============================================================================

class Parser {
  private pos = 0;
  private errors: ParseError[] = [];
  private warnings: ParseError[] = [];

  constructor(private tokens: Token[]) {}

  parse(): ParseResult {
    try {
      const span = this.parseBlock();
      return { span, errors: this.errors, warnings: this.warnings };
    } catch (e) {
      this.errors.push({
        line: this.current().line,
        column: this.current().column,
        message: e instanceof Error ? e.message : String(e),
      });
      return { span: null, errors: this.errors, warnings: this.warnings };
    }
  }

  private parseBlock(): LogLineSpan {
    this.skipNewlines();

    // Expect: KEYWORD COLON IDENTIFIER?
    const typeToken = this.expect('KEYWORD', 'Expected block type (OPERATION, CONTEXT, etc.)');
    this.expect('COLON', 'Expected colon after block type');

    let name: string | undefined;
    if (this.check('IDENTIFIER') || this.check('STRING')) {
      name = this.advance().value;
    }

    this.skipNewlines();

    const params: Record<string, LogLineValue> = {};
    let template: string | undefined;
    let id: string | undefined;
    let trace_id: string | undefined;
    let parent_id: string | undefined;
    const children: LogLineSpan[] = [];
    const meta: Record<string, unknown> = {};

    // Parse body until END or EOF
    while (!this.check('EOF') && !this.checkKeyword('END')) {
      this.skipNewlines();

      if (this.check('EOF') || this.checkKeyword('END')) break;

      // Nested block?
      if (this.check('KEYWORD') && this.peek(1)?.type === 'COLON') {
        const keyword = this.current().value;
        if (keyword !== 'END') {
          children.push(this.parseBlock());
          continue;
        }
      }

      // Parameter: KEY COLON VALUE
      if (this.check('IDENTIFIER') || this.check('KEYWORD')) {
        const key = this.advance().value.toLowerCase();

        if (!this.check('COLON')) {
          this.skipToNextLine();
          continue;
        }
        this.advance(); // consume colon

        const value = this.parseValue();

        // Handle special keys
        switch (key) {
          case 'template':
            template = typeof value === 'string' ? value : String(value);
            break;
          case 'id':
            id = typeof value === 'string' ? value : String(value);
            break;
          case 'trace_id':
            trace_id = typeof value === 'string' ? value : String(value);
            break;
          case 'parent_id':
            parent_id = typeof value === 'string' ? value : String(value);
            break;
          default:
            params[key] = value;
        }
      } else {
        this.skipToNextLine();
      }

      this.skipNewlines();
    }

    // Consume END if present
    if (this.checkKeyword('END')) {
      this.advance();
    }

    const span: LogLineSpan = {
      type: typeToken.value.toLowerCase(),
    };

    if (name) span.name = name;
    if (id) span.id = id;
    if (template) span.template = template;
    if (trace_id) span.trace_id = trace_id;
    if (parent_id) span.parent_id = parent_id;
    if (Object.keys(params).length > 0) span.params = params;
    if (children.length > 0) span.children = children;
    if (Object.keys(meta).length > 0) span.meta = meta;

    return span;
  }

  private parseValue(): LogLineValue {
    this.skipNewlines();

    const token = this.current();

    // String
    if (this.check('STRING')) {
      return this.advance().value;
    }

    // Number
    if (this.check('NUMBER')) {
      const val = this.advance().value;
      return val.includes('.') ? parseFloat(val) : parseInt(val, 10);
    }

    // Boolean
    if (this.check('BOOLEAN')) {
      return this.advance().value === 'true';
    }

    // Null
    if (this.check('NULL')) {
      this.advance();
      return null;
    }

    // Reference: @something.path
    if (this.check('REFERENCE')) {
      const ref = this.advance().value;
      const path = ref.slice(1).split('.');
      return { type: 'reference', value: ref, path };
    }

    // Array: [...]
    if (this.check('LBRACKET')) {
      return this.parseArray();
    }

    // Function call or interpolation: identifier(...) or identifier{key}
    if (this.check('IDENTIFIER')) {
      const name = this.advance().value;

      // Function call: name(...)
      if (this.check('LPAREN')) {
        return this.parseFunctionCall(name);
      }

      // Interpolation: name{key}
      if (this.check('LBRACE')) {
        this.advance(); // consume {
        const key = this.expect('IDENTIFIER', 'Expected interpolation key').value;
        this.expect('RBRACE', 'Expected } after interpolation key');
        return { type: 'interpolation', base: name, key };
      }

      // Plain identifier as string
      return name;
    }

    // Fallback: consume until newline as raw string
    let raw = '';
    while (!this.check('NEWLINE') && !this.check('EOF')) {
      raw += this.advance().value + ' ';
    }
    return raw.trim();
  }

  private parseArray(): LogLineValue[] {
    this.expect('LBRACKET', 'Expected [');
    const items: LogLineValue[] = [];

    while (!this.check('RBRACKET') && !this.check('EOF')) {
      this.skipNewlines();
      if (this.check('RBRACKET')) break;

      items.push(this.parseValue());

      this.skipNewlines();
      if (this.check('COMMA')) {
        this.advance();
      }
    }

    this.expect('RBRACKET', 'Expected ]');
    return items;
  }

  private parseFunctionCall(name: string): LogLineFunctionCall {
    this.expect('LPAREN', 'Expected (');
    const args: LogLineValue[] = [];

    while (!this.check('RPAREN') && !this.check('EOF')) {
      this.skipNewlines();
      if (this.check('RPAREN')) break;

      args.push(this.parseValue());

      this.skipNewlines();
      if (this.check('COMMA')) {
        this.advance();
      }
    }

    this.expect('RPAREN', 'Expected )');
    return { type: 'function_call', name, args };
  }

  // Helper methods

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private peek(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private checkKeyword(value: string): boolean {
    return this.current().type === 'KEYWORD' && this.current().value === value;
  }

  private advance(): Token {
    const token = this.current();
    if (this.pos < this.tokens.length) this.pos++;
    return token;
  }

  private expect(type: TokenType, message: string): Token {
    if (!this.check(type)) {
      const token = this.current();
      this.errors.push({
        line: token.line,
        column: token.column,
        message: `${message}, got ${token.type} "${token.value}"`,
      });
      // Try to recover
      return { type, value: '', line: token.line, column: token.column };
    }
    return this.advance();
  }

  private skipNewlines() {
    while (this.check('NEWLINE')) {
      this.advance();
    }
  }

  private skipToNextLine() {
    while (!this.check('NEWLINE') && !this.check('EOF')) {
      this.advance();
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

export function parseLogLineBlock(text: string): LogLineSpan {
  const tokenizer = new Tokenizer(text);
  const tokens = tokenizer.tokenize();
  const parser = new Parser(tokens);
  const result = parser.parse();

  if (result.errors.length > 0) {
    const err = result.errors[0];
    throw new Error(`Parse error at line ${err.line}: ${err.message}`);
  }

  if (!result.span) {
    throw new Error('Failed to parse LogLine block');
  }

  return result.span;
}

export function parseLogLineBlockSafe(text: string): ParseResult {
  const tokenizer = new Tokenizer(text);
  const tokens = tokenizer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

export function serializeToJsonAtomic(span: LogLineSpan, pretty = true): string {
  return JSON.stringify(span, null, pretty ? 2 : undefined);
}

export function serializeToLogLine(span: LogLineSpan, indent = 0): string {
  const pad = '  '.repeat(indent);
  const innerPad = '  '.repeat(indent + 1);

  let out = `${pad}${span.type.toUpperCase()}:`;
  if (span.name) out += ` ${span.name}`;
  out += '\n';

  if (span.id) {
    out += `${innerPad}ID: ${renderValue(span.id)}\n`;
  }

  if (span.trace_id) {
    out += `${innerPad}TRACE_ID: ${renderValue(span.trace_id)}\n`;
  }

  if (span.parent_id) {
    out += `${innerPad}PARENT_ID: ${renderValue(span.parent_id)}\n`;
  }

  if (span.template) {
    out += `${innerPad}TEMPLATE: ${renderValue(span.template)}\n`;
  }

  if (span.params) {
    for (const [k, v] of Object.entries(span.params)) {
      out += `${innerPad}${k.toUpperCase()}: ${renderValue(v)}\n`;
    }
  }

  if (span.children && span.children.length > 0) {
    out += '\n';
    for (const child of span.children) {
      out += serializeToLogLine(child, indent + 1);
      out += '\n';
    }
  }

  out += `${pad}END`;
  return out;
}

function renderValue(val: LogLineValue): string {
  if (val === null) return 'null';
  if (typeof val === 'string') {
    // Escape and quote if contains special chars
    if (/[\s,\(\)\[\]\{\}:]/.test(val) || val.includes('"')) {
      const escaped = val
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      return `"${escaped}"`;
    }
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(renderValue).join(', ')}]`;
  }
  if (typeof val === 'object' && 'type' in val) {
    switch (val.type) {
      case 'reference':
        return val.value;
      case 'function_call':
        return `${val.name}(${val.args.map(renderValue).join(', ')})`;
      case 'interpolation':
        return `${val.base}{${val.key}}`;
    }
  }
  return JSON.stringify(val);
}

// ============================================================================
// Utilities
// ============================================================================

export function walkSpans(span: LogLineSpan, visitor: (s: LogLineSpan, depth: number) => void, depth = 0): void {
  visitor(span, depth);
  if (span.children) {
    for (const child of span.children) {
      walkSpans(child, visitor, depth + 1);
    }
  }
}

export function findSpan(span: LogLineSpan, predicate: (s: LogLineSpan) => boolean): LogLineSpan | undefined {
  if (predicate(span)) return span;
  if (span.children) {
    for (const child of span.children) {
      const found = findSpan(child, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

export function transformSpan(span: LogLineSpan, transformer: (s: LogLineSpan) => LogLineSpan): LogLineSpan {
  const transformed = transformer({ ...span });
  if (transformed.children) {
    transformed.children = transformed.children.map(c => transformSpan(c, transformer));
  }
  return transformed;
}