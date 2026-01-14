import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Check if logging is disabled via env var
    if (process.env.REQUEST_LOGGING_ENABLED === 'false') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    
    // Extract requestId from header or generate UUID
    const requestId = (request.headers['x-request-id'] as string) || randomUUID();
    
    // Extract path and method
    const path = request.url.split('?')[0]; // Remove query params
    const method = request.method;

    return next.handle().pipe(
      finalize(() => {
        // Log after request completes (success or error)
        const logData = {
          level: 'info',
          msg: 'request completed',
          requestId,
          path,
          method,
        };
        console.log(JSON.stringify(logData));
      })
    );
  }
}
