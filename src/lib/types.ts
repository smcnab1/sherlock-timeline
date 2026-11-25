export type WorkspaceCase = {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  documents: DocumentItem[];
  events: EventItem[];
  actions: ActionItem[];
};

export type CaseSummary = {
  id: string;
  title: string;
  description: string;
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  _count?: {
    events: number;
    documents: number;
    actions: number;
  };
};

export type Person = {
  id: string;
  name: string;
  email?: string | null;
  role: string;
  organisation: string;
  notes: string;
  firstCommunicationAt?: string | Date | null;
  lastCommunicationAt?: string | Date | null;
  interactionCount?: number;
  deletedAt?: string | Date | null;
  outgoing?: PersonRelationship[];
  incoming?: PersonRelationship[];
};

export type DocumentItem = {
  id: string;
  caseId?: string | null;
  title: string;
  filename: string;
  description: string;
  sourceType: string;
  sourceReference: string;
  confidenceLevel: string;
  confidenceScore?: number;
  originalContent?: string;
  extractedMetadata?: unknown;
  contentHash?: string;
  importJobId?: string | null;
  conversationMessageId?: string | null;
  path: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string | Date;
  deletedAt?: string | Date | null;
  people?: { person: Person; role: string }[];
  events?: { event: Pick<EventItem, "id" | "title" | "startDate" | "eventType"> }[];
  tags: { tag: Tag }[];
};

export type Tag = {
  id: string;
  caseId: string;
  name: string;
  colour: string;
  assignmentCount?: number;
  _count?: {
    events: number;
    documents: number;
  };
};

export type Relationship = {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  createdAt: string | Date;
};

export type PersonRelationship = {
  id: string;
  sourceId: string;
  targetId: string;
  relationshipType: string;
  notes: string;
  createdAt: string | Date;
};

export type EventItem = {
  id: string;
  caseId: string;
  title: string;
  description: string;
  notes: string;
  eventType: string;
  category: string;
  importance: string;
  status: string;
  confidenceScore?: number;
  machineGenerated?: boolean;
  importJobId?: string | null;
  conversationId?: string | null;
  conversation?: Pick<ConversationItem, "id" | "title" | "status"> | null;
  sourceMessageId?: string;
  startDate: string | Date;
  endDate?: string | Date | null;
  createdAt: string | Date;
  deletedAt?: string | Date | null;
  people: { person: Person; role: string }[];
  documents: { document: DocumentItem }[];
  tags: { tag: Tag }[];
  actions?: ActionItem[];
};

export type ActionItem = {
  id: string;
  caseId: string;
  title: string;
  description: string;
  ownerId?: string | null;
  dueDate: string | Date;
  status: string;
  eventId?: string | null;
  documentId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  owner?: Person | null;
  event?: Pick<EventItem, "id" | "title" | "startDate" | "eventType"> | null;
  evidence?: DocumentItem | null;
};

export type AuditEntry = {
  id: string;
  caseId: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  createdAt: string | Date;
};

export type BackupItem = {
  id: string;
  caseId: string;
  path: string;
  createdAt: string | Date;
};

export type ConversationMessageItem = {
  id: string;
  conversationId: string;
  importJobId?: string | null;
  caseId: string;
  messageId: string;
  subject: string;
  sentAt: string | Date;
  senderEmail: string;
  senderName: string;
  bodyPreview: string;
  sourceFile: string;
  threadKey: string;
  confidenceScore: number;
};

export type ConversationItem = {
  id: string;
  caseId: string;
  importJobId?: string | null;
  title: string;
  normalizedSubject: string;
  status: string;
  startedAt: string | Date;
  endedAt: string | Date;
  messageCount: number;
  participantCount: number;
  averageResponseHours: number;
  longestResponseHours: number;
  followUpsRequired: number;
  escalations: number;
  periodsOfSilence: number;
  machineInsights?: unknown;
  messages?: ConversationMessageItem[];
};

export type ImportJobItem = {
  id: string;
  caseId: string;
  status: string;
  sourceType: string;
  fileCount: number;
  messageCount: number;
  conversationCount: number;
  evidenceCount: number;
  eventCount: number;
  peopleCount: number;
  duplicateCount: number;
  analytics?: unknown;
  insights?: unknown;
  createdAt: string | Date;
  approvedAt?: string | Date | null;
};

export type CaseInsight = {
  id: string;
  severity: "critical" | "warning" | "notice";
  title: string;
  detail: string;
};

export type WorkspaceData = {
  activeCase: WorkspaceCase | null;
  cases: CaseSummary[];
  people: Person[];
  evidence: DocumentItem[];
  actions: ActionItem[];
  tags: Tag[];
  relationships: Relationship[];
  personRelationships: PersonRelationship[];
  auditTrail: AuditEntry[];
  backups: BackupItem[];
  conversations: ConversationItem[];
  importJobs: ImportJobItem[];
  insights: CaseInsight[];
};
