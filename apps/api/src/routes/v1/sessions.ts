import { FastifyInstance } from 'fastify';
import { Buffer } from 'node:buffer';

import { getAttachmentService } from '../../lib/attachments';
import { prisma } from '../../lib/prisma';

const attachmentService = getAttachmentService();

export async function sessionsRoutes(app: FastifyInstance) {
  app.post<{ Body: { clientId: string; templateId: string } }>('/sessions', async (req, reply) => {
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

    // Compute % of required slots filled
    const templateId = found.templateId;
    let percentFilled = 0;
    if (templateId) {
      const [requiredSlots, responses] = await Promise.all([
        prisma.slot.findMany({ where: { templateId, required: true }, select: { key: true } }),
        prisma.response.findMany({ where: { sessionId: id }, select: { slotKey: true } }),
      ]);

      const requiredSet = new Set(requiredSlots.map((s: { key: string }) => s.key));
      const filledCount = responses.reduce((acc: number, r: { slotKey: string }) => acc + (requiredSet.has(r.slotKey) ? 1 : 0), 0);
      const totalRequired = requiredSet.size;
      percentFilled = totalRequired === 0 ? 100 : Math.round((filledCount / totalRequired) * 100);
    }

    return reply.send({ id: found.id, status: found.status, percentRequiredSlotsFilled: percentFilled });
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

    const buffers: Buffer[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        req.raw.on('data', (chunk) => {
          buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.raw.on('end', () => resolve());
        req.raw.on('error', (error) => reject(error));
      });
    } catch (error) {
      req.log.error({ err: error }, 'failed to read upload payload');
      return reply.code(400).send({ error: 'invalid upload payload' });
    }

    const payload = Buffer.concat(buffers);

    try {
      await attachmentService.receiveUpload(token, payload, req.headers['content-type']);
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
      return reply.code(500).send({ error: 'unable to store attachment' });
    }
  });
}

