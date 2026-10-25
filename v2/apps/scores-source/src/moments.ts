// The part of a Scores B01 moment (contracts `broadcast/moments.ts`) the scorebug acts on. Moments
// only trigger and correct banners; what a banner says comes from the snapshot (`banners.ts`).

/** `goal`/`timeout` enter a banner; `event.voided`/`event.amended` correct one; others are ignored. */
export type Moment =
  | { kind: "goal" | "timeout"; id: string }
  | { kind: "event.voided"; id: string; targetId: string; targetKind: string | null }
  | { kind: "event.amended"; id: string; targetId: string; targetKind: string | null }
  | { kind: "other"; id: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Null when the payload is not a moment. */
export function readMoment(data: unknown): Moment | null {
  if (!isObject(data) || typeof data.id !== "string" || typeof data.kind !== "string") return null;
  const { id, kind } = data;
  if (kind === "goal" || kind === "timeout") return { kind, id };
  if (kind === "event.voided" || kind === "event.amended") {
    if (typeof data.targetId !== "string") return null;
    const target = kind === "event.voided" ? data.targetKind : isObject(data.target) ? data.target.kind : null;
    return { kind, id, targetId: data.targetId, targetKind: typeof target === "string" ? target : null };
  }
  return { kind: "other", id };
}
