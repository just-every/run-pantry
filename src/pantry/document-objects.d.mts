export function stagedDocumentBytes(
  db: D1Database,
  doc: { id: string; content: ArrayBuffer; size: number; sha256: string },
): Promise<Uint8Array<ArrayBuffer>>

export function drainDocumentObjects(
  db: D1Database,
  bucket: R2Bucket | undefined,
  limit?: number,
): Promise<number>
