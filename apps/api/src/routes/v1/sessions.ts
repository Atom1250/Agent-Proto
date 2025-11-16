import type { FastifyInstance } from 'fastify';
import type { StructuredOutput } from '../../lib/structuredOutput';

import { getAttachmentService } from '../../lib/attachments';
import { ensureDefaultTemplate, listTemplates } from '../../lib/bootstrap';
import { recordSessionStart, recordTurnHandled } from '../../lib/metrics';
import { prisma } from '../../lib/prisma';
import { applyStructuredOutput } from '../../lib/structuredOutput';

const NS_PER_SECOND = 1_000_000_000;

function durationSeconds(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / NS_PER_SECOND;
}

async function computeRequiredSlotProgress(sessionId: string, templateId: string | null) {
  if (!templateId) {
    return { percentFilled: 100, missingRequiredSlots: [] as string[] };
  }

  const [requiredSlots, responses] = await Promise.all([
    prisma.slot.findMany({ where: { templateId, required: true }, select: { key: true } }),
    prisma.response.findMany({ where: { sessionId }, select: { slotKey: true } }),
  ]);

  const requiredKeys: string[] = [];
  for (const slot of requiredSlots) {
    requiredKeys.push(slot.key);
  }

  const respondedKeys = new Set<string>();
  for (const response of responses) {
    respondedKeys.add(response.slotKey);
  }

  let filledCount = 0;
  for (const key of requiredKeys) {
    if (respondedKeys.has(key)) {
      filledCount += 1;
    }
  }

  const totalRequired = requiredKeys.length;
  const percentFilled = totalRequired === 0 ? 100 : Math.round((filledCount / totalRequired) * 100);
  const missingRequiredSlots: string[] = [];
  for (const key of requiredKeys) {
    if (!respondedKeys.has(key)) {
      missingRequiredSlots.push(key);
    }
  }

  return { percentFilled, missingRequiredSlots };
}

const attachmentService = getAttachmentService();

export async function sessionsRoutes(app: FastifyInstance) {
  app.get('/templates', async (_req, reply) => {
    const templates = await listTemplates();
    return reply.send({ templates });
  });

  app.post('/setup/bootstrap', async (_req, reply) => {
    const ensuredTemplate = await ensureDefaultTemplate();
    const templates = await listTemplates();

    return reply.send({
      templates,
      ensuredTemplateId: ensuredTemplate.id,
    });
  });

  app.post<{ Body: { name?: string | null; email?: string | null } }>('/clients', async (req, reply) => {
    const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const name = requestedName || `Client ${new Date().toISOString()}`;
    const email = typeof req.body?.email === 'string' && req.body.email.trim() ? req.body.email.trim() : null;

    const client = await prisma.client.create({
      data: { name, email },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    app.log.info({ clientId: client.id }, 'client created via quick-start');

    return reply.code(201).send({ client });
  });

  app.post<{ Body: { clientId: string; templateId: string } }>('/sessions', async (req, reply) => {
    const startedAt = process.hrtime.bigint();
    const { clientId, templateId } = req.body ?? {};
    if (!clientId || !templateId) {
      return reply.code(400).send({ error: 'clientId and templateId are required' });
    }

    const session = await prisma.session.create({
      data: {
        clientId,
        templateId,
        status: 'active',
      },
      select: { id: true },
    });

    app.log.info({ sessionId: session.id, clientId, templateId }, 'session created');
    recordSessionStart(durationSeconds(startedAt));
    return reply.code(201).send({ sessionId: session.id });
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const { id } = req.params;

    const found = await prisma.session.findUnique({
      where: { id },
      select: { id: true, status: true, templateId: true },
    });
    if (!found) {
      return reply.code(404).send({ error: 'session not found' });
    }

    const progress = await computeRequiredSlotProgress(id, found.templateId);

    return reply.send({
      id: found.id,
      status: found.status,
      percentRequiredSlotsFilled: progress.percentFilled,
      missing_required_slots: progress.missingRequiredSlots,
    });
  });

  app.post<{
    Params: { id: string };
    Body: { content?: string; structuredOutput?: StructuredOutput | null };
  }>('/sessions/:id/messages', async (req, reply) => {
    const startedAt = process.hrtime.bigint();
    const { id } = req.params;

    const session = await prisma.session.findUnique({
      where: { id },
      select: { templateId: true },
    });

    if (!session) {
      return reply.code(404).send({ error: 'session not found' });
    }

    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return reply.code(400).send({ error: 'content is required' });
    }

    const message = await prisma.message.create({
      data: {
        sessionId: id,
        role: 'user',
        content,
      },
    });

    const rawStructured = (req.body as Record<string, unknown> | undefined)?.structuredOutput ??
      (req.body as Record<string, unknown> | undefined)?.structured_output ??
      null;
    const structuredOutput = rawStructured as StructuredOutput | null;
    if (structuredOutput && typeof structuredOutput === 'object') {
      try {
        await applyStructuredOutput(id, structuredOutput);
      } catch (error) {
        req.log.error({ err: error, sessionId: id }, 'failed to apply structured output for chat message');
      }
    }

    const progress = await computeRequiredSlotProgress(id, session.templateId);

    const responsePayload = {
      percentRequiredSlotsFilled: progress.percentFilled,
      missing_required_slots: progress.missingRequiredSlots,
    };

    recordTurnHandled(1, durationSeconds(startedAt));
    return reply.code(201).send(responsePayload);
  });

  app.post<{
    Params: { id: string };
    Body: { filename?: string; mimeType?: string; size?: number };
  }>('/sessions/:id/attachments/presign', async (req, reply) => {
    const { id } = req.params;
    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return reply.code(404).send({ error: 'session not found' });
    }

    const { filename, mimeType, size } = req.body ?? {};

    try {
      const presign = await attachmentService.createUpload({
        sessionId: id,
        filename: filename ?? null,
        mimeType: mimeType ?? null,
        size: typeof size === 'number' && Number.isFinite(size) ? Math.max(0, Math.floor(size)) : null,
      });

      return reply.code(201).send({
        uploadUrl: presign.uploadUrl,
        method: presign.method,
        headers: presign.headers,
        expiresAt: presign.expiresAt,
        attachment: {
          id: presign.attachment.id,
          sessionId: presign.attachment.sessionId,
          filename: presign.attachment.filename,
          mimeType: presign.attachment.mimeType,
          size: presign.attachment.size,
          checksum: presign.attachment.checksum,
          createdAt: presign.attachment.createdAt,
          url: presign.attachment.url,
        },
      });
    } catch (error) {
      req.log.error({ err: error, sessionId: id }, 'failed to create attachment upload');
      return reply.code(500).send({ error: 'unable to create attachment upload' });
    }
  });

  app.put<{ Params: { token: string } }>('/attachments/upload/:token', async (req, reply) => {
    const { token } = req.params;

    try {
      const lengthHeader = req.headers['content-length'];
      const parsedLength = Array.isArray(lengthHeader)
        ? Number(lengthHeader[0])
        : typeof lengthHeader === 'string'
        ? Number(lengthHeader)
        : null;

      const contentLength = parsedLength != null && Number.isFinite(parsedLength) ? parsedLength : null;

      await attachmentService.receiveUpload(token, req.raw, {
        contentType: req.headers['content-type'],
        contentLength,
      });
      return reply.code(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'upload failed';
      req.log.error({ err: error, token }, 'failed to store attachment');
      if (message === 'invalid-upload-token') {
        return reply.code(404).send({ error: 'upload token expired or invalid' });
      }
      if (message === 'attachment-not-found') {
        return reply.code(404).send({ error: 'attachment missing' });
      }
      if (message === 'invalid-content-length') {
        return reply.code(400).send({ error: 'invalid content length' });
      }
      if (message === 'attachment-too-large' || message === 'attachment-size-exceeded') {
        return reply.code(413).send({ error: 'attachment too large' });
      }
      return reply.code(500).send({ error: 'unable to store attachment' });
    }
  });

  app.post<{
    Params: { id: string };
    Body:
      | {
          eventId?: string;
          role?: string;
          transcript?: string;
          audioUrl?: string | null;
          audioId?: string | null;
          structuredOutput?: StructuredOutput | null;
        }
      | Array<{
          eventId?: string;
          role?: string;
          transcript?: string;
          audioUrl?: string | null;
          audioId?: string | null;
          structuredOutput?: StructuredOutput | null;
        }>;
  }>('/sessions/:id/voice-turns', async (req, reply) => {
    const startedAt = process.hrtime.bigint();
    const { id } = req.params;

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session) {
      return reply.code(404).send({ error: 'session not found' });
    }

    const payload = Array.isArray(req.body) ? req.body : req.body ? [req.body] : [];
    if (payload.length === 0) {
      return reply.code(400).send({ error: 'voice turn payload missing' });
    }

    const processedIds = new Set<string>();
    const aggregateMissing = new Set<string>();
    let savedMessages = 0;

    for (const entry of payload) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : null;
      if (role !== 'user' && role !== 'assistant') {
        continue;
      }

      const transcript = typeof entry.transcript === 'string' ? entry.transcript.trim() : '';
      if (!transcript) {
        continue;
      }

      const eventId = typeof entry.eventId === 'string' && entry.eventId.trim() ? entry.eventId.trim() : null;
      if (eventId) {
        if (processedIds.has(eventId)) {
          continue;
        }
        processedIds.add(eventId);
      }

      const audioHint = typeof entry.audioId === 'string' && entry.audioId.trim() ? entry.audioId.trim() : null;
      const audioUrl = typeof entry.audioUrl === 'string' && entry.audioUrl.trim() ? entry.audioUrl.trim() : null;
      const prefix = role === 'user' ? '[voice:user]' : '[voice:assistant]';
      const details: string[] = [prefix];
      if (audioHint) {
        details.push(`audio:${audioHint}`);
      }
      if (audioUrl) {
        details.push(`url:${audioUrl}`);
      }
      const metadata = details.join(' ');
      const content = `${metadata}\n${transcript}`;

      if (eventId) {
        await prisma.message.upsert({
          where: { id: eventId },
          update: {},
          create: {
            id: eventId,
            sessionId: id,
            role,
            content,
          },
        });
      } else {
        await prisma.message.create({
          data: {
            sessionId: id,
            role,
            content,
          },
        });
      }

      savedMessages += 1;

      const structuredOutput = entry.structuredOutput;
      if (structuredOutput && typeof structuredOutput === 'object') {
        try {
          const { missingRequiredSlots } = await applyStructuredOutput(id, structuredOutput);
          missingRequiredSlots.forEach((slotKey) => aggregateMissing.add(slotKey));
        } catch (error) {
          req.log.error({ err: error, sessionId: id }, 'failed to apply structured output for voice turn');
        }
      }
    }

    if (savedMessages === 0) {
      return reply.code(400).send({ error: 'no valid voice turns provided' });
    }

    const result = {
      saved: savedMessages,
      missing_required_slots: Array.from(aggregateMissing),
    };

    recordTurnHandled(savedMessages, durationSeconds(startedAt));
    return result;
  });
}

