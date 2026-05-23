/**
 * 卡片按钮点击事件处理器
 *
 * 设计：
 * 1. 飞书 card.action.trigger 回调有 ~3 秒超时，超时会显示红色错误。
 * 2. 后端真实业务（IMAP / DB）可能慢于 3 秒。
 * 3. 因此本 handler 采用"先回 toast，再异步刷新卡片"模式：
 *    - 同步返回一个轻量 toast（"处理中..."）让飞书停止倒计时；
 *    - 在后台 await 后端处理完，再用 im.message.patch 主动更新原卡片；
 *    - "查看详情"则在后台 sendCard 新发一张详情卡片，保留原邮件卡片的操作按钮。
 *
 * 唯一的同步分支是"分类错误"首次点击：需要立刻把分类选择卡片渲染出来，
 * 这一步不依赖后端，直接同步返回 card 即可。
 */

const {
  buildEmailCard,
  buildCategoryPickerCard,
  buildEmailDetailCard,
} = require('../cards/emailCard');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const DEFAULT_OPEN_ID = process.env.DEFAULT_OPEN_ID;
const BOT_SECRET = process.env.FEISHU_BOT_SHARED_SECRET || '';

const ACTION_LABELS = {
  mark_read: '已标为已读',
  mark_important: '已标为重点',
  archive: '已归档',
  delete: '已删除',
  feedback_correct: '反馈已记录',
  feedback_wrong: '纠错反馈已记录',
  reanalyze: '重新分析已完成',
  view_detail: '详情已获取',
};

/**
 * 处理卡片按钮点击回调
 *
 * @param {object} data - 飞书 card.action.trigger 事件数据
 * @param {object} feishuClient - 飞书客户端实例
 * @returns {Promise<object>} 同步给飞书的响应（toast 或 card）
 */
async function handleCardAction(data, feishuClient) {
  const {
    operator: { open_id: openId } = {},
    action: { value = {} } = {},
  } = data || {};

  const { action, emailId, expectedCategory, comment } = value;
  const messageId = extractMessageId(data);

  console.log(
    `📨 卡片按钮: action=${action}, emailId=${emailId}, openId=${openId}, messageId=${messageId}`
  );

  // 分类错误首次点击：同步返回分类选择卡片，无需后端
  if (action === 'feedback_wrong' && !expectedCategory) {
    return {
      toast: makeToast('info', '请在下方选择正确的邮件分类'),
      card: buildCategoryPickerCard(emailId),
    };
  }

  if (!action || !emailId) {
    return { toast: makeToast('error', '缺少 action 或 emailId') };
  }

  // 其他所有 action：先 toast，再异步处理 + 刷新卡片
  scheduleBackendAndRefresh({
    action,
    emailId,
    expectedCategory,
    comment,
    openId: openId || DEFAULT_OPEN_ID,
    messageId,
    feishuClient,
  });

  return { toast: makeToast('info', '处理中...') };
}

/**
 * 后台：调用后端 → 根据 action 决定是更新原卡片还是发送新卡片
 */
function scheduleBackendAndRefresh(ctx) {
  // 不 await，立即把控制权还给 handleCardAction
  doBackendAndRefresh(ctx).catch((error) => {
    console.error(`❌ 后台刷新失败: action=${ctx.action}`, error);
    // 尝试给用户一个失败提示（不阻塞）
    sendFallbackText(
      ctx.feishuClient,
      ctx.openId,
      `操作失败 (${ctx.action}): ${error.message}`
    ).catch(() => {});
  });
}

async function doBackendAndRefresh({
  action,
  emailId,
  expectedCategory,
  comment,
  openId,
  messageId,
  feishuClient,
}) {
  const result = await forwardToBackend({
    action,
    emailId,
    expectedCategory,
    comment,
    openId,
  });

  if (!result.success) {
    console.warn(`⚠️ 后端返回失败: ${result.message}`);
    await sendFallbackText(
      feishuClient,
      openId,
      `操作未完成 (${action}): ${result.message || '未知原因'}`
    );
    return;
  }

  console.log(`✅ 后端成功: action=${action}`);

  // 查看详情：新发一张详情卡片，保留原邮件卡片
  if (action === 'view_detail') {
    if (!result.detail) {
      throw new Error('后端未返回 detail');
    }
    const detailCard = buildEmailDetailCard(result.detail);
    await feishuClient.sendCard('open_id', openId || DEFAULT_OPEN_ID, detailCard);
    return;
  }

  // 其余 action：原地刷新邮件卡片
  if (!result.email) {
    console.warn(`⚠️ 后端未返回 email，跳过卡片刷新: action=${action}`);
    return;
  }

  if (!messageId) {
    console.warn('⚠️ 事件中缺少 messageId，无法 patch 原卡片，改为新发一张');
    await feishuClient.sendCard(
      'open_id',
      openId || DEFAULT_OPEN_ID,
      buildEmailCard(result.email)
    );
    return;
  }

  await feishuClient.updateCard(messageId, buildEmailCard(result.email));
}

/**
 * 调用 email-claw 后端
 */
async function forwardToBackend(payload) {
  const headers = { 'Content-Type': 'application/json' };
  if (BOT_SECRET) headers['X-Bot-Secret'] = BOT_SECRET;
  const response = await fetch(`${BACKEND_URL}/api/feishu/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * 从飞书事件 payload 中尽量稳健地取出原卡片消息 ID
 * 不同 SDK 版本 / 事件结构字段名略有差异
 */
function extractMessageId(data) {
  if (!data) return undefined;
  return (
    data.context?.open_message_id ||
    data.open_message_id ||
    data.message_id ||
    data.event?.context?.open_message_id ||
    undefined
  );
}

function makeToast(type, content) {
  return {
    type,
    content,
    i18n: { zh_cn: content, en_us: content },
  };
}

async function sendFallbackText(feishuClient, openId, text) {
  const target = openId || DEFAULT_OPEN_ID;
  if (!target) return;
  await feishuClient.sendText('open_id', target, text);
}

module.exports = { handleCardAction, forwardToBackend, ACTION_LABELS };
