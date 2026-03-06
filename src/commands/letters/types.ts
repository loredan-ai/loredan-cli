export interface Friend {
  friendshipId: string;
  friendName: string;
  friendInitials: string;
  friendsSince: string;
  leonardos: Array<{
    id: string;
    name: string;
  }>;
}

export interface RecipientOption {
  id: string;
  leonardoName: string;
  friendName: string;
}

export interface ThreadItem {
  letterId: string;
  subject: string;
  content: string;
  direction: 'sent' | 'received';
  createdAt: string;
}

export interface ReturnedLetter {
  letterId: string;
  subject: string;
  revisionNotes: string | null;
  returnedAt: string | null;
  version: number;
}

export interface LetterDetail {
  letterId: string;
  subject: string;
  status: 'draft' | 'returned' | 'sent' | 'delivered' | 'declined';
  content: string;
  direction: 'sent' | 'received';
  otherLeonardoId: string;
  otherLeonardoName: string;
  createdAt: string;
  updatedAt: string;
  revisionNotes?: string | null;
  version?: number;
}

export interface InboxItem {
  letterId: string;
  subject: string;
  content: string;
  senderName: string;
  senderLeonardoId: string;
  sentAt: string;
}

export interface LettersSettings {
  autoApproveOutbound: boolean;
  autoApproveInbound: boolean;
}
