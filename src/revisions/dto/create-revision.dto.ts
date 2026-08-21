import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

@ValidatorConstraint({ name: 'isRecordOfStrings', async: false })
export class IsRecordOfStringsConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    // Check that all values are strings
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        if (typeof value[key] !== 'string') {
          return false;
        }
      }
    }

    return true;
  }

  defaultMessage(_args: ValidationArguments) {
    return 'files must be an object where all values are strings';
  }
}

export class CreateRevisionDto {
  @ApiProperty({
    description: 'The generated code files',
    example: {
      'index.html': '<!DOCTYPE html>...',
      'src/App.tsx': 'export default function App() {...}',
    },
  })
  @IsObject()
  @IsNotEmpty()
  @Validate(IsRecordOfStringsConstraint)
  files: Record<string, string>;

  @ApiProperty({
    description: 'Optional commit message for this revision',
    example: 'Added authentication feature',
    required: false,
  })
  @IsString()
  @IsOptional()
  commitMessage?: string;

  @ApiProperty({
    description: 'Optional metadata for this revision',
    required: false,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
