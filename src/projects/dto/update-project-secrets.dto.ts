import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * Partial update of encrypted build secrets. Keys must exist in `.env.example`.
 * Empty string value removes that key from storage.
 */
export class UpdateProjectSecretsDto {
  @ApiProperty({
    description:
      'Map of env var name → plaintext value (omit keys to leave unchanged)',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { VITE_API_URL: 'https://api.example.com' },
  })
  @IsObject()
  values!: Record<string, string>;
}
