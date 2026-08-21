import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DeployPreviewDto {
  @ApiProperty({
    description: 'Framework to use for deployment',
    example: 'vite',
    required: false,
    default: 'vite',
  })
  @IsString()
  @IsOptional()
  framework?: string;
}

export class DeployPreviewResponseDto {
  @ApiProperty({
    description:
      'Client polling key — always the first Vercel deployment id returned from POST /deploy',
  })
  deploymentId: string;

  @ApiProperty({
    description:
      'Active Vercel deployment id during repair redeploys (omit when same as deploymentId)',
    required: false,
  })
  activeDeploymentId?: string;

  @ApiProperty({ description: 'Stable preview URL' })
  previewUrl: string;

  @ApiProperty({ description: 'Direct deployment URL' })
  deploymentUrl: string;

  @ApiProperty({ description: 'Deployment status' })
  status: string;

  @ApiProperty({
    description: 'Current repair attempt (0 = not repairing)',
    required: false,
  })
  repairAttempt?: number;

  @ApiProperty({
    description: 'Human-readable error summary (never contains raw Vercel IDs)',
    required: false,
  })
  errorSummary?: string;

  @ApiProperty({
    description: 'Failure category for client display',
    required: false,
  })
  failureCategory?: string;

  @ApiProperty({ description: 'Error message', required: false })
  errorMessage?: string;

  @ApiProperty({ description: 'Failure reason', required: false })
  failureReason?: string;
}
