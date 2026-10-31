import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../domain/domain-error.js';

const STATUS_BY_KIND: Record<DomainError['kind'], HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  forbidden: HttpStatus.FORBIDDEN,
  unavailable: HttpStatus.BAD_GATEWAY,
};

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    const status = STATUS_BY_KIND[error.kind];
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, code: error.code, message: error.message });
  }
}
