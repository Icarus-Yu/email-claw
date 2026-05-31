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

    // DeepSeek 等模型偶发会无视指令（包 markdown 围栏 / 输出非法 JSON）。
    // 这是无状态分析，安全可重试：失败时换个 session key 再跑一次，
    // 两次都失败才抛出，由 agentService 回退本地规则。
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stdout = await this.runAgentOnce(email, prompt);
        const raw = this.parseJson(stdout);
        return this.normalizeResult(raw);
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          console.warn('⚠️ OpenClaw 首次解析失败，重试一次:', (error as Error)?.message);
        }
      }
    }
    throw lastError;
  }

  private async runAgentOnce(email: SimpleEmail, prompt: string): Promise<string> {
    // 每封邮件用独立 session key：分析是无状态的，且后端会并发拉起多个
    // `--local` 子进程，共用默认会话会触发 EmbeddedAttemptSessionTakeoverError
    // （多个进程抢同一个 session 文件锁）。唯一 session key 让它们彼此隔离。
    const sessionKey = `email-${email.uid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { stdout } = await execFileAsync(
      this.command,
      [
        'agent',
        '--agent',
        this.agentId,
        '--session-key',
        sessionKey,
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

    return stdout;
  }

  private buildPrompt(email: SimpleEmail): string {
    return [
      '请作为 EmailClaw 邮件分析 Agent 分析下面这封邮件。',
      '你必须只返回一个合法的 JSON 对象，不要返回 Markdown 代码块、围栏(```)或任何解释文字。',
      '字符串值中若包含双引号或换行，必须正确转义，确保整段可被 JSON.parse 直接解析。',
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

    // `openclaw agent --json` 返回信封：{ payloads: [{ text }], meta }
    // 真正的分析 JSON 在 payloads[0].text 里，需要先拆出来再解析。
    let inner = trimmed;
    try {
      const envelope = JSON.parse(trimmed);
      if (envelope && Array.isArray(envelope.payloads)) {
        inner = envelope.payloads
          .map((p: any) => (p && typeof p.text === 'string' ? p.text : ''))
          .join('\n')
          .trim();
      } else if (envelope && typeof envelope === 'object' && 'category' in envelope) {
        // 兼容：万一某个版本直接返回了裸分析对象
        return envelope as OpenClawRawResult;
      }
    } catch {
      // stdout 不是合法 JSON 信封，按原始文本继续走下面的兜底解析
    }

    // 模型偶尔无视指令把 JSON 包进 ```json ... ``` 围栏，先剥掉
    inner = inner
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(inner);
    } catch {
      const match = inner.match(/\{[\s\S]*\}/);
      if (!match) {
        throw new Error(`OpenClaw did not return JSON: ${inner.slice(0, 300)}`);
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
