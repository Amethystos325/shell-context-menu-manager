export type DiffOperationType = "equal" | "add" | "remove";

export interface DiffOperation {
  type: DiffOperationType;
  line: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  operations: DiffOperation[];
}

export interface TextDiff {
  hasChanges: boolean;
  hunks: DiffHunk[];
  oldLineCount: number;
  newLineCount: number;
}

function splitLines(input: string): string[] {
  if (!input) {
    return [];
  }
  const normalized = input.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  return dp;
}

function buildOperations(oldLines: string[], newLines: string[], dp: number[][]): DiffOperation[] {
  const ops: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({
        type: "equal",
        line: oldLines[i],
        oldLine,
        newLine,
      });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({
        type: "remove",
        line: oldLines[i],
        oldLine,
      });
      i += 1;
      oldLine += 1;
      continue;
    }

    ops.push({
      type: "add",
      line: newLines[j],
      newLine,
    });
    j += 1;
    newLine += 1;
  }

  while (i < oldLines.length) {
    ops.push({
      type: "remove",
      line: oldLines[i],
      oldLine,
    });
    i += 1;
    oldLine += 1;
  }

  while (j < newLines.length) {
    ops.push({
      type: "add",
      line: newLines[j],
      newLine,
    });
    j += 1;
    newLine += 1;
  }

  return ops;
}

function toHunks(ops: DiffOperation[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffOperation[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const first = current[0];
    hunks.push({
      oldStart: first.oldLine ?? 0,
      newStart: first.newLine ?? 0,
      operations: current,
    });
    current = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      if (current.length > 0) {
        current.push(op);
        if (current.filter((entry) => entry.type === "equal").length >= 3) {
          flush();
        }
      }
      continue;
    }

    current.push(op);
  }

  flush();
  return hunks;
}

export function createTextDiff(oldText: string, newText: string): TextDiff {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const dp = buildLcsTable(oldLines, newLines);
  const operations = buildOperations(oldLines, newLines, dp);
  const hasChanges = operations.some((op) => op.type !== "equal");

  return {
    hasChanges,
    hunks: hasChanges ? toHunks(operations) : [],
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
  };
}
