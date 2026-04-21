import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

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
}

export const databaseService = new DatabaseService();
