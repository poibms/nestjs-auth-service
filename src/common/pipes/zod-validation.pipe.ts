import {
  ArgumentMetadata,
  BadRequestException,
  HttpStatus,
  PipeTransform,
} from '@nestjs/common';
import { ZodType } from 'zod';

function getZodSchema(metatype: unknown): ZodType | undefined {
  if (
    typeof metatype === 'function' &&
    'schema' in metatype &&
    metatype.schema instanceof ZodType
  ) {
    return metatype.schema;
  }
  return undefined;
}

export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const schema = getZodSchema(metadata.metatype);
    if (!schema) {
      return value;
    }

    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({
          field: i.path.length ? i.path.join('.') : null,
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }
}
