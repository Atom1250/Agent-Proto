import type { StructuredOutput, SlotUpdate } from '@agent-proto/shared';

import { recordSlotUpdates } from './metrics';
import { prisma } from './prisma';

export type AppliedStructuredOutput = {
  slotUpdates: SlotUpdate[];
  missingRequiredSlots: string[];
};

function sanitizeSlotUpdates(slotUpdates: unknown): SlotUpdate[] {
  if (!Array.isArray(slotUpdates)) {
    return [];
  }

  return slotUpdates
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const slotKey = typeof record.slotKey === 'string' ? record.slotKey : typeof record.slot_key === 'string' ? record.slot_key : null;
      if (!slotKey) {
        return null;
      }

      return {
        slotKey,
        value: record.value ?? null,
      } satisfies SlotUpdate;
    })
    .filter((entry): entry is SlotUpdate => Boolean(entry));
}

function sanitizeMissingSlots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

export async function applyStructuredOutput(
  sessionId: string,
  structuredOutput: StructuredOutput | null | undefined,
): Promise<AppliedStructuredOutput> {
  if (!structuredOutput) {
    return { slotUpdates: [], missingRequiredSlots: [] };
  }

  const slotUpdates = sanitizeSlotUpdates(structuredOutput.slot_updates ?? structuredOutput.slotUpdates);
  const missingRequiredSlots = sanitizeMissingSlots(
    structuredOutput.missing_required_slots ?? structuredOutput.missingRequiredSlots,
  );

  const startedAt = process.hrtime.bigint();

  await Promise.all(
    slotUpdates.map((update) =>
      prisma.response.upsert({
        where: { sessionId_slotKey: { sessionId, slotKey: update.slotKey } },
        create: {
          sessionId,
          slotKey: update.slotKey,
          value: update.value ?? null,
        },
        update: {
          value: update.value ?? null,
        },
      }),
    ),
  );

  if (slotUpdates.length > 0) {
    const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    recordSlotUpdates(slotUpdates.length, elapsedSeconds);
  }

  return {
    slotUpdates,
    missingRequiredSlots,
  };
}
