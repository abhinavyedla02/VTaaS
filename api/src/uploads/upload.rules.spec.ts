import {
    validateMimeType,
    validateSize,
    getExtensionForMimeType,
    DEFAULT_MAX_UPLOAD_SIZE,
} from './upload.rules';
import { DomainException } from '../common/exceptions';

describe('upload.rules', () => {
    describe('validateMimeType', () => {
        it('returns mp4 for video/mp4', () => {
            expect(validateMimeType('video/mp4')).toBe('mp4');
        });

        it('returns mov for video/quicktime', () => {
            expect(validateMimeType('video/quicktime')).toBe('mov');
        });

        it('returns webm for video/webm', () => {
            expect(validateMimeType('video/webm')).toBe('webm');
        });

        it('throws UNSUPPORTED_MIME_TYPE for image/png', () => {
            expect(() => validateMimeType('image/png')).toThrow(DomainException);
            try {
                validateMimeType('image/png');
            } catch (e) {
                expect(e).toBeInstanceOf(DomainException);
                expect((e as DomainException).code).toBe('UNSUPPORTED_MIME_TYPE');
            }
        });

        it('throws UNSUPPORTED_MIME_TYPE for empty string', () => {
            expect(() => validateMimeType('')).toThrow(DomainException);
            try {
                validateMimeType('');
            } catch (e) {
                expect(e).toBeInstanceOf(DomainException);
                expect((e as DomainException).code).toBe('UNSUPPORTED_MIME_TYPE');
            }
        });

        it('error message lists allowed types', () => {
            try {
                validateMimeType('application/pdf');
            } catch (e) {
                expect((e as DomainException).message).toContain('video/mp4');
                expect((e as DomainException).message).toContain('video/quicktime');
                expect((e as DomainException).message).toContain('video/webm');
            }
        });
    });

    describe('validateSize', () => {
        it('does not throw for small file', () => {
            expect(() => validateSize(1000)).not.toThrow();
        });

        it('does not throw at exactly the default limit', () => {
            expect(() => validateSize(DEFAULT_MAX_UPLOAD_SIZE)).not.toThrow();
        });

        it('throws FILE_TOO_LARGE just over default limit', () => {
            expect(() => validateSize(DEFAULT_MAX_UPLOAD_SIZE + 1)).toThrow(DomainException);
            try {
                validateSize(DEFAULT_MAX_UPLOAD_SIZE + 1);
            } catch (e) {
                expect((e as DomainException).code).toBe('FILE_TOO_LARGE');
            }
        });

        it('throws FILE_TOO_LARGE with custom limit', () => {
            expect(() => validateSize(1000, 500)).toThrow(DomainException);
            try {
                validateSize(1000, 500);
            } catch (e) {
                expect((e as DomainException).code).toBe('FILE_TOO_LARGE');
            }
        });

        it('error message includes actual size and limit', () => {
            try {
                validateSize(600, 500);
            } catch (e) {
                expect((e as DomainException).message).toContain('600');
                expect((e as DomainException).message).toContain('500');
            }
        });

        it('does not throw at exactly custom limit', () => {
            expect(() => validateSize(500, 500)).not.toThrow();
        });
    });

    describe('getExtensionForMimeType', () => {
        it('returns mp4 for video/mp4', () => {
            expect(getExtensionForMimeType('video/mp4')).toBe('mp4');
        });

        it('returns undefined for unknown mime type', () => {
            expect(getExtensionForMimeType('image/png')).toBeUndefined();
        });

        it('returns undefined for empty string', () => {
            expect(getExtensionForMimeType('')).toBeUndefined();
        });
    });

    describe('DEFAULT_MAX_UPLOAD_SIZE', () => {
        it('is 500MB in bytes', () => {
            expect(DEFAULT_MAX_UPLOAD_SIZE).toBe(524288000);
        });
    });
});
