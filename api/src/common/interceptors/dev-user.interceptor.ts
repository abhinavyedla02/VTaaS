import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FastifyRequest } from 'fastify';

/**
 * Global interceptor that resolves user ID for dev/local environments.
 *
 * Resolution order (per D-004):
 * 1. x-user-id header (if provided)
 * 2. DEV_USER_ID env var (if set)
 * 3. Fallback to "LocalDevUser" (logs warning)
 */
@Injectable()
export class DevUserInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest<FastifyRequest>();

        // Priority: header > env > fallback
        const headerUserId = request.headers['x-user-id'] as string;
        const envUserId = process.env.DEV_USER_ID;
        const fallbackUserId = 'LocalDevUser';

        let userId: string;
        if (headerUserId) {
            userId = headerUserId;
        } else if (envUserId) {
            userId = envUserId;
        } else {
            userId = fallbackUserId;
            console.warn(
                JSON.stringify({
                    level: 'warn',
                    msg: 'No user ID provided, using fallback',
                    userId: fallbackUserId,
                }),
            );
        }

        (request as any).user = userId;
        return next.handle();
    }
}
