/** Persistent treap for the transactional test store. Keys sort by occurrence, then sequence. */
export interface HistoryKey {
  readonly id: string;
  readonly occurredAtUtc: string;
  readonly sequence: number;
}

export interface HistoryNode {
  readonly key: HistoryKey;
  readonly priority: number;
  readonly minSequence: number;
  readonly left?: HistoryNode;
  readonly right?: HistoryNode;
}

function compare(a: HistoryKey, b: HistoryKey): number {
  return a.occurredAtUtc < b.occurredAtUtc
    ? -1
    : a.occurredAtUtc > b.occurredAtUtc
      ? 1
      : a.sequence - b.sequence;
}

function priority(sequence: number): number {
  let value = sequence | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function node(
  key: HistoryKey,
  rank: number,
  left?: HistoryNode,
  right?: HistoryNode,
): HistoryNode {
  return {
    key,
    priority: rank,
    minSequence: Math.min(
      key.sequence,
      left?.minSequence ?? Infinity,
      right?.minSequence ?? Infinity,
    ),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

export function insert(
  root: HistoryNode | undefined,
  key: HistoryKey,
): HistoryNode {
  if (!root) return node(key, priority(key.sequence));
  const direction = compare(key, root.key);
  if (direction === 0) throw new Error("duplicate history key");
  if (direction < 0) {
    const left = insert(root.left, key);
    if (left.priority < root.priority)
      return node(
        left.key,
        left.priority,
        left.left,
        node(root.key, root.priority, left.right, root.right),
      );
    return node(root.key, root.priority, left, root.right);
  }
  const right = insert(root.right, key);
  if (right.priority < root.priority)
    return node(
      right.key,
      right.priority,
      node(root.key, root.priority, root.left, right.left),
      right.right,
    );
  return node(root.key, root.priority, root.left, right);
}

/** Descending page below cursor. Subtrees entirely newer than highWater are skipped. */
export function page(
  root: HistoryNode | undefined,
  highWater: number,
  cursor: HistoryKey | undefined,
  limit: number,
): string[] {
  const ids: string[] = [];
  function visit(current: HistoryNode | undefined): void {
    if (!current || ids.length >= limit || current.minSequence > highWater)
      return;
    if (cursor && compare(current.key, cursor) >= 0) {
      visit(current.left);
      return;
    }
    visit(current.right);
    if (ids.length < limit && current.key.sequence <= highWater)
      ids.push(current.key.id);
    visit(current.left);
  }
  visit(root);
  return ids;
}

export function allIds(root: HistoryNode | undefined): string[] {
  const ids: string[] = [];
  function visit(current: HistoryNode | undefined): void {
    if (!current) return;
    visit(current.left);
    ids.push(current.key.id);
    visit(current.right);
  }
  visit(root);
  return ids;
}
