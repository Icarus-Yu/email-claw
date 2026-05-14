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
      data: { isArchived: true },
    });
  }

  async saveClassificationFeedback(
    emailId: string,
    feedback: string,
    expectedCategory?: string,
    comment?: string
  ) {
    return prisma.classification.update({
      where: { emailId },
      data: {
        feedback,
        ...(expectedCategory ? { category: expectedCategory } : {}),
        ...(comment ? { reasoning: comment } : {}),
      },
    });
  }

  async getEmailById(emailId: string) {
    return prisma.email.findUnique({
      where: { id: emailId },
    });
  }
}

export const databaseService = new DatabaseService();
