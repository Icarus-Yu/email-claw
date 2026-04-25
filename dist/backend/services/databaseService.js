"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseService = exports.DatabaseService = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
class DatabaseService {
    /**
     * 保存或更新邮件
     */
    async upsertEmail(userId, emailData) {
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
    async saveEmailAnalysis(userId, uid, result) {
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
    async logAgentAction(data) {
        return prisma.agentLog.create({
            data,
        });
    }
    /**
     * 获取用户信息（包含 IMAP 配置）
     */
    async getUserById(userId) {
        return prisma.user.findUnique({
            where: { id: userId },
        });
    }
}
exports.DatabaseService = DatabaseService;
exports.databaseService = new DatabaseService();
