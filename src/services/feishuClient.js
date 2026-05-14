/**
 * 飞书 API 服务封装
 *
 * 封装飞书 OpenAPI 调用：发送消息、获取租户 token 等。
 */

const Lark = require('@larksuiteoapi/node-sdk');

class FeishuClient {
  constructor() {
    this.client = null;
  }

  /**
   * 初始化飞书客户端
   * @param {string} appId
   * @param {string} appSecret
   */
  init(appId, appSecret) {
    this.client = new Lark.Client({
      appId,
      appSecret,
      appType: Lark.AppType.SelfBuild,
    });
  }

  /**
   * 向指定用户发送交互式卡片消息
   *
   * @param {string} receiveIdType - 'open_id' | 'user_id' | 'chat_id'
   * @param {string} receiveId - 接收者 ID
   * @param {object} cardJson - 飞书卡片 JSON 对象
   * @returns {Promise<object>} API 响应
   */
  async sendCard(receiveIdType, receiveId, cardJson) {
    const resp = await this.client.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(cardJson),
      },
    });

    if (resp.code !== 0) {
      throw new Error(`Feishu API error (${resp.code}): ${resp.msg}`);
    }

    return resp.data;
  }

  /**
   * 向指定用户发送文本消息
   *
   * @param {string} receiveIdType - 'open_id' | 'user_id' | 'chat_id'
   * @param {string} receiveId - 接收者 ID
   * @param {string} text - 文本内容
   */
  async sendText(receiveIdType, receiveId, text) {
    const resp = await this.client.im.v1.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });

    if (resp.code !== 0) {
      throw new Error(`Feishu API error (${resp.code}): ${resp.msg}`);
    }

    return resp.data;
  }

  /**
   * 更新已发送的卡片消息
   *
   * @param {string} messageId - 要更新的消息 ID
   * @param {object} cardJson - 新的卡片 JSON
   */
  async updateCard(messageId, cardJson) {
    const resp = await this.client.im.v1.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(cardJson),
      },
    });

    if (resp.code !== 0) {
      throw new Error(`Feishu API error (${resp.code}): ${resp.msg}`);
    }

    return resp.data;
  }

  /**
   * 获取消息内容（用于查看详情等场景）
   *
   * @param {string} messageId
   */
  async getMessage(messageId) {
    const resp = await this.client.im.v1.message.get({
      path: { message_id: messageId },
    });

    if (resp.code !== 0) {
      throw new Error(`Feishu API error (${resp.code}): ${resp.msg}`);
    }

    return resp.data;
  }
}

// 单例
module.exports = new FeishuClient();
