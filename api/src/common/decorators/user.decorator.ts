import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

/**
 * Custom param decorator that extracts the resolved user ID from the request.
 * The user ID is set by DevUserInterceptor.
 *
 * Usage: @User() userId: string
 */
export const User = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): string => {
        const request = ctx.switchToHttp().getRequest<FastifyRequest>();
        return (request as any).user;
    },
);
