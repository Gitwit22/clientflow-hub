import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { emailDocumentHtml } from './email-body';
import { parseEmailLayout, parseEmailSignature, parseEmailSignaturesByRole, resolveEmailStyle, toWireStyle } from './email-style';
import { N8nService } from './n8n.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-base-to-string */

function setup() {
  return inMemoryDb({
    organization: [
      {
        id: 'org-1',
        settings: {
          emailSignature: 'Warm regards,\nEA Management Team',
          emailLayout: 'left',
          emailSignaturesByRole: { org_admin: 'Thank you,\nEAM Administration', reviewer: 'Thank you,\nEAM Staff', super_admin: '  ' },
        },
      },
      { id: 'org-2', settings: {} },
    ],
    cfProgram: [
      { id: 'p-idi', organizationId: 'org-1', emailSignature: null, emailLayout: null },
      { id: 'p-grant', organizationId: 'org-1', emailSignature: 'The Grant Team <grants@ea.example>', emailLayout: 'center' },
      { id: 'p-other-org', organizationId: 'org-2', emailSignature: 'Not yours', emailLayout: 'left' },
      { id: 'p-edge', organizationId: 'org-1', emailSignature: null, emailLayout: 'left-edge' },
    ],
    adminUser: [
      { id: 'admin-1', organizationId: 'org-1', role: 'org_admin' },
      { id: 'staff-1', organizationId: 'org-1', role: 'reviewer' },
      { id: 'boss-1', organizationId: 'org-1', role: 'super_admin' },
      { id: 'outsider-1', organizationId: 'org-2', role: 'org_admin' },
    ],
  }) as any;
}

describe('email signature and layout', () => {
  it('uses the program\'s own choices first, then the organization\'s, and nothing when neither is set', async () => {
    const db = setup();
    expect(await resolveEmailStyle(db, 'org-1', 'p-idi')).toEqual({
      signatureText: 'Warm regards,\nEA Management Team',
      signatureHtml: 'Warm regards,<br/>EA Management Team',
      layout: 'left',
    });
    // Escaped: the signature is text, never markup.
    expect(await resolveEmailStyle(db, 'org-1', 'p-grant')).toEqual({
      signatureText: 'The Grant Team <grants@ea.example>',
      signatureHtml: 'The Grant Team &lt;grants@ea.example&gt;',
      layout: 'center',
    });
    expect(await resolveEmailStyle(db, 'org-1')).toEqual(expect.objectContaining({ layout: 'left' }));
    expect(await resolveEmailStyle(db, 'org-2')).toEqual({});
    // Another organization's program is never read.
    expect(await resolveEmailStyle(db, 'org-1', 'p-other-org')).toEqual(expect.objectContaining({ signatureText: 'Warm regards,\nEA Management Team' }));
  });

  it('reads staff input: trimmed signature (empty means none), and only left or center', () => {
    expect(parseEmailSignature('  Thanks,\r\nEA  ')).toBe('Thanks,\nEA');
    expect(parseEmailSignature('   ')).toBeNull();
    expect(() => parseEmailSignature('x'.repeat(1001))).toThrow('under 1000');
    expect(parseEmailLayout('left')).toBe('left');
    expect(parseEmailLayout('')).toBeNull();
    expect(parseEmailLayout('left-edge')).toBe('left-edge');
    expect(() => parseEmailLayout('right')).toThrow('"left", "left-edge" or "center"');
  });

  it('previews the left layout in one column with a margin, and the chosen sign-off', () => {
    const left = emailDocumentHtml('<p>Hello</p>', 'https://assets.example/logo.png', { layout: 'left', signatureHtml: 'Warm regards,<br/>EA' });
    expect(left).toContain('<td align="left" style="padding:24px;">');
    expect(left).toContain('<div style="max-width:600px;text-align:left;"><img src="https://assets.example/logo.png"');
    expect(left).toContain('<p>Warm regards,<br/>EA</p>');
    expect(left).not.toContain('margin:0 auto');
    // No choices: today's centered header and sign-off.
    const centered = emailDocumentHtml('<p>Hello</p>', 'https://assets.example/logo.png');
    expect(centered).toContain('<td align="center" style="padding-bottom:24px;">');
    expect(centered).toContain('<p>Thank you,<br/>EA Management LLC</p>');
  });

  it('sends the signature and layout to n8n with each email, and never the internal program id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const values: Record<string, unknown> = {
      N8N_ENABLED: 'true',
      N8N_EMAIL_WEBHOOK_URL: 'https://n8n.example.com/webhook/intake',
      CLIENTFLOW_N8N_SECRET: 'webhook-secret',
      N8N_TIMEOUT_MS: 5000,
    };
    const config = { get: (key: string) => values[key] } as unknown as ConfigService<Environment, true>;
    const service = new N8nService(config, setup());
    await service.sendWelcome('welcome-1', {
      organizationId: 'org-1',
      programId: 'p-grant',
      clientId: 'c1',
      recipientEmail: 'pat@example.com',
      clientName: 'Pat',
      programName: 'Grant',
      subject: 'Welcome',
      body: 'Hello',
      renderMode: 'verbatim',
      welcome: { source: 'program_template', templateId: null, templateName: null, versionId: null, versionNumber: null },
      nextStep: 'Hello',
      sentByUserId: 'staff-1',
    } as never);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    expect(sent).toEqual(expect.objectContaining({
      signatureText: 'The Grant Team <grants@ea.example>',
      signatureHtml: 'The Grant Team &lt;grants@ea.example&gt;',
      layout: 'center',
    }));
    expect(sent).not.toHaveProperty('programId');

    await service.sendWelcome('welcome-2', {
      organizationId: 'org-1', programId: 'p-edge', clientId: 'c1', recipientEmail: 'pat@example.com', clientName: 'Pat',
      programName: 'Edge', subject: 'Welcome', body: 'Hello', renderMode: 'verbatim',
      welcome: { source: 'program_template', templateId: null, templateName: null, versionId: null, versionNumber: null },
      nextStep: 'Hello', sentByUserId: 'staff-1',
    } as never);
    const edge = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));
    expect(edge).toEqual(expect.objectContaining({ layout: 'left', logoAtEdge: true }));
    fetchMock.mockRestore();
  });

  it('previews "left, logo at the edge": the logo has no margin, the message and sign-off keep theirs', () => {
    const edge = emailDocumentHtml('<p>Hello</p>', 'https://assets.example/logo.png', { layout: 'left-edge', signatureHtml: 'Warm regards,<br/>EA' });
    expect(edge).toContain('<td align="left" style="padding:0;">');
    expect(edge).toContain('<div style="max-width:600px;text-align:left;"><img src="https://assets.example/logo.png"');
    expect(edge).toContain('height:auto;border:0;margin:0;">');
    expect(edge).toContain('<div style="padding:24px;"><p>Hello</p><p>Warm regards,<br/>EA</p></div>');
    // Without a logo, the text header keeps the margin too.
    expect(emailDocumentHtml('<p>Hello</p>', null, { layout: 'left-edge' })).toContain(
      '<div style="padding:24px;"><div style="margin-bottom:24px;font-weight:bold;',
    );
    // The existing left layout is unchanged.
    expect(emailDocumentHtml('<p>Hello</p>', null, { layout: 'left' })).toContain('<td align="left" style="padding:24px;">');
  });

  it('sends "left, logo at the edge" to n8n as layout left plus logoAtEdge, never the new value', () => {
    expect(toWireStyle({ layout: 'left-edge', signatureText: 'x', signatureHtml: 'x' })).toEqual({
      layout: 'left', logoAtEdge: true, signatureText: 'x', signatureHtml: 'x',
    });
    expect(toWireStyle({ layout: 'left' })).toEqual({ layout: 'left' });
    expect(toWireStyle({ layout: 'center' })).toEqual({ layout: 'center' });
    expect(toWireStyle({})).toEqual({});
  });

  it("uses the sender's role signature first, then the program's, then the organization's", async () => {
    const db = setup();
    const settings = {
      emailSignature: 'Warm regards,\nEA Management Team',
      emailLayout: 'left',
      emailSignaturesByRole: { org_admin: 'Thank you,\nEAM Administration', reviewer: 'Thank you,\nEAM Staff', super_admin: '  ' },
    };
    // The role signature wins over a program's own signature.
    expect(await resolveEmailStyle(db, 'org-1', 'p-grant', settings, 'org_admin')).toEqual(expect.objectContaining({
      signatureText: 'Thank you,\nEAM Administration', signatureHtml: 'Thank you,<br/>EAM Administration', layout: 'center',
    }));
    expect(await resolveEmailStyle(db, 'org-1', 'p-idi', settings, 'reviewer')).toEqual(expect.objectContaining({ signatureText: 'Thank you,\nEAM Staff' }));
    // A super admin with a blank signature of their own uses the Admin one (Settings shows them as Admins).
    expect(await resolveEmailStyle(db, 'org-1', 'p-grant', settings, 'super_admin')).toEqual(expect.objectContaining({ signatureText: 'Thank you,\nEAM Administration' }));
    // A role with no signature, or no sender, falls back as before.
    expect(await resolveEmailStyle(db, 'org-1', 'p-grant', { emailSignaturesByRole: { org_admin: 'A' } }, 'reviewer'))
      .toEqual(expect.objectContaining({ signatureText: 'The Grant Team <grants@ea.example>' }));
    expect(await resolveEmailStyle(db, 'org-1', 'p-idi', settings, null)).toEqual(expect.objectContaining({ signatureText: 'Warm regards,\nEA Management Team' }));
  });

  it('reads role signatures from staff: known roles only, each a valid signature', () => {
    expect(parseEmailSignaturesByRole({ org_admin: ' Thank you,\r\nEAM Administration ', reviewer: '' })).toEqual({
      org_admin: 'Thank you,\nEAM Administration', reviewer: null,
    });
    expect(parseEmailSignaturesByRole(null)).toEqual({});
    expect(() => parseEmailSignaturesByRole({ owner: 'x' })).toThrow('Unknown role "owner"');
    expect(() => parseEmailSignaturesByRole(['x'])).toThrow('by role');
    expect(() => parseEmailSignaturesByRole({ reviewer: 'x'.repeat(1001) })).toThrow('under 1000');
  });

  it("signs an email a staff member sent with their role's signature, never tells n8n who sent it, and ignores other organizations' users", async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      return new Response(JSON.stringify({ success: true, status: 'ACCEPTED', eventId: sent.eventId, sentAt: '2030-01-01T00:00:00.000Z' }), { status: 202 });
    });
    const values: Record<string, unknown> = {
      N8N_ENABLED: 'true', N8N_EMAIL_WEBHOOK_URL: 'https://n8n.example.com/webhook/intake', CLIENTFLOW_N8N_SECRET: 'webhook-secret', N8N_TIMEOUT_MS: 5000,
    };
    const service = new N8nService({ get: (key: string) => values[key] } as unknown as ConfigService<Environment, true>, setup());
    const base = {
      organizationId: 'org-1', programId: 'p-grant', clientId: 'c1', recipientEmail: 'pat@example.com', clientName: 'Pat',
      programName: 'Grant', subject: 'Welcome', body: 'Hello', renderMode: 'verbatim', nextStep: 'Hello', sentByUserId: 'staff-1',
      welcome: { source: 'program_template', templateId: null, templateName: null, versionId: null, versionNumber: null },
    };
    await service.sendWelcome('w-staff', { ...base, senderUserId: 'staff-1' } as never);
    await service.sendWelcome('w-auto', base as never);
    await service.sendWelcome('w-outsider', { ...base, senderUserId: 'outsider-1' } as never);
    const [staff, automatic, outsider] = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(staff).toEqual(expect.objectContaining({ signatureText: 'Thank you,\nEAM Staff' }));
    expect(staff).not.toHaveProperty('senderUserId');
    // No sender (automatic): the program's signature, as before.
    expect(automatic).toEqual(expect.objectContaining({ signatureText: 'The Grant Team <grants@ea.example>' }));
    // A user from another organization is not a sender here.
    expect(outsider).toEqual(expect.objectContaining({ signatureText: 'The Grant Team <grants@ea.example>' }));
    fetchMock.mockRestore();
  });
});
