import { createTextDiff } from "./diff.js";
import { isParseError, parseConfig } from "./parser.js";
import { serializeConfig } from "./serializer.js";
import type { ConfigDocument, ParseIssue, ValidationIssue } from "./types.js";
import { validateConfig } from "./validator.js";

export interface ParseAndValidateResult {
  document?: ConfigDocument;
  parseIssues: ParseIssue[];
  validationIssues: ValidationIssue[];
}

export function parseAndValidate(text: string): ParseAndValidateResult {
  try {
    const document = parseConfig(text);
    return {
      document,
      parseIssues: [],
      validationIssues: validateConfig(document),
    };
  } catch (error) {
    if (isParseError(error)) {
      return {
        parseIssues: [
          {
            code: "E_PARSE",
            message: error.message,
            range: error.range,
          },
        ],
        validationIssues: [],
      };
    }
    throw error;
  }
}

export function roundTrip(text: string): {
  parsed: ConfigDocument;
  serialized: string;
  reparsed: ConfigDocument;
  diff: ReturnType<typeof createTextDiff>;
} {
  const parsed = parseConfig(text);
  const serialized = serializeConfig(parsed);
  const reparsed = parseConfig(serialized);
  const diff = createTextDiff(text, serialized);
  return { parsed, serialized, reparsed, diff };
}
