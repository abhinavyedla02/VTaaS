import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { DevUserInterceptor } from './dev-user.interceptor';

describe('DevUserInterceptor', () => {
    let interceptor: DevUserInterceptor;
    let mockExecutionContext: ExecutionContext;
    let mockCallHandler: CallHandler;
    let mockRequest: any;

    beforeEach(() => {
        interceptor = new DevUserInterceptor();
        mockRequest = {
            headers: {},
        };
        mockExecutionContext = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
            }),
        } as ExecutionContext;
        mockCallHandler = {
            handle: () => of({}),
        };

        // Clear env var before each test
        delete process.env.DEV_USER_ID;
    });

    afterEach(() => {
        // Clean up env var
        delete process.env.DEV_USER_ID;
    });

    it('should use x-user-id header when provided', (done) => {
        mockRequest.headers['x-user-id'] = 'header-user-123';

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe(() => {
            expect(mockRequest.user).toBe('header-user-123');
            done();
        });
    });

    it('should use DEV_USER_ID env var when header is not provided', (done) => {
        process.env.DEV_USER_ID = 'env-user-456';

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe(() => {
            expect(mockRequest.user).toBe('env-user-456');
            done();
        });
    });

    it('should fallback to LocalDevUser and log warning when neither header nor env is provided', (done) => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe(() => {
            expect(mockRequest.user).toBe('LocalDevUser');
            expect(warnSpy).toHaveBeenCalledWith(
                JSON.stringify({
                    level: 'warn',
                    msg: 'No user ID provided, using fallback',
                    userId: 'LocalDevUser',
                }),
            );
            warnSpy.mockRestore();
            done();
        });
    });

    it('should prefer header over env var when both are provided', (done) => {
        mockRequest.headers['x-user-id'] = 'header-user-123';
        process.env.DEV_USER_ID = 'env-user-456';

        interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe(() => {
            expect(mockRequest.user).toBe('header-user-123');
            done();
        });
    });
});
