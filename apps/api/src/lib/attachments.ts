import { createHash, randomBytes } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { prisma } from './prisma';

type UploadTokenEntry = {
  attachmentId: string;
  expiresAt: number;
};

type CreateUploadParams = {
  sessionId: string;
  filename?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim().replace(/\s+/g, '-');
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe || 'attachment';
}

function ensurePosixKey(key: string): string {
  return key.split(path.sep).join(path.posix.sep);
}

export class AttachmentService {
  private readonly baseDir: string;
  private readonly tokens = new Map<string, UploadTokenEntry>();

  constructor(baseDir?: string) {
    const configuredDir = baseDir ?? process.env.ATTACHMENTS_DIR ?? path.join(process.cwd(), 'attachments');
    this.baseDir = configuredDir;
  }

  private async ensureBaseDir() {
    await mkdir(this.baseDir, { recursive: true });
  }

  private buildStoragePath(storageKey: string) {
    const normalized = ensurePosixKey(storageKey);
    const safeKey = normalized.split('/').filter((segment) => segment && segment !== '..').join('/');
    return path.join(this.baseDir, safeKey);
  }

  async createUpload({ sessionId, filename, mimeType, size }: CreateUploadParams) {
    await this.ensureBaseDir();

    const cleanName = filename ? sanitizeFilename(filename) : 'attachment';
    const attachmentId = randomBytes(12).toString('hex');
    const storageKey = ensurePosixKey(path.posix.join(sessionId, attachmentId, cleanName));
    const url = `attachment://${storageKey}`;

    const attachment = await prisma.attachment.create({
      data: {
        id: attachmentId,
        sessionId,
        url,
        storageKey,
        filename: cleanName,
        mimeType: mimeType ?? null,
        size: size ?? null,
        checksum: null,
      },
    });

    const token = randomBytes(24).toString('hex');
    this.tokens.set(token, {
      attachmentId: attachment.id,
      expiresAt: Date.now() + DEFAULT_TTL_MS,
    });

    return {
      uploadUrl: `/v1/attachments/upload/${token}`,
      method: 'PUT' as const,
      token,
      attachment,
      headers: {
        'Content-Type': mimeType ?? 'application/octet-stream',
      },
      expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    };
  }

  private consumeToken(token: string): UploadTokenEntry | null {
    const entry = this.tokens.get(token);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return null;
    }
    this.tokens.delete(token);
    return entry;
  }

  async receiveUpload(token: string, payload: Buffer, contentType?: string | null) {
    const entry = this.consumeToken(token);
    if (!entry) {
      throw new Error('invalid-upload-token');
    }

    const attachment = await prisma.attachment.findUnique({ where: { id: entry.attachmentId } });
    if (!attachment) {
      throw new Error('attachment-not-found');
    }

    const storagePath = this.buildStoragePath(attachment.storageKey);
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, payload);

    const checksum = createHash('sha256').update(payload).digest('hex');
    const size = payload.byteLength;

    const updated = await prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        checksum,
        size,
        url: `file://${storagePath}`,
        mimeType: contentType ?? attachment.mimeType,
      },
    });

    return updated;
  }

  async openAttachmentPath(attachmentId: string) {
    const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) {
      throw new Error('attachment-not-found');
    }
    const storagePath = this.buildStoragePath(attachment.storageKey);
    try {
      await stat(storagePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error('attachment-file-missing');
      }
      throw error;
    }

    return {
      attachment,
      storagePath,
    };
  }

  async listForSession(sessionId: string) {
    const attachments = await prisma.attachment.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
    return attachments;
  }
}

let singleton: AttachmentService | null = null;

export function getAttachmentService() {
  if (!singleton) {
    singleton = new AttachmentService();
  }
  return singleton;
}
