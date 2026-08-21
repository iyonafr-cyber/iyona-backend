import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsBoolean } from 'class-validator';
import { LocaleHintsMixin } from '../../common/locale-hints.dto';

export class CreateUserProjectDto extends LocaleHintsMixin {
  @ApiProperty({
    type: String,
    example: 'Create a web application for task management',
    required: true,
  })
  @IsNotEmpty({ message: 'initialPrompt is required' })
  @IsString({ message: 'initialPrompt must be a string' })
  initialPrompt: string;

  @ApiProperty({
    type: String,
    example: 'Task Manager Pro',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'name must be a string' })
  name?: string;

  /**
   * E1 — opt the generated app into a managed Supabase project (DB,
   * Auth, Storage, Edge Functions). When true, a Supabase project is
   * provisioned asynchronously and the keys are pushed into the
   * deployed Vercel build at deploy time. The generator will also
   * inject the Supabase client + auth integration files automatically.
   */
  @ApiProperty({
    type: Boolean,
    example: false,
    required: false,
    description:
      'Provision a managed Supabase project (Postgres + Auth + Storage) and inject DB integration files into the generated app.',
  })
  @IsOptional()
  @IsBoolean({ message: 'withDatabase must be a boolean' })
  withDatabase?: boolean;
}
