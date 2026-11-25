-- AlterTable
ALTER TABLE "Event" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Event" ADD COLUMN "machineGenerated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "importJobId" TEXT;
ALTER TABLE "Event" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "Event" ADD COLUMN "sourceMessageId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN "email" TEXT;
ALTER TABLE "Person" ADD COLUMN "firstCommunicationAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "lastCommunicationAt" TIMESTAMP(3);
ALTER TABLE "Person" ADD COLUMN "interactionCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Document" ADD COLUMN "originalContent" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Document" ADD COLUMN "extractedMetadata" JSONB;
ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Document" ADD COLUMN "importJobId" TEXT;
ALTER TABLE "Document" ADD COLUMN "conversationMessageId" TEXT;

-- AlterTable
ALTER TABLE "Relationship" ADD COLUMN "importJobId" TEXT;
ALTER TABLE "Relationship" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "Relationship" ADD COLUMN "machineGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PersonRelationship" ADD COLUMN "importJobId" TEXT;
ALTER TABLE "PersonRelationship" ADD COLUMN "confidenceScore" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "PersonRelationship" ADD COLUMN "machineGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sourceType" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "peopleCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "analytics" JSONB,
    "insights" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportResult" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "importJobId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedSubject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "averageResponseHours" INTEGER NOT NULL DEFAULT 0,
    "longestResponseHours" INTEGER NOT NULL DEFAULT 0,
    "followUpsRequired" INTEGER NOT NULL DEFAULT 0,
    "escalations" INTEGER NOT NULL DEFAULT 0,
    "periodsOfSilence" INTEGER NOT NULL DEFAULT 0,
    "machineInsights" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "importJobId" TEXT,
    "caseId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT NOT NULL DEFAULT '',
    "references" TEXT[],
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "senderId" TEXT,
    "senderEmail" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "cc" JSONB,
    "bcc" JSONB,
    "bodyText" TEXT NOT NULL,
    "bodyPreview" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "classification" JSONB NOT NULL,
    "confidenceScore" INTEGER NOT NULL DEFAULT 80,
    "eventId" TEXT,
    "evidenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Participant',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "firstMessageAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","personId")
);

-- CreateIndex
CREATE INDEX "Event_conversationId_idx" ON "Event"("conversationId");
CREATE INDEX "Event_importJobId_idx" ON "Event"("importJobId");
CREATE INDEX "Event_sourceMessageId_idx" ON "Event"("sourceMessageId");
CREATE INDEX "Person_email_idx" ON "Person"("email");
CREATE INDEX "Person_name_idx" ON "Person"("name");
CREATE INDEX "Document_importJobId_idx" ON "Document"("importJobId");
CREATE INDEX "Document_contentHash_idx" ON "Document"("contentHash");
CREATE INDEX "Document_conversationMessageId_idx" ON "Document"("conversationMessageId");
CREATE INDEX "Relationship_importJobId_idx" ON "Relationship"("importJobId");
CREATE INDEX "PersonRelationship_importJobId_idx" ON "PersonRelationship"("importJobId");
CREATE INDEX "ImportJob_caseId_createdAt_idx" ON "ImportJob"("caseId", "createdAt");
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");
CREATE INDEX "ImportResult_importJobId_kind_idx" ON "ImportResult"("importJobId", "kind");
CREATE INDEX "ImportResult_status_idx" ON "ImportResult"("status");
CREATE INDEX "Conversation_caseId_startedAt_idx" ON "Conversation"("caseId", "startedAt");
CREATE INDEX "Conversation_importJobId_idx" ON "Conversation"("importJobId");
CREATE INDEX "Conversation_normalizedSubject_idx" ON "Conversation"("normalizedSubject");
CREATE UNIQUE INDEX "ConversationMessage_caseId_sourceHash_key" ON "ConversationMessage"("caseId", "sourceHash");
CREATE INDEX "ConversationMessage_caseId_sentAt_idx" ON "ConversationMessage"("caseId", "sentAt");
CREATE INDEX "ConversationMessage_messageId_idx" ON "ConversationMessage"("messageId");
CREATE INDEX "ConversationMessage_conversationId_idx" ON "ConversationMessage"("conversationId");
CREATE INDEX "ConversationMessage_importJobId_idx" ON "ConversationMessage"("importJobId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_conversationMessageId_fkey" FOREIGN KEY ("conversationMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PersonRelationship" ADD CONSTRAINT "PersonRelationship_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportResult" ADD CONSTRAINT "ImportResult_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
