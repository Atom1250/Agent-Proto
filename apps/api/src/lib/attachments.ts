import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
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
  private readonly cleanupTimer: NodeJS.Timeout;
  private readonly maxAttachmentBytes: number;

  constructor(baseDir?: string) {
    const configuredDir = baseDir ?? process.env.ATTACHMENTS_DIR ?? path.join(process.cwd(), 'attachments');
    this.baseDir = configuredDir;

    const configuredMax = process.env.ATTACHMENT_MAX_BYTES ? Number(process.env.ATTACHMENT_MAX_BYTES) : NaN;
    this.maxAttachmentBytes = Number.isFinite(configuredMax) && configuredMax > 0 ? Math.floor(configuredMax) : 25 * 1024 * 1024;

    this.cleanupTimer = setInterval(() => {
      this.pruneExpiredTokens();
    }, 60_000);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
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
    this.pruneExpiredTokens();

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

  private pruneExpiredTokens() {
    const now = Date.now();
    for (const [token, entry] of this.tokens.entries()) {
      if (entry.expiresAt <= now) {
        this.tokens.delete(token);
      }
    }
  }

  async receiveUpload(
    token: string,
    stream: Readable,
    { contentType, contentLength }: { contentType?: string | null; contentLength?: number | null }
  ) {
    const entry = this.consumeToken(token);
    if (!entry) {
      throw new Error('invalid-upload-token');
    }

    const attachment = await prisma.attachment.findUnique({ where: { id: entry.attachmentId } });
    if (!attachment) {
      throw new Error('attachment-not-found');
    }

    const expectedSize = typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size > 0 ? attachment.size : null;
    if (contentLength != null) {
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        stream.destroy();
        throw new Error('invalid-content-length');
      }
      if (contentLength > this.maxAttachmentBytes) {
        stream.destroy();
        throw new Error('attachment-too-large');
      }
      if (expectedSize !== null && contentLength > expectedSize) {
        stream.destroy();
        throw new Error('attachment-size-exceeded');
      }
    }

    const storagePath = this.buildStoragePath(attachment.storageKey);
    await mkdir(path.dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.upload-${randomBytes(6).toString('hex')}`;
    const fileStream = createWriteStream(tempPath, { flags: 'w' });
    const hash = createHash('sha256');
    let written = 0;

    const cleanup = async () => {
      stream.destroy();
      fileStream.destroy();
      await rm(tempPath, { force: true }).catch(() => {});
    };

    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        written += buffer.length;
        if (written > this.maxAttachmentBytes) {
          throw new Error('attachment-too-large');
        }
        if (expectedSize !== null && written > expectedSize) {
          throw new Error('attachment-size-exceeded');
        }
        hash.update(buffer);
        if (!fileStream.write(buffer)) {
          await once(fileStream, 'drain');
        }
      }
    } catch (error) {
      await cleanup();
      throw error;
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end((endError?: NodeJS.ErrnoException | null) => {
        if (endError) {
          reject(endError);
        } else {
          resolve();
        }
      });
    }).catch(async (error) => {
      await cleanup();
      throw error;
    });

    const checksum = hash.digest('hex');

    await rm(storagePath, { force: true }).catch(() => {});

    try {
      await rename(tempPath, storagePath);
    } catch (error) {
      await cleanup();
      throw error;
    }

    const size = written;

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
