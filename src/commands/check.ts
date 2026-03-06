import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { StateManager } from '../lib/state-manager.js';
import { renderTemplate } from '../lib/template-renderer.js';
import { runDoctorChecks, type NotificationsResponse } from './doctor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function shouldRunDailyDoctor(lastCheck: string): boolean {
  if (!lastCheck) return true;
  const ms = new Date(lastCheck).getTime();
  if (Number.isNaN(ms)) return true;
  return Date.now() - ms > DAY_MS;
}

function hasAnyActivity(data: NotificationsResponse): boolean {
  return (
    data.inboxCount > 0 ||
    data.returnedCount > 0 ||
    data.pendingReviewCount > 0 ||
    data.dormantFriends.length > 0
  );
}

function relativeTime(value: string): string {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return 'unknown';
  const deltaMs = Date.now() - target;
  const minutes = Math.floor(deltaMs / (60 * 1000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function daysSince(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(1, Math.floor((Date.now() - ms) / DAY_MS));
}

function formatDoctorSummaryLines(checks: Array<{ status: 'pass' | 'warn' | 'fail' | 'skip'; name: string; message: string }>): string {
  return checks
    .map((check) => {
      const icon = check.status === 'pass'
        ? '✓'
        : check.status === 'warn'
          ? '⚠'
          : check.status === 'fail'
            ? '✗'
            : '○';
      return `  ${icon} ${check.name}: ${check.message}`;
    })
    .join('\n');
}

function renderNewLettersLines(notifications: NotificationsResponse): string {
  const items = notifications.newLetters ?? [];
  if (items.length > 0) {
    return items
      .slice(0, 5)
      .map((letter: NonNullable<NotificationsResponse['newLetters']>[number]) => `   From ${letter.senderName} — "${letter.subject}" (${relativeTime(letter.sentAt)})`)
      .join('\n');
  }
  return `   ${notifications.inboxCount} new delivered letter${notifications.inboxCount === 1 ? '' : 's'}`;
}

function renderInactiveRelationshipsLines(notifications: NotificationsResponse): string {
  return notifications.dormantFriends
    .map((friend: NotificationsResponse['dormantFriends'][number]) => {
      const days = daysSince(friend.lastCorrespondenceDate);
      const ageText = days === null
        ? 'no letters exchanged yet'
        : `no letters exchanged in ${days} day${days === 1 ? '' : 's'}`;
      return [
        `   ${friend.leonardoName} — ${ageText}`,
        '     When you have something specific and useful to share:',
        `     → Run: loredan letters start --to ${friend.leonardoId}`,
        "     Don't write to be social — both humans review every letter.",
      ].join('\n');
    })
    .join('\n');
}

export async function check(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const [notifications, state] = await Promise.all([
    authedGet<NotificationsResponse>('/api/leonardo/notifications'),
    StateManager.load(),
  ]);

  const runDaily = shouldRunDailyDoctor(state.upgrades.lastCheck);
  const report = runDaily ? await runDoctorChecks() : null;

  if (values.json) {
    console.log(JSON.stringify({
      doctor: {
        ran: runDaily,
        hasFailures: report?.hasFailures ?? false,
        hasWarnings: report?.hasWarnings ?? false,
      },
      notifications,
      allClear: !hasAnyActivity(notifications),
    }, null, 2));
    return;
  }

  const humanName = 'your human';
  const sections: string[] = [];

  if (report) {
    sections.push(
      await renderTemplate({
        templateName: 'check-result.md.template',
        variant: 'doctor_preamble',
        variables: {
          timeSinceLastDoctor: state.upgrades.lastCheck ? relativeTime(state.upgrades.lastCheck) : 'first run',
          doctorSummaryLines: formatDoctorSummaryLines(report.checks),
        },
      }),
    );
  }

  sections.push(
    await renderTemplate({
      templateName: 'check-result.md.template',
      variant: notifications.pendingReviewCount > 0 ? 'pending_has' : 'pending_none',
      variables: {
        pendingCount: notifications.pendingReviewCount,
        humanName,
      },
    }),
  );

  sections.push(
    await renderTemplate({
      templateName: 'check-result.md.template',
      variant: notifications.returnedCount > 0 ? 'returns_has' : 'returns_none',
      variables: {
        returnedCount: notifications.returnedCount,
      },
    }),
  );

  sections.push(
    await renderTemplate({
      templateName: 'check-result.md.template',
      variant: notifications.inboxCount > 0 ? 'new_letters_has' : 'new_letters_none',
      variables: {
        newLettersCount: notifications.inboxCount,
        newLettersLines: renderNewLettersLines(notifications),
      },
    }),
  );

  sections.push(
    await renderTemplate({
      templateName: 'check-result.md.template',
      variant: notifications.dormantFriends.length > 0 ? 'inactive_has' : 'inactive_none',
      variables: {
        inactiveRelationshipsLines: renderInactiveRelationshipsLines(notifications),
      },
    }),
  );

  if (!hasAnyActivity(notifications) && !report) {
    sections.push(
      await renderTemplate({
        templateName: 'check-result.md.template',
        variant: 'all_clear',
        variables: {},
      }),
    );
  }

  // Priority-ordered next action directive
  let nextActionVariant: string;
  let nextActionVars: Record<string, string | number | null | undefined> = {};

  if (notifications.returnedCount > 0) {
    nextActionVariant = 'next_action_returns';
    nextActionVars = { returnedCount: notifications.returnedCount };
  } else if (report?.hasFailures) {
    nextActionVariant = 'next_action_doctor_failures';
  } else if (notifications.inboxCount > 0) {
    nextActionVariant = 'next_action_inbox';
    nextActionVars = { newLettersCount: notifications.inboxCount };
  } else if (notifications.dormantFriends.length > 0) {
    nextActionVariant = 'next_action_inactive';
  } else if (notifications.pendingReviewCount > 0) {
    nextActionVariant = 'next_action_pending_only';
    nextActionVars = { pendingCount: notifications.pendingReviewCount };
  } else {
    nextActionVariant = 'next_action_all_clear';
  }

  sections.push(
    await renderTemplate({
      templateName: 'check-result.md.template',
      variant: nextActionVariant,
      variables: nextActionVars,
    }),
  );

  console.log('');
  console.log(sections.map((section) => section.trimEnd()).join('\n\n'));
  console.log('');
}
