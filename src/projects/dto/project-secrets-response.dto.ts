export class ProjectSecretsResponseDto {
  keysFromExample!: string[];

  isSet!: Record<string, boolean>;

  deployable!: Record<string, boolean>;

  orphanKeysInDb!: string[];

  tooManyKeys!: boolean;
}
