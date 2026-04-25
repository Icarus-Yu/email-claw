import type { SimpleEmail } from '../../backend/services/emailService';

export function normalizeEmailText(email: SimpleEmail): string {
  return [
    email.subject,
    email.from,
    email.to,
    email.text,
    email.attachments.map((attachment) => attachment.filename || attachment.contentType).join(' ')
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function createBriefSummary(email: SimpleEmail): string {
  const content = email.text.replace(/\s+/g, ' ').trim();
  if (!content) {
    return `邮件《${email.subject}》暂无可提取的纯文本正文。`;
  }

  const maxLength = 160;
  const clipped = content.length > maxLength ? `${content.slice(0, maxLength)}...` : content;
  return `邮件《${email.subject}》来自 ${email.from}，主要内容：${clipped}`;
}
