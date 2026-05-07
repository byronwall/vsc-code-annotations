const FUZZY_WINDOW_RADIUS = 2;

export const MIN_FUZZY_MATCH_LENGTH = 24;
export const MIN_FUZZY_MATCH_SCORE = 0.58;

export function buildSearchWindowSizes(lineCount: number): number[] {
  const values = new Set<number>();
  values.add(lineCount);

  for (let delta = 1; delta <= FUZZY_WINDOW_RADIUS; delta += 1) {
    values.add(Math.max(1, lineCount - delta));
    values.add(lineCount + delta);
  }

  return Array.from(values);
}

export function scoreApproximateMatch(
  targetCode: string,
  candidateCode: string,
  targetStartLine: number,
  candidateStartLine: number,
): number {
  const normalizedTarget = normalizeForMatching(targetCode);
  const normalizedCandidate = normalizeForMatching(candidateCode);
  if (!normalizedTarget || !normalizedCandidate) {
    return 0;
  }

  const contentScore = diceCoefficient(normalizedTarget, normalizedCandidate);
  const boundaryScore = scoreBoundarySimilarity(targetCode, candidateCode);
  const distance = Math.abs(targetStartLine - candidateStartLine);
  const proximityScore = 1 / (1 + distance / 40);

  return contentScore * 0.75 + boundaryScore * 0.15 + proximityScore * 0.1;
}

function scoreBoundarySimilarity(
  targetCode: string,
  candidateCode: string,
): number {
  const targetLines = nonEmptyNormalizedLines(targetCode);
  const candidateLines = nonEmptyNormalizedLines(candidateCode);
  if (targetLines.length === 0 || candidateLines.length === 0) {
    return 0;
  }

  const firstScore = diceCoefficient(targetLines[0], candidateLines[0] ?? "");
  const lastScore = diceCoefficient(
    targetLines[targetLines.length - 1],
    candidateLines[candidateLines.length - 1] ?? "",
  );
  return (firstScore + lastScore) / 2;
}

function nonEmptyNormalizedLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => normalizeForMatching(line))
    .filter(Boolean);
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftCounts = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    leftCounts.set(gram, (leftCounts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    const count = leftCounts.get(gram) ?? 0;
    if (count > 0) {
      leftCounts.set(gram, count - 1);
      intersection += 1;
    }
  }

  return (2 * intersection) / (left.length + right.length - 2);
}

function normalizeForMatching(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd().replace(/\s+/g, " ").trim();
}
