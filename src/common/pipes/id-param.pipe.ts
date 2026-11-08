import { Injectable, PipeTransform } from '@nestjs/common';
import { MAX_INT } from '../constants/limits';
import { InvalidRequestException } from '../exceptions/app.exceptions';

/** Parses a path parameter into a positive 32-bit integer id. */
@Injectable()
export class IdParamPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^\d+$/.test(value)) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'id', messages: ['id must be a positive integer'] },
      ]);
    }
    const id = Number(value);
    if (id < 1 || id > MAX_INT) {
      throw new InvalidRequestException('Validation failed', [
        { field: 'id', messages: ['id must be a positive integer'] },
      ]);
    }
    return id;
  }
}
