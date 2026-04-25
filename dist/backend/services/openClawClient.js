"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openClawClient = exports.OpenClawClient = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
class OpenClawClient {
    command = process.env.OPENCLAW_COMMAND || 'openclaw';
    agentId = process.env.OPENCLAW_AGENT_ID || 'email-claw';
    timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS || 30000);
    isEnabled() {
        return process.env.OPENCLAW_ENABLED === 'true';
    }
    async analyzeEmail(email) {
        const prompt = this.buildPrompt(email);
        const { stdout } = await execFileAsync(this.command, [
            'agent',
            '--agent',
            this.agentId,
            '--message',
            prompt,
            '--json',
            '--local',
        ], {
            timeout: this.timeoutMs,
            maxBuffer: 1024 * 1024,
        });
        const raw = this.parseJson(stdout);
        return this.normalizeResult(raw);
    }
    buildPrompt(email) {
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
    parseJson(output) {
        const trimmed = output.trim();
        try {
            return JSON.parse(trimmed);
        }
        catch {
            const match = trimmed.match(/\{[\s\S]*\}/);
            if (!match) {
                throw new Error(`OpenClaw did not return JSON: ${trimmed.slice(0, 300)}`);
            }
            return JSON.parse(match[0]);
        }
    }
    normalizeResult(raw) {
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
    normalizeCategory(category) {
        const allowed = ['work', 'personal', 'shopping', 'marketing', 'spam', 'other'];
        return allowed.includes(category) ? category : 'other';
    }
    clampNumber(value, min, max, fallback) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return fallback;
        }
        return Math.max(min, Math.min(max, value));
    }
}
exports.OpenClawClient = OpenClawClient;
exports.openClawClient = new OpenClawClient();
