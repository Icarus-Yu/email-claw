/**
 * 去重并发回归测试（无外部依赖，不发飞书 / 不连 IMAP）
 *
 * 复现修复前的 bug：一封 UNSEEN 邮件在 onIncomingEmail 还没跑完（CLAWED 标记
 * 尚未写入）时，被第二个扫描触发源再次抓取并重复处理。
 *
 * 做法：用一个假的 imap 注入到真实的 UserMailbox 实例里，让 onIncomingEmail
 * 故意慢（200ms）。在它进行中再触发一次扫描，断言同一 UID 只被处理一次。
 *
 * 运行：npx ts-node tests/services/dedupe.race.test.ts
 */

import { EventEmitter } from 'events';
import { UserMailbox } from '../../src/backend/services/userMailbox';

// 一封最小可被 mailparser 解析的 RFC822 邮件
const RAW = [
  'From: alice@example.com',
  'To: bob@example.com',
  'Subject: Security alert',
  'Message-ID: <race-1@example.com>',
  '',
  'hello world',
].join('\r\n');

// 假的 imap：只实现 UserMailbox 扫描/去重路径用到的方法
function makeFakeImap(uid: number) {
  const flagsAdded: string[] = [];
  const fetchedUidsLog: number[][] = [];

  const imap: any = {
    search(_criteria: any[], cb: (err: any, uids: number[]) => void) {
      // 服务器端一直把它当 UNSEEN 返回（真实场景里没人标 \Seen）
      // 一旦打了 CLAWED 标记，UserMailbox 内部会在 fetch 时过滤；这里仍返回它，
      // 才能真正考验内存级去重。
      setImmediate(() => cb(null, [uid]));
    },
    fetch(uids: number[], _opts: any) {
      fetchedUidsLog.push([...uids]);
      const f = new EventEmitter();
      setImmediate(() => {
        for (const u of uids) {
          const msg = new EventEmitter();
          f.emit('message', msg);
          const stream = new EventEmitter();
          msg.emit('body', stream);
          setImmediate(() => {
            stream.emit('data', Buffer.from(RAW, 'utf8'));
            msg.emit('attributes', { uid: u, flags: flagsAdded.slice() });
            setImmediate(() => msg.emit('end'));
          });
        }
        setImmediate(() => f.emit('end'));
      });
      return f;
    },
    addFlags(_uid: number, flags: string[], cb: (err: any) => void) {
      flagsAdded.push(...flags);
      cb(null);
    },
  };

  return { imap, get flagsAdded() { return flagsAdded; }, get fetchedUidsLog() { return fetchedUidsLog; } };
}

async function main() {
  const UID = 42;
  const fake = makeFakeImap(UID);

  let processedCount = 0;
  const processedSubjects: string[] = [];

  const mb = new UserMailbox(
    'test-user',
    { host: 'x', port: 993, user: 'u', password: 'p' },
    {
      onIncomingEmail: async (_userId, email) => {
        processedCount++;
        processedSubjects.push(email.subject);
        // 模拟 OpenClaw 慢处理 / 卡住的窗口
        await new Promise((r) => setTimeout(r, 200));
      },
    }
  );

  // 注入假 imap（绕过真实 connect）
  (mb as any).imap = fake.imap;

  // 模拟三触发源在慢处理窗口内抢跑：初始扫描 + mail 事件 + 一次轮询
  (mb as any).scanUnprocessedEmails();
  setTimeout(() => (mb as any).scanUnprocessedEmails(), 30);
  setTimeout(() => (mb as any).scanUnprocessedEmails(), 60);

  // 等所有处理完成
  await new Promise((r) => setTimeout(r, 600));

  console.log('—— 结果 ——');
  console.log('onIncomingEmail 触发次数:', processedCount);
  console.log('处理过的主题:', processedSubjects);
  console.log('fetch 调用 / 每次抓取的 UID:', JSON.stringify(fake.fetchedUidsLog));
  console.log('写入的标记:', fake.flagsAdded);

  if (processedCount === 1) {
    console.log('\n✅ PASS：同一封邮件只处理一次，不会重复发卡');
    process.exit(0);
  } else {
    console.error(`\n❌ FAIL：邮件被处理了 ${processedCount} 次（应为 1 次）—— 仍会重复发卡`);
    process.exit(1);
  }
}

main();
