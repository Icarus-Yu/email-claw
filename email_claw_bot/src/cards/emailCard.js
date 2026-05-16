/**
 * 飞书邮件通知卡片构建器
 *
 * 根据后端传入的邮件分析数据，构建飞书交互式卡片 JSON。
 * 文档: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-components
 */

/** 分类 → 卡片 header 颜色映射 */
const CATEGORY_COLORS = {
  work: 'blue',
  personal: 'green',
  shopping: 'yellow',
  marketing: 'purple',
  spam: 'red',
  other: 'grey',
};

/** 分类中文标签 */
const CATEGORY_LABELS = {
  work: '工作',
  personal: '个人',
  shopping: '购物',
  marketing: '营销',
  spam: '垃圾',
  other: '其他',
};

/**
 * 构建邮件通知卡片 JSON
 * @param {object} email - 邮件分析数据（与飞书前端对接文档约定的字段一致）
 * @returns {object} 飞书卡片 JSON
 */
function buildEmailCard(email) {
  const color = CATEGORY_COLORS[email.category] || 'grey';
  const categoryLabel = CATEGORY_LABELS[email.category] || email.category;
  const canOperate = !email.isDeleted;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: email.subject || '(无主题)' },
      template: color,
    },
    elements: [
      // --- 邮件基本信息 ---
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**发件人**\n${escapeMd(email.from)}` },
          },
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**收件人**\n${escapeMd(email.to)}` },
          },
        ],
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**时间** ${formatTime(email.receivedAt)}`,
        },
      },
      { tag: 'hr' },

      // --- AI 分析结果 ---
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**📂 分类** ${categoryLabel}\n置信度 ${Math.round((email.confidence || 0) * 100)}%`,
            },
          },
          {
            is_short: true,
            text: {
              tag: 'lark_md',
              content: `**⭐ 重要性** ${importanceStars(email.importance || 0)}`,
            },
          },
        ],
      },
      { tag: 'hr' },

      // --- 邮件摘要 ---
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📝 摘要**\n${escapeMd(email.summary || '暂无摘要')}`,
        },
      },

      // --- 分类理由 ---
      ...(email.classificationReasoning
        ? [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `**💡 分类理由**\n${escapeMd(email.classificationReasoning)}`,
              },
            },
          ]
        : []),

      // --- 状态标记 ---
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `状态: ${buildStatusText(email)}`,
        },
      },
      { tag: 'hr' },

      // --- 操作按钮区域 ---
      ...(canOperate ? buildActionElements(email) : []),

      // --- 底部备注 ---
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `EmailClaw · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
          },
        ],
      },
    ],
  };
}

function buildActionElements(email) {
  return [
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '📖 标为已读' },
          type: 'primary',
          value: { action: 'mark_read', emailId: email.emailId },
        },
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '⭐ 标为重点' },
          type: 'default',
          value: { action: 'mark_important', emailId: email.emailId },
        },
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '📦 归档' },
          type: 'default',
          value: { action: 'archive', emailId: email.emailId },
        },
      ],
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '✅ 分类正确' },
          type: 'default',
          value: { action: 'feedback_correct', emailId: email.emailId },
        },
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '❌ 分类错误' },
          type: 'danger',
          value: { action: 'feedback_wrong', emailId: email.emailId },
        },
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '🔍 查看详情' },
          type: 'default',
          value: { action: 'view_detail', emailId: email.emailId },
        },
      ],
    },
    {
      tag: 'action',
      actions: [
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '🗑 删除' },
          type: 'danger',
          value: { action: 'delete', emailId: email.emailId },
          confirm: {
            title: { tag: 'plain_text', content: '确认删除' },
            text: {
              tag: 'lark_md',
              content: '该操作将从邮箱中真实删除此邮件，不可恢复。确定继续？',
            },
          },
        },
        {
          tag: 'button',
          text: { tag: 'lark_md', content: '🔄 重新分析' },
          type: 'default',
          value: { action: 'reanalyze', emailId: email.emailId },
        },
      ],
    },
  ];
}

function buildStatusText(email) {
  if (email.isDeleted) return '🗑 已删除';
  return `${email.isRead ? '✅ 已读' : '📬 未读'} | ${email.isArchived ? '📦 已归档' : '📂 收件箱'}`;
}

/**
 * 构建"分类错误"时的分类选择卡片
 * 用户点击"分类错误"后，返回此卡片让用户选择正确分类
 *
 * @param {string} emailId - 邮件 ID
 * @returns {object} 飞书卡片 JSON
 */
function buildCategoryPickerCard(emailId) {
  const categories = [
    { value: 'work', label: '工作', emoji: '💼' },
    { value: 'personal', label: '个人', emoji: '👤' },
    { value: 'shopping', label: '购物', emoji: '🛒' },
    { value: 'marketing', label: '营销', emoji: '📢' },
    { value: 'spam', label: '垃圾', emoji: '🗑' },
    { value: 'other', label: '其他', emoji: '📋' },
  ];

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '请选择正确的分类' },
      template: 'yellow',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '请为此邮件选择正确的分类：',
        },
      },
      {
        tag: 'action',
        actions: categories.map((cat) => ({
          tag: 'button',
          text: { tag: 'lark_md', content: `${cat.emoji} ${cat.label}` },
          type: 'default',
          value: {
            action: 'feedback_wrong',
            emailId,
            expectedCategory: cat.value,
          },
        })),
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: '选择一个分类后，系统将记录此次纠错，帮助 AI 持续优化。',
          },
        ],
      },
    ],
  };
}

/**
 * 构建操作结果通知卡片（替换原卡片或单独发送）
 *
 * @param {string} action - 操作名称
 * @param {string} result - 操作结果描述
 * @param {string} emailSubject - 邮件标题
 * @returns {object} 飞书卡片 JSON
 */
function buildActionResultCard(action, result, emailSubject) {
  const actionLabels = {
    mark_read: '已标记为已读',
    mark_important: '已标为重点',
    archive: '已归档',
    delete: '已删除',
    feedback_correct: '反馈已记录',
    feedback_wrong: '纠错反馈已记录',
    reanalyze: '重新分析已触发',
  };

  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: actionLabels[action] || `操作完成: ${action}`,
      },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**邮件** ${escapeMd(emailSubject)}\n\n${escapeMd(result)}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `EmailClaw · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
          },
        ],
      },
    ],
  };
}

function buildEmailDetailCard(detail) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: detail.subject || '(无主题)' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**发件人**\n${escapeMd(detail.from)}` },
          },
          {
            is_short: true,
            text: { tag: 'lark_md', content: `**收件人**\n${escapeMd(detail.to)}` },
          },
        ],
      },
      {
        tag: 'div',
        text: { tag: 'lark_md', content: `**时间** ${formatTime(detail.receivedAt)}` },
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**分类** ${CATEGORY_LABELS[detail.category] || detail.category || '其他'} | **重要性** ${detail.importance ?? 0}/10`,
        },
      },
      ...(detail.summary
        ? [
            {
              tag: 'div',
              text: { tag: 'lark_md', content: `**摘要**\n${escapeMd(detail.summary)}` },
            },
          ]
        : []),
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**正文预览**\n${escapeMd(detail.body || '暂无正文')}`,
        },
      },
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: `EmailClaw · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
          },
        ],
      },
    ],
  };
}

// --- 辅助函数 ---

/**
 * 飞书 Markdown 中需转义的字符
 */
function escapeMd(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/`/g, '\\`')
    .replace(/~/g, '\\~')
    .replace(/\$/g, '\\$');
}

/**
 * 格式化 ISO 时间为可读字符串
 */
function formatTime(isoString) {
  if (!isoString) return '未知';
  return new Date(isoString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

/**
 * 重要性 0-10 转星星显示
 */
function importanceStars(score) {
  const num = Math.round(score);
  const filled = '★'.repeat(Math.min(num, 10));
  const empty = '☆'.repeat(Math.max(10 - num, 0));
  return `${filled}${empty} (${score}/10)`;
}

module.exports = {
  buildEmailCard,
  buildCategoryPickerCard,
  buildActionResultCard,
  buildEmailDetailCard,
};
