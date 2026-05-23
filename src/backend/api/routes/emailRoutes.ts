/**
 * 邮件搜索 / 详情 API
 *
 * GET  /api/emails        分页搜索（参数详见 query schema）
 * GET  /api/emails/:id    单封详情（必须属于当前用户）
 *
 * 全部 JWT 鉴权 + userId 过滤，防止越权读取。
 */

import { Router, Request, Response } from 'express';
import { databaseService } from '../../services/databaseService';
import { requireAuth } from '../../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

function parseBool(v: any): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === 'true' || v === '1' || v === true) return true;
  if (v === 'false' || v === '0' || v === false) return false;
  return undefined;
}

function parseInt0(v: any): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseDate0(v: any): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await databaseService.searchEmails(req.auth!.userId, {
      category: (req.query.category as string) || undefined,
      sender: (req.query.sender as string) || undefined,
      dateFrom: parseDate0(req.query.dateFrom),
      dateTo: parseDate0(req.query.dateTo),
      importanceMin: parseInt0(req.query.importanceMin),
      importanceMax: parseInt0(req.query.importanceMax),
      q: (req.query.q as string) || undefined,
      isRead: parseBool(req.query.isRead),
      isArchived: parseBool(req.query.isArchived),
      isDeleted: parseBool(req.query.isDeleted),
      page: parseInt0(req.query.page),
      pageSize: parseInt0(req.query.pageSize),
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    await databaseService.assertEmailOwnership(String(req.params.id), req.auth!.userId);
    const email = await databaseService.getEmailById(String(req.params.id));
    res.json(email);
  } catch (e: any) {
    const code = e.message.includes('无权') ? 403 : e.message.includes('不存在') ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

export default router;
