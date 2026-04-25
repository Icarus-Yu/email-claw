import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SimpleEmail } from './emailService';
import type { EmailAgentResult, EmailCategory } from '../../agents/types/emailAgent';

const execFileAsync = promisify(execFile);

interface OpenClawRawResult {
  category?: string;
  confidence?: number;
  classificationReasoning?: string;
  importance?: number;
  importanceReasoning?: string;
  summary?: string;
}

export class OpenClawClient {
  private readonly command = process.env.OPENCLAW_COMMAND || 'openclaw';
  private readonly agentId = process.env.OPENCLAW_AGENT_ID || 'email-claw';
  private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS || 30000);

  isEnabled(): boolean {
    return process.env.OPENCLAW_ENABLED === 'true';
  }

  async analyzeEmail(email: SimpleEmail): Promise<EmailAgentResult> {
    const prompt = this.buildPrompt(email);
    const { stdout } = await execFileAsync(
      this.command,
      [
        'agent',
        '--agent',
        this.agentId,
        '--message',
        prompt,
        '--json',
        '--local',
      ],
      {
        timeout: this.timeoutMs,
        maxBuffer: 1024 * 1024,
      }
    );

    const raw = this.parseJson(stdout);
    return this.normalizeResult(raw);
  }

  private buildPrompt(email: SimpleEmail): string {
    return [
      '请作为 EmailClaw 邮件分析 Agent 分析下面这封邮件。',
      '你必须只返回 JSON，不要返回 Markdown 或解释文字。',
      'JSON 字段格式如下：',
      '{"category":"work|personal|shopping|marketing|spam|other","confidence":0.8,"classificationReasoning":"...","importance":7,"importanceReasoning":"...","summary":"..."}',
      '',
      `UID: ${email.uid}`,
      `Message-ID: ${email.messageId}`,
      `Subject: ${email.subject}`,
      `From: ${email.from}`,
      `To: ${email.to}`,
      `Date: ${email.date.toISOString()}`,
      `Attachments: ${email.attachments.map((item) => item.filename || item.contentType).join(', ') || 'none'}`,
      '',
      'Body:',
      email.text.slice(0, 6000),
    ].join('\n');
  }

  private parseJson(output: string): OpenClawRawResult {
    const trimmed = output.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error(`OpenClaw did not return JSON: ${trimmed.slice(0, 300)}`);
      }

      return JSON.parse(match[0]);
    }
  }

  private normalizeResult(raw: OpenClawRawResult): EmailAgentResult {
    const category = this.normalizeCategory(raw.category);
    const importance = this.clampNumber(raw.importance, 0, 10, 3);

    return {
      classification: {
        category,
        confidence: this.clampNumber(raw.confidence, 0, 1, 0.6),
        reasoning: raw.classificationReasoning || 'OpenClaw returned no classification reasoning.',
        toolsUsed: ['openclaw_agent'],
        executionSteps: ['Send structured email prompt to OpenClaw', 'Parse OpenClaw JSON response'],
        model: 'openclaw-agent',
      },
      importance: {
        score: importance,
        reasoning: raw.importanceReasoning || 'OpenClaw returned no importance reasoning.',
      },
      summary: {
        summary: raw.summary || 'OpenClaw returned no summary.',
      },
    };
  }

  private normalizeCategory(category?: string): EmailCategory {
    const allowed: EmailCategory[] = ['work', 'personal', 'shopping', 'marketing', 'spam', 'other'];
    return allowed.includes(category as EmailCategory) ? (category as EmailCategory) : 'other';
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return fallback;
    }

    return Math.max(min, Math.min(max, value));
  }
}

export const openClawClient = new OpenClawClient();
