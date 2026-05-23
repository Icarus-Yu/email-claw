/**
 * 规则引擎
 *
 * 在 Agent 之前运行。匹配命中则跳过 Agent，直接产出分类结果。
 *
 * 规则数据结构（存 Prisma Rule.conditions / Rule.actions JSON）：
 *
 *   conditions: {
 *     field: 'from' | 'to' | 'subject' | 'body',
 *     operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex',
 *     value: string,
 *     caseSensitive?: boolean
 *   }
 *   // 也支持数组（AND 关系）
 *
 *   actions: {
 *     category?: 'work' | 'personal' | 'shopping' | 'marketing' | 'spam' | 'other',
 *     importance?: number,   // 0-10
 *     summary?: string,
 *     sideEffects?: Array<'mark_read' | 'archive' | 'delete'>
 *   }
 */

import { databaseService } from './databaseService';
import { createBriefSummary } from '../../agents/tools/emailTextTools';
import type { SimpleEmail } from './userMailbox';
import type {
  EmailAgentResult,
  EmailCategory,
} from '../../agents/types/emailAgent';

type SideEffect = 'mark_read' | 'archive' | 'delete';

interface RuleCondition {
  field: 'from' | 'to' | 'subject' | 'body';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';
  value: string;
  caseSensitive?: boolean;
}

interface RuleActions {
  category?: EmailCategory;
  importance?: number;
  summary?: string;
  sideEffects?: SideEffect[];
}

export interface RuleHit {
  ruleId: string;
  ruleName: string;
  result: EmailAgentResult;
  sideEffects: SideEffect[];
}

const VALID_CATEGORIES: EmailCategory[] = [
  'work',
  'personal',
  'shopping',
  'marketing',
  'spam',
  'other',
];

const VALID_SIDE_EFFECTS: SideEffect[] = ['mark_read', 'archive', 'delete'];

class RuleEngine {
  /**
   * 按优先级评估用户规则，返回首个命中的规则及合成的 EmailAgentResult。
   * 没命中返回 null。
   */
  async evaluate(userId: string, email: SimpleEmail): Promise<RuleHit | null> {
    const rules = await databaseService.listEnabledRules(userId);
    if (!rules.length) return null;

    for (const rule of rules) {
      const conditions = normalizeConditions(rule.conditions);
      if (!conditions.length) continue;
      const matched = conditions.every((c) => matchCondition(c, email));
      if (!matched) continue;

      const actions = normalizeActions(rule.actions);
      if (!actions.category) {
        // 没指定分类则视为不完整规则，跳过
        console.warn(`⚠️ 规则 ${rule.id} 未指定 category，跳过`);
        continue;
      }

      const result: EmailAgentResult = {
        classification: {
          category: actions.category,
          confidence: 1,
          reasoning: `命中用户规则: ${rule.name}`,
          toolsUsed: ['rule_engine'],
          executionSteps: [`匹配规则 ${rule.name}（id=${rule.id}）`],
          model: 'rule-engine-v1',
        },
        importance: {
          score: clamp(actions.importance ?? 5, 0, 10),
          reasoning: actions.importance !== undefined
            ? '规则指定的重要性'
            : '规则未指定，按中等重要性 5 处理',
        },
        summary: {
          summary: actions.summary || createBriefSummary(email),
        },
      };

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        result,
        sideEffects: actions.sideEffects || [],
      };
    }
    return null;
  }

  /**
   * 校验前端传入的规则定义（创建/更新时用）
   * 失败抛错（带可读信息）
   */
  validateDefinition(input: { conditions: any; actions: any }) {
    const conditions = normalizeConditions(input.conditions);
    if (!conditions.length) {
      throw new Error('conditions 至少需要一个条件');
    }
    for (const c of conditions) {
      if (!['from', 'to', 'subject', 'body'].includes(c.field)) {
        throw new Error(`非法 field: ${c.field}`);
      }
      if (!['contains', 'equals', 'startsWith', 'endsWith', 'regex'].includes(c.operator)) {
        throw new Error(`非法 operator: ${c.operator}`);
      }
      if (typeof c.value !== 'string' || !c.value.length) {
        throw new Error('value 必须是非空字符串');
      }
      if (c.operator === 'regex') {
        try {
          new RegExp(c.value);
        } catch {
          throw new Error(`非法 regex: ${c.value}`);
        }
      }
    }

    const actions = normalizeActions(input.actions);
    if (!actions.category) {
      throw new Error('actions.category 必填');
    }
    if (!VALID_CATEGORIES.includes(actions.category)) {
      throw new Error(`非法 category: ${actions.category}`);
    }
    if (actions.importance !== undefined) {
      const n = Number(actions.importance);
      if (!Number.isFinite(n) || n < 0 || n > 10) {
        throw new Error('importance 需在 0-10');
      }
    }
    if (actions.sideEffects) {
      for (const s of actions.sideEffects) {
        if (!VALID_SIDE_EFFECTS.includes(s)) {
          throw new Error(`非法 sideEffect: ${s}`);
        }
      }
    }

    return { conditions, actions };
  }
}

function normalizeConditions(raw: any): RuleCondition[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function normalizeActions(raw: any): RuleActions {
  return (raw || {}) as RuleActions;
}

function matchCondition(c: RuleCondition, email: SimpleEmail): boolean {
  const field = pickField(c.field, email);
  const cs = !!c.caseSensitive;
  const a = cs ? field : field.toLowerCase();
  const b = cs ? c.value : c.value.toLowerCase();

  switch (c.operator) {
    case 'contains': return a.includes(b);
    case 'equals': return a === b;
    case 'startsWith': return a.startsWith(b);
    case 'endsWith': return a.endsWith(b);
    case 'regex':
      try {
        return new RegExp(c.value, cs ? '' : 'i').test(field);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function pickField(field: RuleCondition['field'], email: SimpleEmail): string {
  switch (field) {
    case 'from': return email.from || '';
    case 'to': return email.to || '';
    case 'subject': return email.subject || '';
    case 'body': return email.text || '';
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export const ruleEngine = new RuleEngine();
