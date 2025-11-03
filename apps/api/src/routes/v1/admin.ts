import { createReadStream } from 'node:fs';
import path from 'node:path';

import { FastifyInstance } from 'fastify';

import { getAttachmentService } from '../../lib/attachments';
import { prisma } from '../../lib/prisma';

const attachmentService = getAttachmentService();

type SessionsQuery = {
  templateId?: string;
  status?: string;
  startedAfter?: string;
  startedBefore?: string;
};

type AdminResponseValue = {
  text: string;
  confidence: number | null;
  raw: unknown;
};

const ADMIN_HEADER = 'x-admin-secret';

function requireAdminPassword() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD is not configured');
  }
  return secret;
}

function parseResponseValue(value: unknown): AdminResponseValue {
  if (value === null || value === undefined) {
    return { text: '', confidence: null, raw: value }; // null value
  }

  if (typeof value === 'string') {
    return { text: value, confidence: null, raw: value };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { text: String(value), confidence: null, raw: value };
  }

  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    const textCandidate = data.value ?? data.text ?? data.answer ?? data.output;
    const confidenceCandidate = data.confidence ?? data.score ?? data.probability;

    const text = typeof textCandidate === 'string' || typeof textCandidate === 'number' || typeof textCandidate === 'boolean'
      ? String(textCandidate)
      : JSON.stringify(value);

    const confidence = typeof confidenceCandidate === 'number' ? confidenceCandidate : null;

    return { text, confidence, raw: value };
  }

  return { text: JSON.stringify(value), confidence: null, raw: value };
}

export async function adminRoutes(app: FastifyInstance) {
  const adminSecret = requireAdminPassword();

  app.addHook('onRequest', async (req, reply) => {
    const provided = req.headers[ADMIN_HEADER] ?? req.headers[ADMIN_HEADER.toLowerCase()];
    const providedSecret = Array.isArray(provided) ? provided[0] : provided;

    if (providedSecret !== adminSecret) {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
  });

  app.get<{ Querystring: SessionsQuery }>('/sessions', async (req) => {
    const { templateId, status, startedAfter, startedBefore } = req.query ?? {};

    const where: Parameters<typeof prisma.session.findMany>[0]['where'] = {};

    if (templateId) {
      where.templateId = templateId;
    }

    if (status) {
      where.status = status;
    }

    if (startedAfter || startedBefore) {
      const createdAtFilter: { gte?: Date; lte?: Date } = {};
      if (startedAfter) {
        const parsed = new Date(startedAfter);
        if (!Number.isNaN(parsed.valueOf())) {
          createdAtFilter.gte = parsed;
        }
      }
      if (startedBefore) {
        const parsed = new Date(startedBefore);
        if (!Number.isNaN(parsed.valueOf())) {
          createdAtFilter.lte = parsed;
        }
      }
      if (Object.keys(createdAtFilter).length > 0) {
        where.createdAt = createdAtFilter;
      }
    }

    const [sessions, templates] = await Promise.all([
      prisma.session.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true, email: true } },
          template: {
            select: {
              id: true,
              name: true,
              slots: { where: { required: true }, select: { key: true } },
            },
          },
          responses: { select: { slotKey: true } },
        },
      }),
      prisma.onboarding_template.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const summaries = sessions.map((session) => {
      const requiredSlots = session.template?.slots ?? [];
      const requiredKeys = new Set(requiredSlots.map((slot) => slot.key));
      const filledCount = session.responses.reduce((acc, response) => acc + (requiredKeys.has(response.slotKey) ? 1 : 0), 0);
      const totalRequired = requiredKeys.size;
      const percentComplete = totalRequired === 0 ? 100 : Math.round((filledCount / totalRequired) * 100);

      return {
        id: session.id,
        clientName: session.client?.name ?? 'Unknown client',
        clientEmail: session.client?.email ?? null,
        templateId: session.template?.id ?? null,
        templateName: session.template?.name ?? 'Unknown template',
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        percentComplete,
      };
    });

    const statuses = Array.from(new Set(summaries.map((s) => s.status))).sort();

    return {
      sessions: summaries,
      filters: {
        templates,
        statuses,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/responses', async (req, reply) => {
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, email: true } },
        template: {
          select: {
            id: true,
            name: true,
            slots: { select: { key: true, label: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
        responses: { select: { id: true, slotKey: true, value: true, createdAt: true } },
      },
    });

    if (!session) {
      reply.code(404).send({ error: 'session not found' });
      return;
    }

    const slotLabelMap = new Map(session.template?.slots.map((slot) => [slot.key, slot.label ?? slot.key] as const) ?? []);

    const responses = session.responses
      .map((response) => {
        const parsed = parseResponseValue(response.value ?? null);
        return {
          id: response.id,
          slotKey: response.slotKey,
          slotLabel: slotLabelMap.get(response.slotKey) ?? response.slotKey,
          value: parsed.text,
          confidence: parsed.confidence,
          raw: parsed.raw,
          createdAt: response.createdAt,
        };
      })
      .sort((a, b) => a.slotLabel.localeCompare(b.slotLabel));

    const requiredSlots = session.template?.slots ?? [];
    const requiredKeys = new Set(requiredSlots.map((slot) => slot.key));
    const filledCount = responses.reduce((acc, response) => acc + (requiredKeys.has(response.slotKey) && response.value ? 1 : 0), 0);
    const totalRequired = requiredKeys.size;
    const percentComplete = totalRequired === 0 ? 100 : Math.round((filledCount / totalRequired) * 100);

    const attachments = await attachmentService.listForSession(id);
    const withAvailability = await Promise.all(
      attachments.map(async (attachment) => {
        let available = false;
        try {
          await attachmentService.openAttachmentPath(attachment.id);
          available = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message === 'attachment-file-missing') {
            available = false;
          } else {
            throw error;
          }
        }

        return {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          checksum: attachment.checksum,
          createdAt: attachment.createdAt,
          available,
          downloadUrl: available ? `/v1/admin/attachments/${attachment.id}/download` : null,
        };
      }),
    );

    return {
      session: {
        id: session.id,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        clientName: session.client?.name ?? 'Unknown client',
        clientEmail: session.client?.email ?? null,
        templateName: session.template?.name ?? 'Unknown template',
        percentComplete,
      },
      messages: session.messages,
      responses,
      attachments: withAvailability,
    };
  });

  app.get<{ Params: { id: string } }>('/attachments/:id/download', async (req, reply) => {
    const { id } = req.params;

    try {
      const { attachment, storagePath } = await attachmentService.openAttachmentPath(id);
      const stream = createReadStream(storagePath);
      const filename = attachment.filename ?? path.basename(storagePath);

      reply.header('Content-Type', attachment.mimeType ?? 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      return reply.send(stream);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'attachment-not-found' || message === 'attachment-file-missing') {
        reply.code(404).send({ error: 'attachment not found' });
        return;
      }
      req.log.error({ err: error, attachmentId: id }, 'failed to download attachment');
      reply.code(500).send({ error: 'unable to download attachment' });
    }
  });

  app.get<{ Querystring: { sessionId?: string } }>('/export', async (req, reply) => {
    const sessionId = req.query.sessionId;

    if (!sessionId) {
      reply.code(400).send({ error: 'sessionId is required' });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        template: {
          select: {
            name: true,
            slots: { select: { key: true, label: true } },
          },
        },
        responses: { select: { slotKey: true, value: true, createdAt: true } },
      },
    });

    if (!session) {
      reply.code(404).send({ error: 'session not found' });
      return;
    }

    const slotLabelMap = new Map(session.template?.slots.map((slot) => [slot.key, slot.label ?? slot.key] as const) ?? []);

    const exportPayload = {
      sessionId: session.id,
      templateName: session.template?.name ?? null,
      exportedAt: new Date().toISOString(),
      responses: session.responses.map((response) => {
        const parsed = parseResponseValue(response.value ?? null);
        return {
          slotKey: response.slotKey,
          slotLabel: slotLabelMap.get(response.slotKey) ?? response.slotKey,
          value: parsed.text,
          confidence: parsed.confidence,
          raw: parsed.raw,
          capturedAt: response.createdAt.toISOString(),
        };
      }),
    };

    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="session-${session.id}-responses.json"`);
    return exportPayload;
  });
}

