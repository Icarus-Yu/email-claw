/**
 * 卡片按钮点击事件处理器
 *
 * 处理用户在飞书卡片上的按钮点击：
 * 1. 直接处理简单反馈（分类正确/错误）
 * 2. 将需要后端操作的事件转发给 email-claw 后端
 */

const { buildCategoryPickerCard } = require('../cards/emailCard');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

/**
 * 处理卡片按钮点击回调
 *
 * @param {object} data - 飞书传入的卡片事件数据
 * @param {object} feishuClient - 飞书客户端实例
 * @returns {Promise<object>} 飞书期望的响应（toast + 可选 card 更新）
 */
async function handleCardAction(data, feishuClient) {
  const {
    operator: { open_id },
    action: { value, form_value = {} },
  } = data;

  const { action, emailId, expectedCategory, comment } = value;

  console.log(`📨 收到卡片按钮事件: action=${action}, emailId=${emailId}, open_id=${open_id}`);

  switch (action) {
    // ========== 后端正向操作（需要操作邮箱） ==========
    case 'mark_read':
    case 'mark_important':
    case 'archive':
    case 'delete':
    case 'reanalyze':
      return handleBackendAction(action, emailId, open_id, feishuClient);

    // ========== AI 反馈操作 ==========
    case 'feedback_correct':
      await forwardToBackend({ action, emailId });
      return {
        toast: {
          type: 'success',
          content: '感谢反馈！AI 分类正确标记已记录。',
          i18n: {
            zh_cn: '感谢反馈！AI 分类正确标记已记录。',
            en_us: 'Thanks! Correct classification recorded.',
          },
        },
      };

    case 'feedback_wrong':
      // 如果用户已经选择了正确分类（从分类选择卡片点击）
      if (expectedCategory) {
        await forwardToBackend({ action, emailId, expectedCategory, comment });
        return {
          toast: {
            type: 'success',
            content: `纠错反馈已记录，正确分类: ${expectedCategory}`,
            i18n: {
              zh_cn: `纠错反馈已记录，正确分类: ${expectedCategory}`,
              en_us: `Correction recorded: ${expectedCategory}`,
            },
          },
        };
      }
      // 用户首次点击"分类错误"，返回分类选择卡片
      return {
        toast: {
          type: 'info',
          content: '请在下方选择正确的邮件分类',
          i18n: {
            zh_cn: '请在下方选择正确的邮件分类',
            en_us: 'Please select the correct category below',
          },
        },
        card: buildCategoryPickerCard(emailId),
      };

    // ========== 查看详情 ==========
    case 'view_detail':
      await forwardToBackend({ action, emailId });
      return {
        toast: {
          type: 'info',
          content: '正在获取邮件详情...',
          i18n: {
            zh_cn: '正在获取邮件详情...',
            en_us: 'Fetching email details...',
          },
        },
      };

    default:
      console.warn(`⚠️ 未知 action: ${action}`);
      return {
        toast: {
          type: 'error',
          content: `未知操作: ${action}`,
          i18n: {
            zh_cn: `未知操作: ${action}`,
            en_us: `Unknown action: ${action}`,
          },
        },
      };
  }
}

/**
 * 处理需要后端执行的操作
 * 将请求转发给后端，并根据后端返回更新卡片
 */
async function handleBackendAction(action, emailId, openId, feishuClient) {
  try {
    const result = await forwardToBackend({ action, emailId });
    console.log(`✅ 后端处理成功: action=${action}, result=`, result);

    const actionLabels = {
      mark_read: '已标为已读',
      mark_important: '已标为重点',
      archive: '已归档',
      delete: '已删除',
      reanalyze: '已触发重新分析',
    };

    return {
      toast: {
        type: 'success',
        content: actionLabels[action] || `操作完成: ${action}`,
        i18n: {
          zh_cn: actionLabels[action] || `操作完成: ${action}`,
          en_us: `Action completed: ${action}`,
        },
      },
    };
  } catch (error) {
    console.error(`❌ 后端处理失败: action=${action}`, error.message);
    return {
      toast: {
        type: 'error',
        content: `操作失败: ${error.message}`,
        i18n: {
          zh_cn: `操作失败: ${error.message}`,
          en_us: `Action failed: ${error.message}`,
        },
      },
    };
  }
}

/**
 * 将操作请求转发给 email-claw 后端
 *
 * @param {object} payload - { action, emailId, ... }
 * @returns {Promise<object>} 后端响应
 */
async function forwardToBackend(payload) {
  const response = await fetch(`${BACKEND_URL}/api/feishu/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend returned ${response.status}: ${text}`);
  }

  return response.json();
}

module.exports = { handleCardAction, forwardToBackend };
