/** Persistent ordered UUID index for the transactional test store. */
export interface PartyNode {
  readonly id: string;
  readonly priority: number;
  readonly left?: PartyNode;
  readonly right?: PartyNode;
}

function rank(id: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < id.length; i++)
    value = Math.imul(value ^ id.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

function node(
  id: string,
  priority: number,
  left?: PartyNode,
  right?: PartyNode,
): PartyNode {
  return {
    id,
    priority,
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

export function insertPartyId(
  root: PartyNode | undefined,
  id: string,
): PartyNode {
  if (!root) return node(id, rank(id));
  if (id === root.id) throw new Error("duplicate party ID");
  if (id < root.id) {
    const left = insertPartyId(root.left, id);
    if (left.priority < root.priority)
      return node(
        left.id,
        left.priority,
        left.left,
        node(root.id, root.priority, left.right, root.right),
      );
    return node(root.id, root.priority, left, root.right);
  }
  const right = insertPartyId(root.right, id);
  if (right.priority < root.priority)
    return node(
      right.id,
      right.priority,
      node(root.id, root.priority, root.left, right.left),
      right.right,
    );
  return node(root.id, root.priority, root.left, right);
}

function merge(left?: PartyNode, right?: PartyNode): PartyNode | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.priority < right.priority
    ? node(left.id, left.priority, left.left, merge(left.right, right))
    : node(right.id, right.priority, merge(left, right.left), right.right);
}

export function removePartyId(
  root: PartyNode | undefined,
  id: string,
): PartyNode | undefined {
  if (!root) throw new Error("missing party ID");
  if (id === root.id) return merge(root.left, root.right);
  return id < root.id
    ? node(root.id, root.priority, removePartyId(root.left, id), root.right)
    : node(root.id, root.priority, root.left, removePartyId(root.right, id));
}

export function partyIds(
  root: PartyNode | undefined,
  cursor: string | undefined,
  limit: number,
  matches: (id: string) => boolean,
): string[] {
  const ids: string[] = [];
  function visit(current: PartyNode | undefined): void {
    if (!current || ids.length >= limit) return;
    if (cursor && current.id <= cursor) {
      visit(current.right);
      return;
    }
    visit(current.left);
    if (ids.length < limit && matches(current.id)) ids.push(current.id);
    visit(current.right);
  }
  visit(root);
  return ids;
}
