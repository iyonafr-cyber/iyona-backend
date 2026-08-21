import { ApiProperty } from '@nestjs/swagger';

export class ProjectSecretsResponseDto {
  @ApiProperty({ type: [String] })
  keysFromExample!: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Whether a ciphertext exists for this key',
  })
  isSet!: Record<string, boolean>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'boolean' },
    description: 'Whether this key passes Vercel deploy allowlist',
  })
  deployable!: Record<string, boolean>;

  @ApiProperty({
    type: [String],
    description: 'Keys stored in DB but absent from current `.env.example`',
  })
  orphanKeysInDb!: string[];

  @ApiProperty({
    description:
      'True when `.env.example` declares more than 50 distinct keys (PUT is rejected until fixed)',
  })
  tooManyKeys!: boolean;
}
