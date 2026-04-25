"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentService = exports.AgentService = void 0;
const classificationSkill_1 = require("../../agents/skills/classificationSkill");
const databaseService_1 = require("./databaseService");
const openClawClient_1 = require("./openClawClient");
class AgentService {
    classificationSkill = new classificationSkill_1.ClassificationSkill();
    async analyzeEmail(input) {
        const startedAt = Date.now();
        const analysis = await this.runAnalysis(input);
        const duration = Date.now() - startedAt;
        await databaseService_1.databaseService.saveEmailAnalysis(input.userId, input.email.uid, {
            ...analysis,
            duration
        });
        return analysis;
    }
    async runAnalysis(input) {
        if (openClawClient_1.openClawClient.isEnabled()) {
            try {
                return await openClawClient_1.openClawClient.analyzeEmail(input.email);
            }
            catch (error) {
                console.warn('⚠️ OpenClaw 分析失败，回退到本地规则 Agent:', error);
            }
        }
        const classification = this.classificationSkill.execute(input.email);
        const importance = this.classificationSkill.evaluateImportance(input.email);
        const summary = this.classificationSkill.summarize(input.email);
        return { classification, importance, summary };
    }
}
exports.AgentService = AgentService;
exports.agentService = new AgentService();
