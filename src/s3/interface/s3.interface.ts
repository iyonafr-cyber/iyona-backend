export interface IS3Service {
  uploadRevision(
    projectId: string,
    revisionId: string,
    files: Record<string, string>,
  ): Promise<string>;

  downloadRevision(
    projectId: string,
    revisionId: string,
  ): Promise<Record<string, string>>;

  deleteRevision(projectId: string, revisionId: string): Promise<void>;

  listRevisions(projectId: string): Promise<string[]>;

  deleteProjectFolder(projectId: string): Promise<void>;
}

export interface S3UploadResult {
  key: string;
  url: string;
}
