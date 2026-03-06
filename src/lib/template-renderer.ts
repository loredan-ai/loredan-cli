import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function replaceVars(input: string, vars: Record<string, string | number | null | undefined>): string {
  return input.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = vars[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

function sectionLabelForVariant(templateName: string, variant: string): string {
  if (templateName === 'claim-result.md.template') {
    if (variant === 'success') return 'Claim Successful';
  }

  if (templateName === 'init-result.md.template') {
    if (variant === 'success') return 'Init Successful';
  }

  if (templateName === 'check-result.md.template') {
    if (variant === 'doctor_preamble') return 'Doctor Preamble';
    if (variant === 'pending_none') return 'Pending Human Approvals None';
    if (variant === 'pending_has') return 'Pending Human Approvals Has';
    if (variant === 'returns_none') return 'Returns None';
    if (variant === 'returns_has') return 'Returns Has';
    if (variant === 'new_letters_none') return 'New Letters None';
    if (variant === 'new_letters_has') return 'New Letters Has';
    if (variant === 'inactive_none') return 'Inactive Relationships None';
    if (variant === 'inactive_has') return 'Inactive Relationships Has';
    if (variant === 'all_clear') return 'All Clear';
    if (variant === 'next_action_returns') return 'Next Action Returns';
    if (variant === 'next_action_inbox') return 'Next Action Inbox';
    if (variant === 'next_action_doctor_failures') return 'Next Action Doctor Failures';
    if (variant === 'next_action_inactive') return 'Next Action Inactive';
    if (variant === 'next_action_pending_only') return 'Next Action Pending Only';
    if (variant === 'next_action_all_clear') return 'Next Action All Clear';
  }

  if (templateName === 'letters-start.md.template') {
    if (variant === 'first_letter') return 'First Letter (no previous correspondence)';
    if (variant === 'ongoing') return 'Ongoing Correspondence (previous letters exist)';
    if (variant === 'revise') return 'Revision (returned letter)';
  }

  if (templateName === 'letters-draft-result.md.template') {
    if (variant === 'pending_review') return 'Pending Human Review (status: "draft")';
    if (variant === 'auto_approved') return 'Auto-Approved (status: "sent" or "delivered")';
  }

  if (templateName === 'letters-revise-result.md.template') {
    if (variant === 'pending_review') return 'Pending Human Review (status: "draft")';
    if (variant === 'auto_approved') return 'Auto-Approved (status: "sent" or "delivered")';
  }

  if (templateName === 'letters-returned.md.template') {
    if (variant === 'has_returns') return 'Has Returned Letters';
    if (variant === 'no_returns') return 'No Returned Letters';
  }

  if (templateName === 'letters-inbox.md.template') {
    if (variant === 'has_letters') return 'Has Letters';
    if (variant === 'no_letters') return 'No Letters';
  }

  if (templateName === 'tell-human.md.template') {
    if (variant === 'outbound_review') return 'Letter pending outbound review';
    if (variant === 'revision_ready') return 'Letter returned — need to inform human of revision';
    if (variant === 'inbound_received') return 'New inbound letter received';
  }

  return '';
}

function extractStateSection(raw: string, sectionTitle: string): string {
  if (!sectionTitle) return raw.trim();

  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`## State:\\s*${escaped}\\n([\\s\\S]*?)(?=\\n## State:|$)`);
  const match = raw.match(regex);
  if (!match?.[1]) return raw.trim();
  return match[1].trim();
}

async function readTemplateRaw(templateName: string): Promise<string> {
  const candidates = [
    join(__dirname, 'templates', templateName),             // dist/index.js -> dist/templates (global install)
    join(__dirname, '..', 'templates', templateName),       // dist/index.js -> templates (package root)
    join(__dirname, '..', '..', 'templates', templateName), // dist/lib -> dist/templates OR src/lib -> src/templates
    join(__dirname, '..', '..', '..', 'templates', templateName),
    join(process.cwd(), 'templates', templateName),
    join(process.cwd(), 'packages', 'cli', 'templates', templateName),
    resolve(process.cwd(), '..', 'templates', templateName),
  ];

  let lastErr: Error | null = null;

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf-8');
    } catch (err) {
      lastErr = err as Error;
    }
  }

  throw new Error(`Template not found: ${templateName}${lastErr ? ` (${lastErr.message})` : ''}`);
}

export async function renderTemplate(params: {
  templateName: string;
  variables: Record<string, string | number | null | undefined>;
  variant?: string;
}): Promise<string> {
  const raw = await readTemplateRaw(params.templateName);
  const sectionTitle = params.variant
    ? sectionLabelForVariant(params.templateName, params.variant)
    : '';
  const selected = extractStateSection(raw, sectionTitle);
  return replaceVars(selected, params.variables).trim() + '\n';
}
