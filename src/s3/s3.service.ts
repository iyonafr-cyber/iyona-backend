import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { IS3Service } from './interface/s3.interface';

/**
 * How long the URL handed to Cursor stays valid. The agent fetches the image
 * when the run starts, which is minutes after upload at worst — a day is
 * generous and keeps a user's screenshot from being readable forever.
 */
const PROMPT_IMAGE_URL_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class S3Service implements IS3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const region = process.env.AWS_REGION || 'us-west-3';
    this.logger.log(`Initializing S3 client with region: ${region}`);

    this.s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
    this.bucketName = process.env.AWS_S3_BUCKET!;
    this.logger.log(`S3 bucket: ${this.bucketName}`);
  }

  /**
   * Store an image attached to a workspace prompt and return a URL Cursor can
   * fetch.
   *
   * Presigned rather than a plain bucket URL: objects here are uploaded with
   * the default private ACL, so `https://<bucket>.s3.../<key>` would 403 for
   * Cursor and the image would be silently ignored — the exact failure this
   * feature exists to fix.
   */
  async uploadPromptImage(
    projectId: string,
    buffer: Buffer,
    contentType: string,
    extension: string,
  ): Promise<string> {
    const key = `prompt-images/${projectId}/${randomUUID()}.${extension}`;
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      const url = await getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: this.bucketName, Key: key }),
        { expiresIn: PROMPT_IMAGE_URL_TTL_SECONDS },
      );
      this.logger.log(
        `Uploaded prompt image ${key} (${buffer.byteLength} bytes)`,
      );
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload prompt image: ${error.message}`);
      throw error;
    }
  }

  /**
   * Upload a code revision to S3
   * Files are stored as a single JSON object containing all files
   */
  async uploadRevision(
    projectId: string,
    revisionId: string,
    files: Record<string, string>,
  ): Promise<string> {
    const key = this.getRevisionKey(projectId, revisionId);
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(files),
        ContentType: 'application/json',
        Metadata: {
          projectId,
          revisionId,
          fileCount: String(Object.keys(files).length),
          createdAt: new Date().toISOString(),
        },
      });

      await this.s3Client.send(command);
      this.logger.log(
        `Uploaded revision ${revisionId} for project ${projectId} with ${Object.keys(files).length} files`,
      );

      return key;
    } catch (error) {
      this.logger.error(`Failed to upload revision: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download a code revision from S3
   */
  async downloadRevision(
    projectId: string,
    revisionId: string,
  ): Promise<Record<string, string>> {
    const key = this.getRevisionKey(projectId, revisionId);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const bodyString = await response.Body?.transformToString();

      if (!bodyString) {
        throw new Error('Empty response from S3');
      }

      const files = JSON.parse(bodyString) as Record<string, string>;
      this.logger.log(
        `Downloaded revision ${revisionId} for project ${projectId} with ${Object.keys(files).length} files`,
      );

      return files;
    } catch (error) {
      this.logger.error(`Failed to download revision: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a code revision from S3
   */
  async deleteRevision(projectId: string, revisionId: string): Promise<void> {
    const key = this.getRevisionKey(projectId, revisionId);

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(
        `Deleted revision ${revisionId} for project ${projectId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to delete revision: ${error.message}`);
      throw error;
    }
  }

  /**
   * List all revisions for a project
   */
  async listRevisions(projectId: string): Promise<string[]> {
    const prefix = `projects/${projectId}/revisions/`;

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);
      const revisionIds =
        response.Contents?.map((obj) => {
          // Extract revision ID from key: projects/{projectId}/revisions/{revisionId}.json
          const key = obj.Key || '';
          const match = key.match(/revisions\/([^/]+)\.json$/);
          return match ? match[1] : null;
        }).filter(Boolean) || [];

      return revisionIds;
    } catch (error) {
      this.logger.error(`Failed to list revisions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the S3 key for a revision
   */
  private getRevisionKey(projectId: string, revisionId: string): string {
    return `projects/${projectId}/revisions/${revisionId}.json`;
  }

  /**
   * Delete the entire S3 prefix for a project (all revisions). Best-effort:
   * errors are logged but not thrown, so a partial S3 failure does not block
   * the parent project delete from completing.
   */
  async deleteProjectFolder(projectId: string): Promise<void> {
    const prefix = `projects/${projectId}/`;
    this.logger.log(
      `Deleting all S3 objects under prefix ${prefix} for project ${projectId}`,
    );

    try {
      let continuationToken: string | undefined;
      let deletedCount = 0;

      do {
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const listResponse = await this.s3Client.send(listCommand);
        const objects = listResponse.Contents ?? [];

        for (const obj of objects) {
          if (!obj.Key) continue;
          try {
            await this.s3Client.send(
              new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: obj.Key,
              }),
            );
            deletedCount += 1;
          } catch (innerErr) {
            this.logger.warn(
              `Failed to delete S3 object ${obj.Key}: ${innerErr.message}`,
            );
          }
        }

        continuationToken = listResponse.IsTruncated
          ? listResponse.NextContinuationToken
          : undefined;
      } while (continuationToken);

      this.logger.log(`Deleted ${deletedCount} S3 object(s) under ${prefix}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 folder for project ${projectId}: ${error.message}`,
      );
    }
  }

  // ============ Test Methods ============

  /**
   * Upload a test file to S3
   */
  async uploadTestFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      });

      await this.s3Client.send(command);
      const url = `https://${this.bucketName}.s3.${process.env.AWS_REGION || 'us-west-2'}.amazonaws.com/${key}`;
      this.logger.log(`Uploaded test file: ${key}`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to upload test file: ${error.message}`);
      throw error;
    }
  }

  /**
   * List test files in S3
   */
  async listTestFiles(): Promise<
    { key: string; size: number; lastModified: Date }[]
  > {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: 'test-uploads/',
      });

      const response = await this.s3Client.send(command);
      return (
        response.Contents?.map((obj) => ({
          key: obj.Key || '',
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
        })) || []
      );
    } catch (error) {
      this.logger.error(`Failed to list test files: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a test file from S3
   */
  async deleteTestFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.log(`Deleted test file: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete test file: ${error.message}`);
      throw error;
    }
  }
}
