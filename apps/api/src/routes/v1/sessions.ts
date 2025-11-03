import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';

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
}

