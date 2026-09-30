import { assertUploadAllowed, MAX_UPLOAD_BYTES } from './upload-rules';

describe('upload rules', () => {
  it('accepts the files each place is for', () => {
    expect(assertUploadAllowed({ folder: 'organization/header-logo', type: 'image/PNG', size: 1000 })).toEqual({
      folder: 'organization/header-logo',
      type: 'image/png',
      size: 1000,
    });
    expect(assertUploadAllowed({ folder: 'program-workflow/contracts', type: 'application/pdf', size: 5 }).folder).toBe('program-workflow/contracts');
    expect(assertUploadAllowed({ type: 'text/csv', size: 5 }).folder).toBe('client-documents');
  });

  it('never accepts anything a browser would run', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript', 'application/octet-stream', '']) {
      expect(() => assertUploadAllowed({ folder: 'client-documents', type, size: 5 })).toThrow('Upload a PDF');
    }
    expect(() => assertUploadAllowed({ folder: 'organization/header-logo', type: 'application/pdf', size: 5 })).toThrow('PNG, JPEG or WebP');
  });

  it('rejects oversized, empty and unknown locations', () => {
    expect(() => assertUploadAllowed({ type: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 })).toThrow('at most 25 MB');
    expect(() => assertUploadAllowed({ type: 'application/pdf', size: 0 })).toThrow('empty');
    expect(() => assertUploadAllowed({ folder: 'uploads/other-org', type: 'application/pdf', size: 5 })).toThrow('not allowed');
  });
});
