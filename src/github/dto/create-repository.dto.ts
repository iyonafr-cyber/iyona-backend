import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRepositoryDto {
  @ApiProperty({
    description: 'Repository name',
    example: 'my-awesome-app',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  name: string;

  @ApiPropertyOptional({
    description: 'Repository description',
    example: 'A React application built with Jarvis AI',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the repository should be private',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  private?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to initialize with a README',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  autoInit?: boolean;
}
