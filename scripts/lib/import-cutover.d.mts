export function commitImportBatch(
  client: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
  },
  input: { batchId: string; confirmation: string; backupReference: string },
): Promise<any>;
