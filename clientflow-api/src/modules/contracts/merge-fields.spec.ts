import {
  agreementContentHash,
  fieldsUsed,
  formatAgreementAmount,
  formatAgreementDate,
  renderMergeFields,
  templateFieldProblemMessage,
  templateFieldProblems,
} from './merge-fields';

describe('agreement merge fields', () => {
  it('lists each field a template uses once, in order', () => {
    expect(fieldsUsed('Hi {{client.contactName}} of {{ client.businessName }}, {{client.contactName}}.'))
      .toEqual(['client.contactName', 'client.businessName']);
    expect(fieldsUsed('No fields here.')).toEqual([]);
  });

  it('rejects unknown fields, and award fields outside award agreements', () => {
    expect(templateFieldProblems('{{client.businessName}} {{award.amount}}', 'award')).toEqual({ unknown: [], wrongPurpose: [] });
    expect(templateFieldProblems('{{client.bizname}} {{award.amount}}', 'enrollment')).toEqual({
      unknown: ['client.bizname'],
      wrongPurpose: ['award.amount'],
    });
    expect(templateFieldProblemMessage('{{client.bizname}}', 'enrollment')).toBe('Unknown merge field: {{client.bizname}}.');
    expect(templateFieldProblemMessage('{{award.amount}}', 'enrollment')).toContain('only be used in award agreements');
    expect(templateFieldProblemMessage('{{today}}', 'enrollment')).toBeNull();
  });

  it('fills known fields as plain text and reports the ones with no value', () => {
    const rendered = renderMergeFields(
      'Business: {{client.businessName}}\nAmount: {{award.amount}}\nRep: {{client.contactName}}',
      { 'client.businessName': 'Rivers Bakery LLC', 'award.amount': '$500.00', 'client.contactName': '   ' },
    );
    expect(rendered.text).toBe('Business: Rivers Bakery LLC\nAmount: $500.00\nRep: {{client.contactName}}');
    expect(rendered.missing).toEqual([{ key: 'client.contactName', label: 'Client contact name' }]);
  });

  it('leaves unknown placeholders from older versions exactly as written', () => {
    expect(renderMergeFields('Keep {{legacy.thing}} as is', {})).toEqual({ text: 'Keep {{legacy.thing}} as is', missing: [] });
  });

  it('renders templates without fields unchanged (every existing template)', () => {
    const content = 'SERVICE AGREEMENT\n\nThe parties agree to the following terms.';
    expect(renderMergeFields(content, {})).toEqual({ text: content, missing: [] });
  });

  it('fingerprints exactly the reviewed title and text', () => {
    const hash = agreementContentHash('Award Agreement', 'Amount: $500.00');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(agreementContentHash('Award Agreement', 'Amount: $500.00')).toBe(hash);
    expect(agreementContentHash('Award Agreement', 'Amount: $5,000.00')).not.toBe(hash);
    expect(agreementContentHash('Other Agreement', 'Amount: $500.00')).not.toBe(hash);
  });

  it('formats dates and amounts the way agreements show them', () => {
    expect(formatAgreementDate(new Date('2026-11-12T00:00:00.000Z'))).toBe('November 12, 2026');
    expect(formatAgreementDate(new Date('2026-11-13T03:00:00.000Z'), 'America/Detroit')).toBe('November 12, 2026');
    expect(formatAgreementDate(null)).toBeNull();
    expect(formatAgreementAmount(5000)).toBe('$5,000.00');
    expect(formatAgreementAmount('2500.5')).toBe('$2,500.50');
    expect(formatAgreementAmount({ toString: () => '500' })).toBe('$500.00');
    expect(formatAgreementAmount('not a number')).toBeNull();
  });
});
