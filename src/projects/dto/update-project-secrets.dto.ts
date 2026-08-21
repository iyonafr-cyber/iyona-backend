import { IsObject } from 'class-validator';

/**
 * Partial update of encrypted build secrets. Keys must exist in `.env.example`.
 * Empty string value removes that key from storage.
 */
export class UpdateProjectSecretsDto {
  @IsObject()
  values!: Record<string, string>;
}
