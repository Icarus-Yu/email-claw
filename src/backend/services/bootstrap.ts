/**
 * 启动自检 / 引导用户
 *
 * 如果 .env 配置了 IMAP_USER：
 *   - 若数据库中已存在该 email 的用户：补齐 / 更新 imapHost / imapUser / imapPassword（加密）
 *   - 若不存在且配置了 BOOTSTRAP_PASSWORD：自动注册一个引导用户并绑定邮箱
 *   - 若不存在且没配 BOOTSTRAP_PASSWORD：警告并跳过
 *
 * 同时如果配置了 DEFAULT_OPEN_ID 且引导用户尚未绑定飞书，自动绑定。
 */

import { databaseService } from './databaseService';
import { encrypt, looksEncrypted } from '../utils/crypto';
import { hashPassword } from '../utils/auth';

export async function runBootstrap(): Promise<void> {
  const imapUser = process.env.IMAP_USER;
  const imapPassword = process.env.IMAP_PASSWORD;
  const imapHost = process.env.IMAP_HOST;

  if (!imapUser || !imapPassword) {
    console.log('ℹ️ 未配置 IMAP_USER/IMAP_PASSWORD，跳过引导用户');
    return;
  }

  const existing = await databaseService.getUserByEmail(imapUser);
  const encryptedPassword = encrypt(imapPassword);

  if (existing) {
    const needsUpdate =
      existing.imapHost !== imapHost ||
      existing.imapUser !== imapUser ||
      !existing.imapPassword ||
      !looksEncrypted(existing.imapPassword);

    if (needsUpdate) {
      await databaseService.updateUser(existing.id, {
        imapHost: imapHost || existing.imapHost,
        imapUser,
        imapPassword: encryptedPassword,
      });
      console.log(`🔧 引导用户已更新 IMAP 凭据: ${imapUser}`);
    }

    // 引导用户的飞书绑定
    if (!existing.feishuUserId && process.env.DEFAULT_FEISHU_OPEN_ID) {
      await databaseService.updateUser(existing.id, {
        feishuUserId: process.env.DEFAULT_FEISHU_OPEN_ID,
      });
      console.log(`🔗 引导用户已绑定飞书 openId`);
    }
    return;
  }

  const bootstrapPwd = process.env.BOOTSTRAP_PASSWORD;
  if (!bootstrapPwd || bootstrapPwd.length < 8) {
    console.warn(
      `⚠️ 数据库无 ${imapUser} 用户，且 BOOTSTRAP_PASSWORD 未设置/不足 8 位。引导跳过。\n   该邮箱将不会启动 IMAP，请手动通过 /api/auth/register 注册并绑定邮箱。`
    );
    return;
  }

  const hash = await hashPassword(bootstrapPwd);
  const created = await databaseService.createUser({
    email: imapUser,
    passwordHash: hash,
  });
  await databaseService.updateUser(created.id, {
    imapHost: imapHost || null,
    imapUser,
    imapPassword: encryptedPassword,
    feishuUserId: process.env.DEFAULT_FEISHU_OPEN_ID || null,
  });
  console.log(
    `🚀 已自动创建引导用户 ${imapUser} (id=${created.id})，登录密码取自 BOOTSTRAP_PASSWORD`
  );
}
