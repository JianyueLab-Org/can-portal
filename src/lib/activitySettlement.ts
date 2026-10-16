import { pointsFor } from "./activities";

export type EvidenceState = "online" | "missing" | "unavailable";

export interface SettlementPreviewRow {
  role: number;
  onlineEvidence?: boolean;
  noShowPoints?: number;
}

export function evidenceState(
  endsAt: string | null | undefined,
  onlineEvidence: boolean | undefined,
): EvidenceState {
  if (!endsAt) return "unavailable";
  return onlineEvidence ? "online" : "missing";
}

/** Points shown immediately before settlement, including any automatic no-show penalty. */
export function settlementPreview(
  row: SettlementPreviewRow,
  attended: boolean,
  professional: boolean,
  hasEndTime = true,
): number {
  if (attended) {
    const role: 0 | 1 | 2 = row.role === 2 ? 2 : row.role === 1 ? 1 : 0;
    return pointsFor(role, professional);
  }
  if (!hasEndTime || row.onlineEvidence) return 0;
  if (row.noShowPoints !== undefined) return row.noShowPoints;
  const role: 0 | 1 | 2 = row.role === 2 ? 2 : row.role === 1 ? 1 : 0;
  return -pointsFor(role, professional);
}
