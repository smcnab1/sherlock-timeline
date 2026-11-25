import crypto from "node:crypto";
import path from "node:path";
import { simpleParser, type AddressObject } from "mailparser";
import mammoth from "mammoth";
import { createCaseBackupBestEffort } from "@/lib/backup";
import { getPrisma } from "@/lib/prisma";
import { deleteStoredUploadFile, storeUploadFile } from "@/lib/runtime-storage";

export type ImportFileInput = {
  name: string;
  type: string;
  buffer: Buffer;
};

type ParsedAddress = {
  name: string;
  email: string;
};

type ParsedMessage = {
  localId: string;
  sourceFile: string;
  sourcePath: string;
  sourceStoragePath: string;
  sourceFileSize: number;
  sourceType: string;
  sourceHash: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  subject: string;
  normalizedSubject: string;
  sentAt: Date;
  sender: ParsedAddress;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bcc: ParsedAddress[];
  bodyText: string;
  rawText: string;
  threadKey: string;
  classification: Classification;
  confidenceScore: number;
  duplicate: boolean;
};

type Classification = {
  eventType: string;
  category: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  confidence: number;
  reasons: string[];
};

type ConversationDraft = {
  localId: string;
  title: string;
  normalizedSubject: string;
  startedAt: Date;
  endedAt: Date;
  messages: ParsedMessage[];
  participants: ParsedAddress[];
  analytics: ReturnType<typeof conversationAnalytics>;
};

export type ImportPreview = {
  jobId: string;
  summary: {
    files: number;
    messages: number;
    conversations: number;
    people: number;
    evidence: number;
    events: number;
    relationships: number;
    duplicates: number;
  };
  conversations: Array<{
    localId: string;
    title: string;
    messageCount: number;
    participants: string[];
    startedAt: string;
    endedAt: string;
    analytics: ReturnType<typeof conversationAnalytics>;
  }>;
  people: Array<ParsedAddress & { existingPersonId?: string }>;
  events: Array<{
    localId: string;
    title: string;
    date: string;
    eventType: string;
    category: string;
    priority: string;
    confidence: number;
    duplicate: boolean;
  }>;
  relationships: Array<{ source: string; target: string; relationshipType: string }>;
  insights: string[];
};

function hash(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeSubject(subject: string) {
  return (subject || "Untitled conversation")
    .replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function displaySubject(subject: string) {
  const normalized = normalizeSubject(subject);
  if (!normalized) return "Untitled conversation";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanMessageId(value?: string | null) {
  return (value || "").replace(/[<>]/g, "").trim();
}

function cleanAddressName(value: string, email = "") {
  const emailLocal = email.split("@")[0] || "";
  const cleaned = (value || emailLocal || "Unknown")
    .replace(/["<>]/g, " ")
    .replace(/\b(?:to|from|cc|bcc|subject|sent|date)\s*:\s*/gi, " ")
    .replace(/\b(?:to|from|cc|bcc|subject|sent|date)\b\s*/gi, " ")
    .replace(/[;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || emailLocal || "Unknown";
}

function personKey(person: ParsedAddress) {
  return person.email || person.name.toLowerCase();
}

function uniqueAddresses(addresses: ParsedAddress[]) {
  const seen = new Set<string>();
  const result: ParsedAddress[] = [];
  for (const address of addresses) {
    const key = personKey(address);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

function addresses(input?: AddressObject | AddressObject[] | null): ParsedAddress[] {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return uniqueAddresses(list.flatMap((item) =>
    item.value.map((entry) => {
      const email = (entry.address || "").toLowerCase();
      const name = cleanAddressName(entry.name || email.split("@")[0] || "Unknown", email);
      return { name, email };
    }),
  ).filter((item) => item.email || item.name));
}

function addressFromHeader(value: string): ParsedAddress[] {
  return uniqueAddresses(value
    .split(/[,;]/)
    .map((part) => {
      const match = part.match(/^(.*?)<([^>]+)>/);
      const email = (match?.[2] || part.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "").trim().toLowerCase();
      const name = cleanAddressName(match?.[1] || part.replace(email, "") || email.split("@")[0] || "Unknown", email);
      return { name, email };
    })
    .filter((item) => item.email || item.name));
}

function organisationFromEmail(email: string) {
  const domain = email.split("@")[1] || "";
  const root = domain.split(".")[0] || "";
  return root ? root.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
}

function classify(message: Pick<ParsedMessage, "subject" | "bodyText">): Classification {
  const text = `${message.subject} ${message.bodyText}`.toLowerCase();
  const reasons: string[] = [];
  let eventType = "Email";
  let category = "Communication";
  let priority: Classification["priority"] = "Medium";
  let confidence = 72;

  const tests: Array<[RegExp, string, string, Classification["priority"], string]> = [
    [/occupational health|\boh\b|adjustment|referral/, "Occupational Health", "Occupational Health", "High", "Occupational health language detected"],
    [/grievance|formal complaint|investigation/, "Grievance", "Investigation", "Critical", "Formal investigation language detected"],
    [/sick|fit note|absence|attendance/, "Sickness", "Attendance", "High", "Sickness or attendance language detected"],
    [/escalat|urgent|senior manager|no response/, "Escalation", "Escalation", "High", "Escalation language detected"],
    [/follow[ -]?up|chaser|chase|reminder/, "Follow Up", "Communication", "High", "Follow-up language detected"],
    [/decision|decided|approved|rejected|outcome/, "Decision", "Management", "High", "Decision language detected"],
    [/meeting|invite|minutes|attendees/, "Meeting", "Management", "Medium", "Meeting language detected"],
    [/hr|human resources|policy/, "HR", "HR", "Medium", "HR language detected"],
    [/workload|workloading|capacity|pressure/, "Email", "Wellbeing", "High", "Workload or wellbeing language detected"],
  ];

  for (const [pattern, nextType, nextCategory, nextPriority, reason] of tests) {
    if (pattern.test(text)) {
      eventType = nextType;
      category = nextCategory;
      priority = nextPriority;
      confidence += 8;
      reasons.push(reason);
    }
  }

  if (/\?/.test(message.bodyText) || /please respond|can you confirm|could you/i.test(message.bodyText)) {
    reasons.push("Request or question detected");
    confidence += 5;
  }
  if (!reasons.length) reasons.push("General communication headers and body parsed");

  return { eventType, category, priority, confidence: Math.min(96, confidence), reasons };
}

async function extractPdf(buffer: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assetRoot = path.join(process.cwd(), "node_modules/pdfjs-dist");
  const task = getDocument({
    data: Uint8Array.from(buffer),
    cMapUrl: assetRoot + "/cmaps/",
    standardFontDataUrl: assetRoot + "/standard_fonts/",
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const { items } = await page.getTextContent();
      pages.push(items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "").join(""));
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}

async function extractDocx(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || "";
}

async function parseEml(buffer: Buffer, sourceFile: string, sourcePath: string, sourceStoragePath: string, sourceType: string, sourceFileSize = buffer.byteLength): Promise<ParsedMessage> {
  const parsed = await simpleParser(buffer);
  const htmlText = typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "";
  const bodyText = (parsed.text || htmlText || "").replace(/\s+\n/g, "\n").trim();
  const subject = parsed.subject || "Untitled email";
  const from = addresses(parsed.from)[0] || { name: "Unknown sender", email: "" };
  const sentAt = parsed.date || new Date();
  const messageId = cleanMessageId(parsed.messageId) || hash(`${sourceFile}-${subject}-${sentAt.toISOString()}-${bodyText}`).slice(0, 32);
  const references = parsed.references
    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).map(cleanMessageId).filter(Boolean)
    : [];
  const rawText = buffer.toString("utf8");
  const classification = classify({ subject, bodyText });

  return {
    localId: hash(`${sourceFile}-${messageId}`).slice(0, 16),
    sourceFile,
    sourcePath,
    sourceStoragePath,
    sourceFileSize,
    sourceType,
    sourceHash: hash(`${messageId}-${sentAt.toISOString()}-${bodyText}`),
    messageId,
    inReplyTo: cleanMessageId(parsed.inReplyTo),
    references,
    subject,
    normalizedSubject: normalizeSubject(subject),
    sentAt,
    sender: from,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    bodyText,
    rawText,
    threadKey: "",
    classification,
    confidenceScore: classification.confidence,
    duplicate: false,
  };
}

function parseHeaderBlock(block: string, sourceFile: string, sourcePath: string, sourceStoragePath: string, index: number, sourceType: string, sourceFileSize: number): ParsedMessage {
  const header: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (match) {
      header[match[1].toLowerCase()] = match[2].trim();
      bodyStart = i + 1;
      continue;
    }
    if (!line.trim()) {
      bodyStart = i + 1;
      break;
    }
    if (i > 12) break;
  }
  const bodyText = lines.slice(bodyStart).join("\n").trim() || block.trim();
  const subject = header.subject || `Communication ${index + 1}`;
  const sentAt = header.date ? new Date(header.date) : new Date();
  const safeDate = Number.isNaN(sentAt.getTime()) ? new Date() : sentAt;
  const sender = addressFromHeader(header.from || "")[0] || { name: "Unknown sender", email: "" };
  const messageId = cleanMessageId(header["message-id"]) || hash(`${sourceFile}-${index}-${subject}-${safeDate.toISOString()}-${bodyText}`).slice(0, 32);
  const classification = classify({ subject, bodyText });
  return {
    localId: hash(`${sourceFile}-${index}-${messageId}`).slice(0, 16),
    sourceFile,
    sourcePath,
    sourceStoragePath,
    sourceFileSize,
    sourceType,
    sourceHash: hash(`${messageId}-${safeDate.toISOString()}-${bodyText}`),
    messageId,
    inReplyTo: cleanMessageId(header["in-reply-to"]),
    references: (header.references || "").split(/\s+/).map(cleanMessageId).filter(Boolean),
    subject,
    normalizedSubject: normalizeSubject(subject),
    sentAt: safeDate,
    sender,
    to: addressFromHeader(header.to || ""),
    cc: addressFromHeader(header.cc || ""),
    bcc: addressFromHeader(header.bcc || ""),
    bodyText,
    rawText: block,
    threadKey: "",
    classification,
    confidenceScore: classification.confidence,
    duplicate: false,
  };
}

function splitTextCommunications(text: string) {
  const blocks = text
    .split(/\n(?=(?:From|Subject|Date):\s)/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 20);
  return blocks.length ? blocks : [text.trim()].filter(Boolean);
}

async function parseFile(file: ImportFileInput, sourcePath: string, sourceStoragePath: string): Promise<ParsedMessage[]> {
  const ext = path.extname(file.name).toLowerCase();
  if (ext === ".eml") return [await parseEml(file.buffer, file.name, sourcePath, sourceStoragePath, "EML", file.buffer.byteLength)];
  if (ext === ".mbox") {
    const chunks = file.buffer.toString("utf8").split(/\nFrom .*(?:\r?\n)/g).filter((chunk) => chunk.trim());
    return Promise.all(chunks.map((chunk, index) => parseEml(Buffer.from(chunk), `${file.name}#${index + 1}`, sourcePath, sourceStoragePath, "MBOX", file.buffer.byteLength)));
  }
  const text =
    ext === ".pdf"
      ? await extractPdf(file.buffer)
      : ext === ".docx"
        ? await extractDocx(file.buffer)
        : file.buffer.toString("utf8");
  const sourceType = ext === ".pdf" ? "PDF" : ext === ".docx" ? "DOCX" : "TXT";
  return splitTextCommunications(text).map((block, index) => parseHeaderBlock(block, file.name, sourcePath, sourceStoragePath, index, sourceType, file.buffer.byteLength));
}

function assignThreads(messages: ParsedMessage[]) {
  const byMessageId = new Map<string, string>();
  const subjectThread = new Map<string, string>();
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  for (const message of sorted) {
    const referenced = [message.inReplyTo, ...message.references].find((id) => byMessageId.has(id));
    const key = referenced
      ? byMessageId.get(referenced)!
      : subjectThread.get(message.normalizedSubject) || `subject:${message.normalizedSubject || message.messageId}`;
    message.threadKey = key;
    byMessageId.set(message.messageId, key);
    if (message.normalizedSubject) subjectThread.set(message.normalizedSubject, key);
  }
  return sorted;
}

function uniquePeople(messages: ParsedMessage[]) {
  const people = new Map<string, ParsedAddress>();
  for (const message of messages) {
    [message.sender, ...message.to, ...message.cc, ...message.bcc].forEach((person) => {
      const key = personKey(person);
      if (key && !people.has(key)) people.set(key, person);
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function conversationAnalytics(messages: ParsedMessage[]) {
  const sorted = [...messages].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const responseHours = sorted.slice(1).map((message, index) => Math.max(0, Math.round((message.sentAt.getTime() - sorted[index].sentAt.getTime()) / 3_600_000)));
  const followUpsRequired = sorted.filter((message) => /follow[ -]?up|chase|reminder/i.test(`${message.subject} ${message.bodyText}`)).length;
  const escalations = sorted.filter((message) => /escalat|urgent|senior manager|formal/i.test(`${message.subject} ${message.bodyText}`)).length;
  const periodsOfSilence = responseHours.filter((hours) => hours >= 168).length;
  return {
    averageResponseHours: responseHours.length ? Math.round(responseHours.reduce((total, value) => total + value, 0) / responseHours.length) : 0,
    longestResponseHours: responseHours.length ? Math.max(...responseHours) : 0,
    followUpsRequired,
    escalations,
    periodsOfSilence,
  };
}

function buildConversations(messages: ParsedMessage[]) {
  const groups = new Map<string, ParsedMessage[]>();
  messages.forEach((message) => {
    groups.set(message.threadKey, [...(groups.get(message.threadKey) || []), message]);
  });
  return [...groups.entries()].map<ConversationDraft>(([key, items]) => {
    const sorted = items.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    return {
      localId: hash(key).slice(0, 16),
      title: displaySubject(sorted[0]?.subject || key),
      normalizedSubject: sorted[0]?.normalizedSubject || key,
      startedAt: sorted[0]?.sentAt || new Date(),
      endedAt: sorted.at(-1)?.sentAt || new Date(),
      messages: sorted,
      participants: uniquePeople(sorted),
      analytics: conversationAnalytics(sorted),
    };
  }).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

function buildInsights(conversations: ConversationDraft[]) {
  const insights: string[] = [];
  conversations.forEach((conversation) => {
    if (conversation.analytics.longestResponseHours >= 24 * 7) {
      insights.push(`No response recorded for ${Math.round(conversation.analytics.longestResponseHours / 24)} days in "${conversation.title}".`);
    }
    if (conversation.analytics.followUpsRequired >= 2) {
      insights.push(`${conversation.analytics.followUpsRequired} follow-ups were required in "${conversation.title}".`);
    }
    if (conversation.analytics.escalations > 0) {
      insights.push(`Escalation language appears in "${conversation.title}".`);
    }
  });
  return insights.slice(0, 10);
}

function eventPeopleForMessage(message: ParsedMessage, personByKey: Map<string, string>) {
  const seen = new Set<string>();
  const people: Array<{ personId: string; role: string }> = [];
  const senderId = personByKey.get(personKey(message.sender));

  if (senderId) {
    seen.add(senderId);
    people.push({ personId: senderId, role: "Sender" });
  }

  for (const person of [...message.to, ...message.cc, ...message.bcc]) {
    const personId = personByKey.get(personKey(person));
    if (!personId || seen.has(personId)) continue;
    seen.add(personId);
    people.push({ personId, role: "Recipient" });
  }

  return people;
}

type StoredImportFile = ImportFileInput & { sourceStoragePath: string; publicPath: string };

async function persistUploadedFiles(files: ImportFileInput[]) {
  const saved: StoredImportFile[] = [];
  try {
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedName = `${crypto.randomUUID()}-${hash(file.buffer).slice(0, 10)}-${safeName}`;
      const stored = await storeUploadFile(["imports", storedName], file.buffer, file.type || "application/octet-stream");
      saved.push({ ...file, sourceStoragePath: stored.filePath, publicPath: stored.publicPath });
    }
    return saved;
  } catch (error) {
    await cleanupStoredImportFiles(saved);
    throw error;
  }
}

export async function createImportPreview(caseId: string, files: ImportFileInput[]): Promise<ImportPreview> {
  const saved = await persistUploadedFiles(files);
  try {
    return await createImportPreviewFromStoredFiles(caseId, files, saved);
  } catch (error) {
    await cleanupStoredImportFiles(saved);
    throw error;
  }
}

async function createImportPreviewFromStoredFiles(caseId: string, files: ImportFileInput[], saved: StoredImportFile[]): Promise<ImportPreview> {
  const prisma = getPrisma();
  const parsedBatches = [];
  for (const file of saved) parsedBatches.push(await parseFile(file, file.publicPath, file.sourceStoragePath));
  const messages = assignThreads(parsedBatches.flat());
  const existingHashes = new Set(
    (await prisma.conversationMessage.findMany({
      where: { caseId, sourceHash: { in: messages.map((message) => message.sourceHash) } },
      select: { sourceHash: true },
    })).map((item) => item.sourceHash),
  );
  messages.forEach((message) => {
    message.duplicate = existingHashes.has(message.sourceHash);
  });
  const conversations = buildConversations(messages.filter((message) => !message.duplicate));
  const people = uniquePeople(messages);
  const existingPeople = await prisma.person.findMany({
    where: {
      OR: [
        { email: { in: people.map((person) => person.email).filter(Boolean) } },
        { name: { in: people.map((person) => person.name) } },
      ],
      deletedAt: null,
    },
  });
  const peopleWithMatches = people.map((person) => ({
    ...person,
    existingPersonId: existingPeople.find((item) => item.email === person.email || item.name.toLowerCase() === person.name.toLowerCase())?.id,
  }));
  const insights = buildInsights(conversations);
  const relationshipSuggestions = conversations.flatMap((conversation) =>
    conversation.messages.slice(1).map((message, index) => ({
      source: conversation.messages[index].localId,
      target: message.localId,
      relationshipType: message.inReplyTo ? "replied-to" : "followed-by",
    })),
  );

  const job = await prisma.importJob.create({
    data: {
      caseId,
      status: "draft",
      sourceType: [...new Set(messages.map((message) => message.sourceType))].join(", ") || "Unknown",
      fileCount: files.length,
      messageCount: messages.length,
      conversationCount: conversations.length,
      evidenceCount: messages.filter((message) => !message.duplicate).length,
      eventCount: messages.filter((message) => !message.duplicate).length,
      peopleCount: peopleWithMatches.filter((person) => !person.existingPersonId).length,
      duplicateCount: messages.filter((message) => message.duplicate).length,
      analytics: {
        conversations: conversations.map((conversation) => ({ title: conversation.title, ...conversation.analytics })),
      },
      insights,
      results: {
        create: [
          {
            kind: "preview",
            summary: `Detected ${messages.length} messages in ${conversations.length} conversations`,
            payload: { messages, conversations, people: peopleWithMatches, relationships: relationshipSuggestions },
          },
        ],
      },
    },
  });

  return {
    jobId: job.id,
    summary: {
      files: files.length,
      messages: messages.length,
      conversations: conversations.length,
      people: peopleWithMatches.length,
      evidence: messages.filter((message) => !message.duplicate).length,
      events: messages.filter((message) => !message.duplicate).length,
      relationships: relationshipSuggestions.length,
      duplicates: messages.filter((message) => message.duplicate).length,
    },
    conversations: conversations.map((conversation) => ({
      localId: conversation.localId,
      title: conversation.title,
      messageCount: conversation.messages.length,
      participants: conversation.participants.map((person) => person.name || person.email),
      startedAt: conversation.startedAt.toISOString(),
      endedAt: conversation.endedAt.toISOString(),
      analytics: conversation.analytics,
    })),
    people: peopleWithMatches,
    events: messages.map((message) => ({
      localId: message.localId,
      title: message.subject,
      date: message.sentAt.toISOString(),
      eventType: message.classification.eventType,
      category: message.classification.category,
      priority: message.classification.priority,
      confidence: message.classification.confidence,
      duplicate: message.duplicate,
    })),
    relationships: relationshipSuggestions,
    insights,
  };
}

async function cleanupStoredImportFiles(files: StoredImportFile[]) {
  const results = await Promise.allSettled(files.map((file) => deleteStoredUploadFile(file.sourceStoragePath)));
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) console.error("Investigation import cleanup could not remove every stored source file", { failures });
}

export async function approveImport(jobId: string, options?: { ignoredMessageIds?: string[] }) {
  const prisma = getPrisma();
  const result = await prisma.importResult.findFirstOrThrow({ where: { importJobId: jobId, kind: "preview" } });
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
  const payload = result.payload as unknown as {
    messages: ParsedMessage[];
    conversations: ConversationDraft[];
    people: Array<ParsedAddress & { existingPersonId?: string }>;
  };
  const ignored = new Set(options?.ignoredMessageIds || []);
  const messages = payload.messages
    .map((message) => ({ ...message, sentAt: new Date(message.sentAt) }))
    .filter((message) => !message.duplicate && !ignored.has(message.localId));
  const conversations = buildConversations(assignThreads(messages));
  const personByKey = new Map<string, string>();
  const eventByMessage = new Map<string, string>();
  const evidenceByMessage = new Map<string, string>();

  const approved = await prisma.$transaction(async (tx) => {
    const claim = await tx.importJob.updateMany({
      where: { id: job.id, status: "draft" },
      data: { status: "approved" },
    });
    if (!claim.count) return false;

    for (const person of uniquePeople(messages)) {
      const key = personKey(person);
      const existing = await tx.person.findFirst({
        where: {
          OR: [
            person.email ? { email: person.email } : undefined,
            { name: { equals: person.name, mode: "insensitive" } },
          ].filter(Boolean) as { email?: string; name?: { equals: string; mode: "insensitive" } }[],
          deletedAt: null,
        },
      });
      const communicationDates = messages
        .filter((message) => [message.sender, ...message.to, ...message.cc, ...message.bcc].some((item) => personKey(item) === key))
        .map((message) => message.sentAt);
      const first = communicationDates.sort((a, b) => a.getTime() - b.getTime())[0];
      const last = communicationDates.at(-1);
      const record = existing
        ? await tx.person.update({
            where: { id: existing.id },
            data: {
              email: existing.email || person.email || undefined,
              organisation: existing.organisation || organisationFromEmail(person.email),
              firstCommunicationAt: existing.firstCommunicationAt && first && existing.firstCommunicationAt < first ? existing.firstCommunicationAt : first,
              lastCommunicationAt: existing.lastCommunicationAt && last && existing.lastCommunicationAt > last ? existing.lastCommunicationAt : last,
              interactionCount: { increment: communicationDates.length },
            },
          })
        : await tx.person.create({
            data: {
              name: person.name || person.email || "Unknown",
              email: person.email || null,
              role: "Communication participant",
              organisation: organisationFromEmail(person.email),
              notes: "Created by Investigation Import",
              firstCommunicationAt: first,
              lastCommunicationAt: last,
              interactionCount: communicationDates.length,
            },
          });
      personByKey.set(key, record.id);
    }

    for (const conversation of conversations) {
      const conversationRecord = await tx.conversation.create({
        data: {
          caseId: job.caseId,
          importJobId: job.id,
          title: conversation.title,
          normalizedSubject: conversation.normalizedSubject,
          startedAt: conversation.startedAt,
          endedAt: conversation.endedAt,
          messageCount: conversation.messages.length,
          participantCount: conversation.participants.length,
          averageResponseHours: conversation.analytics.averageResponseHours,
          longestResponseHours: conversation.analytics.longestResponseHours,
          followUpsRequired: conversation.analytics.followUpsRequired,
          escalations: conversation.analytics.escalations,
          periodsOfSilence: conversation.analytics.periodsOfSilence,
          machineInsights: buildInsights([conversation]),
        },
      });

      const createdConversationParticipants = new Set<string>();
      for (const participant of conversation.participants) {
        const key = personKey(participant);
        const personId = personByKey.get(key);
        if (!personId || createdConversationParticipants.has(personId)) continue;
        createdConversationParticipants.add(personId);
        const participantMessages = conversation.messages.filter((message) =>
          [message.sender, ...message.to, ...message.cc, ...message.bcc].some((item) => personKey(item) === key),
        );
        await tx.conversationParticipant.create({
          data: {
            conversationId: conversationRecord.id,
            personId,
            role: participantMessages.some((message) => personKey(message.sender) === key) ? "Sender" : "Recipient",
            messageCount: participantMessages.length,
            firstMessageAt: participantMessages[0]?.sentAt,
            lastMessageAt: participantMessages.at(-1)?.sentAt,
          },
        });
      }

      for (const message of conversation.messages) {
        const senderKey = personKey(message.sender);
        const document = await tx.document.create({
          data: {
            caseId: job.caseId,
            title: message.subject,
            filename: `${message.subject.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "email"}.eml.txt`,
            description: message.bodyText.slice(0, 900),
            sourceType: message.sourceType === "MBOX" || message.sourceType === "EML" ? "Email" : message.sourceType,
            sourceReference: `${message.sourceFile} ${message.messageId}`,
            confidenceLevel: "Imported",
            confidenceScore: message.confidenceScore,
            originalContent: message.rawText || message.bodyText,
            extractedMetadata: {
              subject: message.subject,
              sender: message.sender,
              to: message.to,
              cc: message.cc,
              bcc: message.bcc,
              messageId: message.messageId,
              inReplyTo: message.inReplyTo,
              references: message.references,
              sentAt: message.sentAt,
            },
            contentHash: message.sourceHash,
            importJobId: job.id,
            path: message.sourcePath,
            filePath: message.sourceStoragePath,
            fileSize: message.sourceFileSize,
            mimeType: "message/rfc822",
          },
        });
        const event = await tx.event.create({
          data: {
            caseId: job.caseId,
            title: message.classification.eventType === "Email" ? message.subject : `${message.classification.eventType}: ${message.subject}`,
            description: message.bodyText.slice(0, 1200),
            notes: `Machine-generated from import. Confidence ${message.classification.confidence}%. Reasons: ${message.classification.reasons.join("; ")}`,
            eventType: message.classification.eventType,
            category: message.classification.category,
            importance: message.classification.priority.toLowerCase(),
            status: "imported",
            confidenceScore: message.classification.confidence,
            machineGenerated: true,
            importJobId: job.id,
            conversationId: conversationRecord.id,
            sourceMessageId: message.messageId,
            startDate: message.sentAt,
            documents: { create: [{ documentId: document.id }] },
            people: { create: eventPeopleForMessage(message, personByKey) },
          },
        });
        const conversationMessage = await tx.conversationMessage.create({
          data: {
            conversationId: conversationRecord.id,
            importJobId: job.id,
            caseId: job.caseId,
            messageId: message.messageId,
            inReplyTo: message.inReplyTo,
            references: message.references,
            subject: message.subject,
            sentAt: message.sentAt,
            senderId: personByKey.get(senderKey),
            senderEmail: message.sender.email,
            senderName: message.sender.name,
            recipients: message.to,
            cc: message.cc,
            bcc: message.bcc,
            bodyText: message.bodyText,
            bodyPreview: message.bodyText.slice(0, 260),
            sourceFile: message.sourceFile,
            sourceHash: message.sourceHash,
            threadKey: message.threadKey,
            classification: message.classification,
            confidenceScore: message.confidenceScore,
            eventId: event.id,
            evidenceId: document.id,
          },
        });
        await tx.document.update({ where: { id: document.id }, data: { conversationMessageId: conversationMessage.id } });
        eventByMessage.set(message.localId, event.id);
        evidenceByMessage.set(message.localId, document.id);

        for (const recipient of [...message.to, ...message.cc, ...message.bcc]) {
          const targetId = personByKey.get(personKey(recipient));
          if (targetId && targetId !== personByKey.get(senderKey)) {
            await tx.personRelationship.upsert({
              where: { sourceId_targetId_relationshipType: { sourceId: personByKey.get(senderKey)!, targetId, relationshipType: "Sent Email" } },
              update: { importJobId: job.id, machineGenerated: true },
              create: {
                sourceId: personByKey.get(senderKey)!,
                targetId,
                relationshipType: "Sent Email",
                notes: `Generated from ${message.subject}`,
                importJobId: job.id,
                confidenceScore: 90,
                machineGenerated: true,
              },
            });
          }
        }
      }

      for (let index = 1; index < conversation.messages.length; index += 1) {
        const sourceId = eventByMessage.get(conversation.messages[index - 1].localId);
        const targetId = eventByMessage.get(conversation.messages[index].localId);
        if (sourceId && targetId) {
          await tx.relationship.upsert({
            where: { sourceId_targetId_relationshipType: { sourceId, targetId, relationshipType: conversation.messages[index].inReplyTo ? "replied-to" : "followed-by" } },
            update: { importJobId: job.id, machineGenerated: true },
            create: {
              sourceId,
              targetId,
              relationshipType: conversation.messages[index].inReplyTo ? "replied-to" : "followed-by",
              importJobId: job.id,
              confidenceScore: 88,
              machineGenerated: true,
            },
          });
        }
      }
    }

    await tx.importJob.update({
      where: { id: job.id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        messageCount: messages.length,
        conversationCount: conversations.length,
        evidenceCount: evidenceByMessage.size,
        eventCount: eventByMessage.size,
      },
    });
    await tx.auditEntry.create({
      data: {
        caseId: job.caseId,
        entityType: "ImportJob",
        entityId: job.id,
        action: "approve",
        summary: `Approved import with ${conversations.length} conversations and ${messages.length} messages`,
      },
    });
    return true;
  }, { timeout: 60_000 });

  if (approved) await createCaseBackupBestEffort(prisma, job.caseId, "investigation-import");
  return prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
}
