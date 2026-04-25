"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClassificationSkill = void 0;
const emailTextTools_1 = require("../tools/emailTextTools");
const MODEL_NAME = 'local-rule-agent-v0';
const CATEGORY_KEYWORDS = {
    work: [
        '会议',
        '项目',
        '任务',
        '需求',
        '排期',
        'deadline',
        'meeting',
        'project',
        'task',
        'review'
    ],
    personal: ['朋友', '家人', '生日', '聚餐', '旅行', 'personal', 'family', 'birthday'],
    shopping: ['订单', '物流', '快递', '发货', '支付成功', 'order', 'shipping', 'delivery', 'invoice'],
    marketing: ['优惠', '促销', '订阅', 'newsletter', 'sale', 'discount', 'subscribe', 'campaign'],
    spam: ['中奖', '免费领取', '博彩', '贷款', 'urgent transfer', 'lottery', 'casino'],
    other: []
};
const IMPORTANT_KEYWORDS = [
    '截止',
    '紧急',
    '重要',
    '尽快',
    '会议',
    'deadline',
    'urgent',
    'asap',
    'important',
    'meeting'
];
class ClassificationSkill {
    execute(email) {
        const text = (0, emailTextTools_1.normalizeEmailText)(email);
        const category = this.detectCategory(text);
        const confidence = category === 'other' ? 0.5 : 0.72;
        return {
            category,
            confidence,
            reasoning: this.buildReasoning(category),
            toolsUsed: ['normalize_email_text', 'keyword_match'],
            executionSteps: [
                '读取邮件标题、发件人、正文和附件信息',
                '归一化邮件文本',
                '使用关键词规则进行初步分类'
            ],
            model: MODEL_NAME
        };
    }
    evaluateImportance(email) {
        const text = (0, emailTextTools_1.normalizeEmailText)(email);
        const hasImportantSignal = (0, emailTextTools_1.containsAnyKeyword)(text, IMPORTANT_KEYWORDS);
        const hasAttachment = email.attachments.length > 0;
        const score = Math.min(10, 3 + (hasImportantSignal ? 4 : 0) + (hasAttachment ? 1 : 0));
        return {
            score,
            reasoning: hasImportantSignal
                ? '邮件包含紧急、截止、会议或任务相关信号，建议优先处理。'
                : '暂未发现明显紧急信号，按普通邮件处理。'
        };
    }
    summarize(email) {
        return {
            summary: (0, emailTextTools_1.createBriefSummary)(email)
        };
    }
    detectCategory(text) {
        const orderedCategories = ['spam', 'work', 'shopping', 'marketing', 'personal'];
        return orderedCategories.find((category) => (0, emailTextTools_1.containsAnyKeyword)(text, CATEGORY_KEYWORDS[category])) || 'other';
    }
    buildReasoning(category) {
        const descriptions = {
            work: '邮件内容命中了项目、会议、任务或工作协作相关特征。',
            personal: '邮件内容更接近个人生活或熟人沟通场景。',
            shopping: '邮件内容包含订单、物流、支付或发票相关特征。',
            marketing: '邮件内容包含订阅、促销、优惠或营销活动特征。',
            spam: '邮件内容包含高风险垃圾邮件或诱导性关键词。',
            other: '暂未匹配到明确类别，先归入其他。'
        };
        return descriptions[category];
    }
}
exports.ClassificationSkill = ClassificationSkill;
