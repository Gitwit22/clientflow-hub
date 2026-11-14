import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { inMemoryDb } from '../../invariants/in-memory-db';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramEmailService } from '../../modules/program-emails/program-email.service';
import type { N8nService } from './n8n.service';
import { StorageService } from '../storage/storage.service';
import { formattedTextToEmail } from './email-body';
import { emailImageKeyFor, emailImagePolicyFor, emailImagesIn } from './email-images';

const env: Partial<Environment> = {
  STORAGE_ENABLED: 'true',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'private-bucket',
  R2_PUBLIC_ASSETS_BUCKET: 'public-bucket',
  R2_PUBLIC_ASSETS_URL: 'https://images.example.org',
};
const storageWith = (values: Partial<Environment>) =>
  new StorageService({ get: (key: keyof Environment) => values[key] } as unknown as ConfigService<Environment, true>);
const storage = storageWith(env);
const OWN = 'https://images.example.org/email-images/org-a/1700-abc-flyer.png';

describe('email images', () => {
  it("accepts only this organization's uploaded email images", () => {
    expect(emailImageKeyFor(storage, 'org-a', OWN)).toBe('email-images/org-a/1700-abc-flyer.png');
    for (const url of [
      'https://images.example.org/email-images/org-b/1700-abc-flyer.png', // another organization
      'https://evil.example.com/email-images/org-a/x.png', // another host
      'http://images.example.org/email-images/org-a/x.png', // not https
      'https://images.example.org/organization/header-logo/org-a/logo.png', // not an email image
      'https://images.example.org/email-images/org-a/sub/x.png', // nested path
      'https://images.example.org/email-images/org-a/x.png?track=1', // query string
      'https://images.example.org/email-images/org-a/%2E%2E', // crafted path
    ]) {
      expect(emailImageKeyFor(storage, 'org-a', url)).toBeNull();
    }
    expect(emailImageKeyFor(storageWith({ ...env, R2_PUBLIC_ASSETS_URL: undefined }), 'org-a', OWN)).toBeNull();
  });

  it('finds image lines in a message', () => {
    expect(emailImagesIn(`Hello\n![Event flyer](${OWN})\n  ![](${OWN})  \nNot an image ![x](${OWN}) inline`))
      .toEqual([{ alt: 'Event flyer', url: OWN }, { alt: '', url: OWN }]);
  });

  it('renders allowed images (escaped) and leaves any other image line as text', () => {
    const body = `See the flyer:\n\n![Fall "Expo" <2026>](${OWN})\n\n![tracker](https://evil.example.com/pixel.gif)`;
    const { html, text } = formattedTextToEmail(body, { allowImage: emailImagePolicyFor(storage, 'org-a') });
    expect(html).toContain(`<img src="${OWN}" alt="Fall &quot;Expo&quot; &lt;2026&gt;" style="display:block;max-width:100%;height:auto;border:0;">`);
    // Never loaded as an image (no tracking pixel); at most it reads as an ordinary link.
    expect(html).not.toContain('<img src="https://evil.example.com');
    expect((html.match(/<img /g) ?? []).length).toBe(1);
    expect(text).toContain('[Image: Fall "Expo" <2026>]');
    // Without a policy (every other email), image lines are plain text as before.
    expect(formattedTextToEmail(`![x](${OWN})`).html).not.toContain('<img');
  });
});

describe('program emails with images and test sends', () => {
  const staff = { id: 'admin-1', displayName: 'Jordan Lee', email: 'jordan@ea.example' };

  function setup() {
    const rows: Record<string, Array<Record<string, unknown>>> = {
      cfProgram: [{ id: 'p1', organizationId: 'org-a', name: 'IDI' }],
      cfStoredFile: [
        { id: 'f1', organizationId: 'org-a', storageKey: 'email-images/org-a/1700-abc-flyer.png', storageBucket: 'public', status: 'READY' },
        { id: 'f2', organizationId: 'org-a', storageKey: 'email-images/org-a/1700-pending.png', storageBucket: 'public', status: 'REQUESTED' },
      ],
      cfProgramEmail: [],
      cfCommunication: [],
    };
    const db = inMemoryDb(rows);
    const sendProgramEmail = jest.fn().mockResolvedValue({ status: 'sent', sentAt: '2026-11-13T00:00:00.000Z' });
    const previewProgramEmail = jest.fn().mockResolvedValue({ html: '<p>x</p>', text: 'x' });
    const service = new ProgramEmailService(
      db as unknown as PrismaService,
      { sendProgramEmail, previewProgramEmail } as unknown as N8nService,
      storage,
    );
    return { rows, service, sendProgramEmail };
  }

  it('previews a message with an uploaded image, and refuses images that were not uploaded here', async () => {
    const { service } = setup();
    await expect(service.preview('org-a', 'p1', { subject: 'Hi', body: `![Flyer](${OWN})` })).resolves.toBeTruthy();
    await expect(service.preview('org-a', 'p1', { subject: 'Hi', body: '![x](https://images.example.org/email-images/org-a/1700-pending.png)' }))
      .rejects.toThrow('Image button');
    await expect(service.preview('org-a', 'p1', { subject: 'Hi', body: '![x](https://images.example.org/email-images/org-a/never-uploaded.png)' }))
      .rejects.toThrow('Image button');
    await expect(service.preview('org-a', 'p1', { subject: 'Hi', body: '![x](https://elsewhere.example.com/x.png)' }))
      .rejects.toThrow('Image button');
  });

  it('sends a test copy only to the signed-in staff member, marked [Test], recording nothing', async () => {
    const { service, rows, sendProgramEmail } = setup();
    const result = await service.sendTest('org-a', staff, 'p1', { subject: 'November update', body: `Hello\n\n![Flyer](${OWN})` });
    expect(result).toEqual({ recipientEmail: 'jordan@ea.example', delivery: expect.objectContaining({ status: 'sent' }) });
    expect(sendProgramEmail).toHaveBeenCalledWith(expect.stringMatching(/^program\.email\.test:/), expect.objectContaining({
      organizationId: 'org-a', recipientEmail: 'jordan@ea.example', subject: '[Test] November update', programEmailId: 'test',
    }));
    expect(rows.cfProgramEmail).toHaveLength(0);
    expect(rows.cfCommunication).toHaveLength(0);
    await expect(service.sendTest('org-a', { ...staff, email: 'not-an-email' }, 'p1', { subject: 'x', body: 'y' }))
      .rejects.toThrow('no email address');
    await expect(service.sendTest('org-b', staff, 'p1', { subject: 'x', body: 'y' })).rejects.toThrow();
  });
});
