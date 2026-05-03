import { Router } from 'express';
import { SessionStatus } from '@prisma/client';
import { prisma } from '../prisma';

const router = Router();

// GET /api/sessions
// Paramètre optionnel : ?status=OPEN|CLOSED|CANCELLED
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;

    const sessions = await prisma.session.findMany({
      where: status ? { status: status as SessionStatus } : undefined,
      orderBy: { startDate: 'asc' },
      include: {
        hostSchool: true,
        _count: { select: { participants: true } },
      },
    });

    const result = sessions.map((session) => ({
      ...session,
      participantCount: session._count.participants,
    }));

    res.json({ data: result, total: result.length });
  } catch (error) {
    next(error);
  }
});

// GET /api/sessions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: {
        hostSchool: true,
        participants: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) return res.status(404).json({ error: 'Session introuvable.' });
    res.json({ data: session });
  } catch (error) {
    next(error);
  }
});

// GET /api/sessions/:id/stats
router.get('/:id/stats', async (req, res, next) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
    });

    if (!session) return res.status(404).json({ error: 'Session introuvable.' });

    const participants = await prisma.participant.findMany({
      where: { sessionId: session.id },
      include: {
        convention: true,
        originSchool: true,
      },
    });

    const byStatus = {
      registered: participants.filter(p => p.status === 'REGISTERED').length,
      cancelled: participants.filter(p => p.status === 'CANCELLED').length,
      attended: participants.filter(p => p.status === 'ATTENDED').length,
      absent: participants.filter(p => p.status === 'ABSENT').length,
    };

    const nonCancelled = participants.filter(p => p.status !== 'CANCELLED');
    const validated  = nonCancelled.filter(p => p.convention?.status === 'VALIDATED');
    const rate = nonCancelled.length === 0 ? 0 : validated.length / nonCancelled.length;
    const conventionRate = Math.round(rate * 100) / 100;

    const nonCancelledWithSchool = participants.filter(p => p.status !== 'CANCELLED' && p.originSchool);
    const schoolCounts = new Map<string, { schoolId: string; schoolName: string; count: number }>();
    for (const p of nonCancelledWithSchool) {
      const id = p.originSchool!.id;
      const existing = schoolCounts.get(id);
      if (existing) {
        existing.count++;
      } else {
        schoolCounts.set(id, { schoolId: id, schoolName: p.originSchool!.name, count: 1 });
      }
    }
    const topSchools = Array.from(schoolCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    
      res.json({
        sessionId: session.id,
        totalParticipants: participants.length,
        byStatus,
        conventionRate,
        topOriginSchools: topSchools,
      });
  } catch (error) {
    next(error);
  }
});

export default router;
