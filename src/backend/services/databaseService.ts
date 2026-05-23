import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import type { EmailAgentResult } from '../../agents/types/emailAgent';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

export class DatabaseService {
  /**
   * 保存或更新邮件
   */
  async upsertEmail(userId: string, emailData: any) {
    return prisma.email.upsert({
      where: {
        userId_uid: {
          userId,
          uid: emailData.uid,
        },
      },
      update: {
        ...emailData,
        updatedAt: new Date(),
      },
      create: {
        userId,
        ...emailData,
      },
    });
  }

  /**
   * 保存 Agent 对邮件的分析结果
   */
  async saveEmailAnalysis(
    userId: string,
    uid: number,
    result: EmailAgentResult & { duration: number }
  ) {
    const email = await prisma.email.findUnique({
      where: {
        userId_uid: {
          userId,
          uid,
        },
      },
    });

    if (!email) {
      throw new Error(`Email not found for userId=${userId}, uid=${uid}`);
    }

    await prisma.email.update({
      where: {
        id: email.id,
      },
      data: {
        category: result.classification.category,
        importance: result.importance.score,
        summary: result.summary.summary,
      },
    });

    await prisma.classification.upsert({
      where: {
        emailId: email.id,
      },
      update: {
        category: result.classification.category,
        confidence: result.classification.confidence,
        reasoning: [
          result.classification.reasoning,
          `重要性: ${result.importance.score}/10，${result.importance.reasoning}`,
          `摘要: ${result.summary.summary}`,
        ].join('\n'),
        toolsUsed: result.classification.toolsUsed,
        executionSteps: result.classification.executionSteps,
        model: result.classification.model,
      },
      create: {
        emailId: email.id,
        userId,
        category: result.classification.category,
        confidence: result.classification.confidence,
        reasoning: [
          result.classification.reasoning,
          `重要性: ${result.importance.score}/10，${result.importance.reasoning}`,
          `摘要: ${result.summary.summary}`,
        ].join('\n'),
        toolsUsed: result.classification.toolsUsed,
        executionSteps: result.classification.executionSteps,
        model: result.classification.model,
      },
    });

    await this.logAgentAction({
      userId,
      type: 'classification',
      status: 'success',
      input: {
        emailId: email.id,
        uid,
      },
      output: result,
      model: result.classification.model,
      duration: result.duration,
    });
  }

  /**
   * 记录 Agent 执行日志
   */
  async logAgentAction(data: any) {
    return prisma.agentLog.create({
      data,
    });
  }

  /**
   * 获取用户信息（包含 IMAP 配置）
   */
  async getUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
    });
  }

  // ========== 飞书回调触发的操作 ==========

  async markEmailRead(emailId: string) {
    return prisma.email.update({
      where: { id: emailId },
      data: { isRead: true },
    });
  }

  async markEmailImportant(emailId: string) {
    return prisma.email.update({
      where: { id: emailId },
      data: { importance: 10 },
    });
  }

  async archiveEmail(emailId: string) {
    return prisma.email.update({
      where: { id: emailId },
      data: { isArchived: true },
    });
  }

  async markEmailDeleted(emailId: string) {
    return prisma.email.update({
      where: { id: emailId },
      data: { isDeleted: true, isArchived: true },
    });
  }

  async saveClassificationFeedback(
    emailId: string,
    feedback: string,
    expectedCategory?: string,
    comment?: string
  ) {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: { userId: true },
    });

    if (!email) {
      throw new Error(`Email not found: ${emailId}`);
    }

    if (expectedCategory) {
      await prisma.email.update({
        where: { id: emailId },
        data: { category: expectedCategory },
      });
    }

    return prisma.classification.upsert({
      where: { emailId },
      update: {
        feedback,
        ...(expectedCategory ? { category: expectedCategory } : {}),
        ...(comment ? { reasoning: comment } : {}),
      },
      create: {
        emailId,
        userId: email.userId,
        category: expectedCategory || 'other',
        confidence: 1,
        reasoning: comment || `用户反馈: ${feedback}`,
        toolsUsed: ['user_feedback'],
        executionSteps: ['Record classification feedback from Feishu card'],
        model: 'user-feedback',
        feedback,
      },
    });
  }

  async getEmailById(emailId: string) {
    return prisma.email.findUnique({
      where: { id: emailId },
      include: { classification: true },
    });
  }

  async updateEmailAnalysisById(
    emailId: string,
    userId: string,
    result: EmailAgentResult & { duration: number }
  ) {
    await prisma.email.update({
      where: { id: emailId },
      data: {
        category: result.classification.category,
        importance: result.importance.score,
        summary: result.summary.summary,
      },
    });

    await prisma.classification.upsert({
      where: { emailId },
      update: {
        category: result.classification.category,
        confidence: result.classification.confidence,
        reasoning: [
          result.classification.reasoning,
          `重要性: ${result.importance.score}/10，${result.importance.reasoning}`,
          `摘要: ${result.summary.summary}`,
        ].join('\n'),
        toolsUsed: result.classification.toolsUsed,
        executionSteps: result.classification.executionSteps,
        model: result.classification.model,
      },
      create: {
        emailId,
        userId,
        category: result.classification.category,
        confidence: result.classification.confidence,
        reasoning: [
          result.classification.reasoning,
          `重要性: ${result.importance.score}/10，${result.importance.reasoning}`,
          `摘要: ${result.summary.summary}`,
        ].join('\n'),
        toolsUsed: result.classification.toolsUsed,
        executionSteps: result.classification.executionSteps,
        model: result.classification.model,
      },
    });

    await this.logAgentAction({
      userId,
      type: 'reanalyze',
      status: 'success',
      input: { emailId },
      output: result,
      model: result.classification.model,
      duration: result.duration,
    });

    return this.getEmailById(emailId);
  }

  // ========== 用户与认证 ==========

  async createUser(data: {
    email: string;
    passwordHash: string;
  }) {
    return prisma.user.create({
      data: { email: data.email, password: data.passwordHash },
    });
  }

  async getUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async getUserByFeishuOpenId(openId: string) {
    return prisma.user.findFirst({ where: { feishuUserId: openId } });
  }

  async updateUser(userId: string, data: any) {
    return prisma.user.update({ where: { id: userId }, data });
  }

  async listUsersWithMailbox() {
    return prisma.user.findMany({
      where: {
        imapHost: { not: null },
        imapUser: { not: null },
        imapPassword: { not: null },
      },
    });
  }

  // ========== 规则 ==========

  async listRules(userId: string) {
    return prisma.rule.findMany({
      where: { userId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async listEnabledRules(userId: string) {
    return prisma.rule.findMany({
      where: { userId, isEnabled: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createRule(userId: string, data: any) {
    return prisma.rule.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        conditions: data.conditions,
        actions: data.actions,
        priority: data.priority ?? 0,
        isEnabled: data.isEnabled ?? true,
      },
    });
  }

  async updateRule(userId: string, ruleId: string, data: any) {
    // 防御性：必须命中本人
    const result = await prisma.rule.updateMany({
      where: { id: ruleId, userId },
      data,
    });
    if (result.count === 0) {
      throw new Error('规则不存在或无权限');
    }
    return prisma.rule.findUnique({ where: { id: ruleId } });
  }

  async deleteRule(userId: string, ruleId: string) {
    const result = await prisma.rule.deleteMany({ where: { id: ruleId, userId } });
    if (result.count === 0) {
      throw new Error('规则不存在或无权限');
    }
  }

  // ========== 邮件搜索 ==========

  async searchEmails(userId: string, filters: {
    category?: string;
    sender?: string;
    dateFrom?: Date;
    dateTo?: Date;
    importanceMin?: number;
    importanceMax?: number;
    q?: string;
    isRead?: boolean;
    isArchived?: boolean;
    isDeleted?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));

    const where: any = { userId };
    if (filters.category) where.category = filters.category;
    if (filters.sender) where.from = { contains: filters.sender, mode: 'insensitive' };
    if (filters.dateFrom || filters.dateTo) {
      where.receivedAt = {};
      if (filters.dateFrom) where.receivedAt.gte = filters.dateFrom;
      if (filters.dateTo) where.receivedAt.lte = filters.dateTo;
    }
    if (filters.importanceMin !== undefined || filters.importanceMax !== undefined) {
      where.importance = {};
      if (filters.importanceMin !== undefined) where.importance.gte = filters.importanceMin;
      if (filters.importanceMax !== undefined) where.importance.lte = filters.importanceMax;
    }
    if (filters.isRead !== undefined) where.isRead = filters.isRead;
    if (filters.isArchived !== undefined) where.isArchived = filters.isArchived;
    if (filters.isDeleted !== undefined) where.isDeleted = filters.isDeleted;
    if (filters.q) {
      where.OR = [
        { subject: { contains: filters.q, mode: 'insensitive' } },
        { from: { contains: filters.q, mode: 'insensitive' } },
        { body: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.email.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          from: true,
          to: true,
          subject: true,
          category: true,
          importance: true,
          summary: true,
          isRead: true,
          isArchived: true,
          isDeleted: true,
          receivedAt: true,
        },
      }),
      prisma.email.count({ where }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /** 防御性：校验某封邮件属于某用户 */
  async assertEmailOwnership(emailId: string, userId: string) {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: { userId: true },
    });
    if (!email) {
      throw new Error('邮件不存在');
    }
    if (email.userId !== userId) {
      throw new Error('无权操作此邮件');
    }
  }

  /** 用于联系人维护（鉴权用） */
  prisma() {
    return prisma;
  }
}

export const databaseService = new DatabaseService();
