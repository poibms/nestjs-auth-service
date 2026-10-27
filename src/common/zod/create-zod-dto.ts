import { z, ZodType } from 'zod';

export interface ZodDto<T extends ZodType> {
  new (): z.infer<T>;
  schema: T;
}

export function createZodDto<T extends ZodType>(schema: T) {
  class ZodDtoClass {
    static schema = schema;
  }
  return ZodDtoClass as unknown as ZodDto<T>;
}
