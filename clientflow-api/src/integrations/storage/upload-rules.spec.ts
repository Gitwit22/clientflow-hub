import {
  assertUploadAllowed,
  matchesImageSignature,
  MAX_EMAIL_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
  uploadFolderOfKey,
} from './upload-rules';

describe('upload rules', () => {
  it('accepts the files each place is for', () => {
    expect(assertUploadAllowed({ folder: 'organization/header-logo', type: 'image/PNG', size: 1000 })).toEqual({
      folder: 'organization/header-logo',
      type: 'image/png',
      size: 1000,
      bucket: 'public',
      maxBytes: MAX_UPLOAD_BYTES,
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

  it('keeps contracts and client documents in the private bucket; only emailed images are public', () => {
    expect(assertUploadAllowed({ folder: 'client-documents', type: 'application/pdf', size: 5 }).bucket).toBe('private');
    expect(assertUploadAllowed({ folder: 'program-workflow/contracts', type: 'application/pdf', size: 5 }).bucket).toBe('private');
    expect(assertUploadAllowed({ folder: 'program-workflow/welcome-guides', type: 'application/pdf', size: 5 }).bucket).toBe('private');
    expect(assertUploadAllowed({ folder: 'organization/header-logo', type: 'image/png', size: 5 }).bucket).toBe('public');
    expect(assertUploadAllowed({ folder: 'email-images', type: 'image/gif', size: 5 }).bucket).toBe('public');
  });

  it('accepts only PNG, JPEG and GIF email images up to 5 MB', () => {
    expect(assertUploadAllowed({ folder: 'email-images', type: 'image/jpeg', size: MAX_EMAIL_IMAGE_BYTES }).folder).toBe('email-images');
    for (const type of ['image/webp', 'image/svg+xml', 'text/html', 'application/pdf']) {
      expect(() => assertUploadAllowed({ folder: 'email-images', type, size: 5 })).toThrow('PNG, JPEG or GIF');
    }
    expect(() => assertUploadAllowed({ folder: 'email-images', type: 'image/png', size: MAX_EMAIL_IMAGE_BYTES + 1 })).toThrow('at most 5 MB');
  });

  it('checks that an image file really is the type it claims to be', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    const gif = Buffer.from('GIF89a......', 'latin1');
    const html = Buffer.from('<html><script>', 'latin1');
    expect(matchesImageSignature('image/png', png)).toBe(true);
    expect(matchesImageSignature('image/jpeg', jpeg)).toBe(true);
    expect(matchesImageSignature('image/gif', gif)).toBe(true);
    expect(matchesImageSignature('image/png', jpeg)).toBe(false);
    expect(matchesImageSignature('image/gif', html)).toBe(false);
    expect(matchesImageSignature('image/png', Buffer.alloc(0))).toBe(false);
    expect(matchesImageSignature('text/html', html)).toBe(false);
  });

  it('finds the folder a storage key was issued under', () => {
    expect(uploadFolderOfKey('email-images/org-1/1-abc-photo.png')).toBe('email-images');
    expect(uploadFolderOfKey('organization/header-logo/org-1/1-abc-logo.png')).toBe('organization/header-logo');
    expect(uploadFolderOfKey('somewhere-else/org-1/file.png')).toBeNull();
  });
});
