/**
 * 规则 CRUD
 *
 * 全部需 JWT。所有操作都强制 userId 隔离（databaseService 内部 updateMany/deleteMany 已校验）。
 */

import { Router, Request, Response } from 'express';
import { databaseService } from '../../services/databaseService';
import { ruleEngine } from '../../services/ruleEngine';
import { requireAuth } from '../../middleware/authMiddleware';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response) => {
  const rules = await databaseService.listRules(req.auth!.userId);
  res.json({ items: rules });
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, conditions, actions, priority, isEnabled } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name 必填' });

    const validated = ruleEngine.validateDefinition({ conditions, actions });

    const rule = await databaseService.createRule(req.auth!.userId, {
      name,
      description,
      conditions: validated.conditions,
      actions: validated.actions,
      priority,
      isEnabled,
    });
    res.status(201).json(rule);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const data: any = {};
    const { name, description, conditions, actions, priority, isEnabled } = req.body || {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (priority !== undefined) data.priority = priority;
    if (isEnabled !== undefined) data.isEnabled = !!isEnabled;
    if (conditions !== undefined || actions !== undefined) {
      // 部分更新时需要拿现有值合并校验
      const validated = ruleEngine.validateDefinition({
        conditions: conditions ?? [],
        actions: actions ?? {},
      });
      if (conditions !== undefined) data.conditions = validated.conditions;
      if (actions !== undefined) data.actions = validated.actions;
    }
    const rule = await databaseService.updateRule(req.auth!.userId, String(req.params.id), data);
    res.json(rule);
  } catch (e: any) {
    const code = e.message.includes('无权限') || e.message.includes('不存在') ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await databaseService.deleteRule(req.auth!.userId, String(req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

export default router;
