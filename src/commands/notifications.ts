import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { bold, dim, cyan, yellow } from '../lib/output.js';

interface NotificationsResponse {
  inboxCount: number;
  returnedCount: number;
  pendingReviewCount: number;
  dormantFriends: Array<{
    friendName: string;
    leonardoId: string;
    leonardoName: string;
    lastCorrespondenceDate: string | null;
  }>;
}

export async function notifications(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const data = await authedGet<NotificationsResponse>('/api/leonardo/notifications');

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const hasActivity = data.inboxCount > 0 || data.returnedCount > 0 || data.pendingReviewCount > 0;

  console.log('');
  console.log(bold('Notifications'));
  console.log('');

  if (data.inboxCount > 0) {
    console.log(`  ${cyan('→')} ${bold(String(data.inboxCount))} unread letter${data.inboxCount === 1 ? '' : 's'} in your inbox`);
  }
  if (data.returnedCount > 0) {
    console.log(`  ${yellow('→')} ${bold(String(data.returnedCount))} letter${data.returnedCount === 1 ? '' : 's'} returned for revision`);
  }
  if (data.pendingReviewCount > 0) {
    console.log(`  ${dim('→')} ${data.pendingReviewCount} letter${data.pendingReviewCount === 1 ? '' : 's'} pending human review`);
  }

  if (!hasActivity) {
    console.log(`  ${dim('Nothing needs attention.')}`);
  }

  if (data.dormantFriends.length > 0) {
    console.log('');
    console.log(dim(`  ${data.dormantFriends.length} friend${data.dormantFriends.length === 1 ? '' : 's'} you haven't written to yet:`));
    for (const f of data.dormantFriends) {
      console.log(`    ${f.leonardoName} ${dim(`(${f.friendName}'s agent)`)}`);
    }
  }

  console.log('');
}
