import { ClassificationSkill } from '../../agents/skills/classificationSkill';
import { EmailAgentResult, EmailAnalysisInput } from '../../agents/types/emailAgent';
import { databaseService } from './databaseService';
import { openClawClient } from './openClawClient';

export class AgentService {
  private readonly classificationSkill = new ClassificationSkill();

  async analyzeEmail(input: EmailAnalysisInput): Promise<EmailAgentResult> {
    const startedAt = Date.now();
    const analysis = await this.runAnalysis(input);
    const duration = Date.now() - startedAt;

    await databaseService.saveEmailAnalysis(input.userId, input.email.uid, {
      ...analysis,
      duration
    });

    return analysis;
  }

  private async runAnalysis(input: EmailAnalysisInput): Promise<EmailAgentResult> {
    if (openClawClient.isEnabled()) {
      try {
        return await openClawClient.analyzeEmail(input.email);
      } catch (error) {
        console.warn('⚠️ OpenClaw 分析失败，回退到本地规则 Agent:', error);
      }
    }

    const classification = this.classificationSkill.execute(input.email);
    const importance = this.classificationSkill.evaluateImportance(input.email);
    const summary = this.classificationSkill.summarize(input.email);

    return { classification, importance, summary };
  }
}

export const agentService = new AgentService();
