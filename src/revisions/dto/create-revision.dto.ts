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
  @IsObject()
  @IsNotEmpty()
  @Validate(IsRecordOfStringsConstraint)
  files: Record<string, string>;

  @IsString()
  @IsOptional()
  commitMessage?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
