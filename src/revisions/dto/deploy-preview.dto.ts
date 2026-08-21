import { IsOptional, IsString } from 'class-validator';

export class DeployPreviewDto {
  @IsString()
  @IsOptional()
  framework?: string;
}

export class DeployPreviewResponseDto {
  deploymentId: string;

  activeDeploymentId?: string;

  previewUrl: string;

  deploymentUrl: string;

  status: string;

  repairAttempt?: number;

  errorSummary?: string;

  failureCategory?: string;

  errorMessage?: string;

  failureReason?: string;
}
