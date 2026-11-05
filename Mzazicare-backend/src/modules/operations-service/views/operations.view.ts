/**
 * U-CS 77 — Care Operations Monitoring & Control System
 * Owner(s): Samuel Kahiga, Wachira Peter Githinji
 */

import type { OperationsSnapshot } from "@/modules/operations-service/models/operations.model";

/**
 * The shape the API returns. Views exist so that a document can never leak a
 * field by accident — add a field here deliberately or the client never sees it.
 */
export type OperationsSnapshotView = {
  id: string;
  createdAt: string;
};

export const serializeOperationsSnapshot = (
  operationsSnapshot: OperationsSnapshot,
): OperationsSnapshotView => ({
  id: String(operationsSnapshot._id),
  createdAt: operationsSnapshot.createdAt.toISOString(),
});
