import type { StructuredOutput, SlotUpdate } from '@agent-proto/shared';

import type { PrismaClient } from '@prisma/client';

import { recordSlotUpdates } from './metrics';

let prismaClient: PrismaClient | null = null;

async function getPrisma(): Promise<PrismaClient> {
  if (!prismaClient) {
    const module = await import('./prisma.js');
    prismaClient = module.prisma;
  }
  return prismaClient;
}

export type NormalizedStructuredOutput = {
  slotUpdates: SlotUpdate[];
  missingRequiredSlots: string[];
};

export type AppliedStructuredOutput = NormalizedStructuredOutput;

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

export function normalizeStructuredOutput(
  structuredOutput: StructuredOutput | Record<string, unknown> | null | undefined,
): NormalizedStructuredOutput {
  if (!structuredOutput || typeof structuredOutput !== 'object') {
    return { slotUpdates: [], missingRequiredSlots: [] };
  }

  const payload = structuredOutput as Record<string, unknown>;
  const slotUpdates = sanitizeSlotUpdates(payload.slot_updates ?? payload.slotUpdates);
  const missingRequiredSlots = sanitizeMissingSlots(
    payload.missing_required_slots ?? payload.missingRequiredSlots,
  );

  return { slotUpdates, missingRequiredSlots };
}

export async function applyStructuredOutput(
  sessionId: string,
  structuredOutput: StructuredOutput | null | undefined,
): Promise<AppliedStructuredOutput> {
  const { slotUpdates, missingRequiredSlots } = normalizeStructuredOutput(structuredOutput);

  if (slotUpdates.length === 0) {
    return { slotUpdates, missingRequiredSlots };
  }

  const startedAt = process.hrtime.bigint();

  const prisma = await getPrisma();
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

  const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
  recordSlotUpdates(slotUpdates.length, elapsedSeconds);

  return { slotUpdates, missingRequiredSlots };
}
