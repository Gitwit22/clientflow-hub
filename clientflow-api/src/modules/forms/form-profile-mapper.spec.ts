import { canonicalFieldKey, FormFieldShape, normalizeFormFields } from './form-field-mapping';
import { answerText, diffProfile, mapAnswers, CurrentProfile, profileUpdateFromAnswers } from './form-profile-mapper';

const field = (id: string, extra: Partial<FormFieldShape> = {}): FormFieldShape => ({
  id,
  label: id,
  type: 'text',
  required: false,
  ...extra,
});

const profile = (overrides: Partial<CurrentProfile> = {}): CurrentProfile => ({
  businessName: 'Old Biz',
  primaryContactName: 'Old Name',
  email: 'old@example.com',
  phone: '555',
  website: null,
  socialLinks: [],
  intake: { businessDescription: 'Old description', uploadedFiles: ['a.pdf'] },
  ...overrides,
});

describe('canonicalFieldKey', () => {
  it('maps aliases and prefill keys, including the sponsor and preferred-contact cases', () => {
    expect(canonicalFieldKey(field('bizName'))).toBe('businessName');
    expect(canonicalFieldKey(field('sponsor'))).toBe('businessName');
    expect(canonicalFieldKey(field('x', { prefillKey: 'email' }))).toBe('email');
    expect(canonicalFieldKey(field('contact', { label: 'Preferred contact method' }))).toBe('preferredContact');
    expect(canonicalFieldKey(field('contact', { label: 'Contact name' }))).toBe('primaryContactName');
    expect(canonicalFieldKey(field('programSpecificQuestion'))).toBeNull();
  });
});

describe('normalizeFormFields', () => {
  it('drops malformed and duplicate fields and defaults unknown types', () => {
    const fields = normalizeFormFields([
      { id: 'a', label: 'A', type: 'bogus' },
      { id: 'a', label: 'dupe' },
      null,
      { label: 'no id' },
      { id: 'b', type: 'social_links' },
    ]);
    expect(fields.map((f) => [f.id, f.type])).toEqual([['a', 'text'], ['b', 'social_links']]);
    expect(normalizeFormFields('nope')).toEqual([]);
  });
});

describe('answerText', () => {
  it('only lets strings and numbers through', () => {
    expect(answerText('  hi ')).toBe('hi');
    expect(answerText(12)).toBe('12');
    expect(answerText(true)).toBe('');
    expect(answerText(['a'])).toBe('');
    expect(answerText({ a: 1 })).toBe('');
    expect(answerText(null)).toBe('');
    expect(answerText(NaN)).toBe('');
  });
});

describe('mapAnswers', () => {
  it('maps answers to profile keys and never lets non-string answers reach a text column', () => {
    const mapped = mapAnswers(
      [field('email'), field('description'), field('phone'), field('budget'), field('extra')],
      { email: 'new@example.com', description: ['not', 'text'], phone: true, budget: 5000, extra: 'ignored' },
    );
    expect(mapped.map((m) => [m.key, m.target, m.value])).toEqual([
      ['email', 'top', 'new@example.com'],
      ['budgetNeed', 'intake', '5000'],
    ]);
  });

  it('lets the first field for a key win and skips blank answers', () => {
    const mapped = mapAnswers([field('business'), field('bizName'), field('website')], {
      business: 'First',
      bizName: 'Second',
      website: '   ',
    });
    expect(mapped).toEqual([expect.objectContaining({ key: 'businessName', value: 'First' })]);
  });

  it('collects a repeatable social_links answer as a deduplicated string array', () => {
    const mapped = mapAnswers([field('links', { type: 'social_links' })], {
      links: ['https://a.test', ' https://A.test ', '', 'https://b.test'],
    });
    expect(mapped).toEqual([
      expect.objectContaining({ key: 'socialLinks', target: 'socialLinks', value: ['https://a.test', 'https://b.test'] }),
    ]);
  });

  it('collects legacy per-platform social fields', () => {
    const mapped = mapAnswers([field('facebookUrl'), field('instagramUrl')], {
      facebookUrl: 'https://facebook.com/x',
      instagramUrl: 'https://instagram.com/x',
    });
    expect(mapped[0].value).toEqual(['https://facebook.com/x', 'https://instagram.com/x']);
  });
});

describe('diffProfile', () => {
  it('returns only answers that differ from the current profile', () => {
    const mapped = mapAnswers([field('email'), field('phone'), field('description')], {
      email: 'new@example.com',
      phone: '555',
      description: 'Old description',
    });
    const changes = diffProfile(mapped, profile());
    expect(changes).toEqual([
      expect.objectContaining({ key: 'email', currentValue: 'old@example.com', newValue: 'new@example.com' }),
    ]);
  });

  it('compares intake values and social links against current state', () => {
    const mapped = mapAnswers([field('description'), field('links', { type: 'social_links' })], {
      description: 'Fresh description',
      links: ['https://a.test'],
    });
    expect(diffProfile(mapped, profile()).map((c) => c.key)).toEqual(['businessDescription', 'socialLinks']);
    expect(diffProfile(mapped, profile({ socialLinks: ['https://A.test'] })).map((c) => c.key)).toEqual([
      'businessDescription',
    ]);
  });

  it('tolerates a null or malformed intake', () => {
    const mapped = mapAnswers([field('description')], { description: 'x' });
    expect(diffProfile(mapped, profile({ intake: null })).map((c) => c.key)).toEqual(['businessDescription']);
  });
});

describe('profileUpdateFromAnswers', () => {
  const fields = [
    field('businessName'),
    field('primaryContactName'),
    field('email'),
    field('phone'),
    field('businessDescription'),
    field('assistanceRequested'),
  ];
  const answers = {
    businessName: 'New Biz',
    primaryContactName: 'New Name',
    email: 'new@example.com',
    phone: '313-555-0177',
    businessDescription: 'We bake bread',
    assistanceRequested: 'Funding',
  };

  it('on submit, the answers become the profile but names only fill blanks and email never changes', () => {
    const update = profileUpdateFromAnswers(mapAnswers(fields, answers), profile(), 'submit');
    expect(update.data).toEqual({
      phone: '313-555-0177',
      intake: { businessDescription: 'We bake bread', assistanceRequested: 'Funding', uploadedFiles: ['a.pdf'] },
    });
    expect(update.labels).toEqual(['Phone', 'Business description', 'Assistance requested']);

    const blankNames = profileUpdateFromAnswers(
      mapAnswers(fields, answers),
      profile({ businessName: '', primaryContactName: ' ' }),
      'submit',
    );
    expect(blankNames.data).toMatchObject({ businessName: 'New Biz', primaryContactName: 'New Name' });
    expect(blankNames.data).not.toHaveProperty('email');
  });

  it('when catching up, only blank fields are filled', () => {
    const update = profileUpdateFromAnswers(mapAnswers(fields, answers), profile(), 'fill-blanks');
    expect(update.data).toEqual({
      intake: { businessDescription: 'Old description', assistanceRequested: 'Funding', uploadedFiles: ['a.pdf'] },
    });
    expect(update.labels).toEqual(['Assistance requested']);
  });

  it('returns nothing to write when the profile already matches', () => {
    const update = profileUpdateFromAnswers(
      mapAnswers(fields, { businessDescription: 'Old description' }),
      profile(),
      'submit',
    );
    expect(update).toEqual({ data: {}, labels: [] });
  });
});

describe('links from answers', () => {
  it('stores website and social links as openable https addresses, keeping handles as typed', () => {
    const mapped = mapAnswers(
      [field('website'), field('socials', { type: 'social_links' })],
      { website: 'eabakery.com', socials: ['instagram.com/eabakery', '@eabakery', 'https://x.com/eabakery'] },
    );
    expect(mapped).toEqual([
      expect.objectContaining({ key: 'website', value: 'https://eabakery.com' }),
      expect.objectContaining({
        key: 'socialLinks',
        value: ['https://instagram.com/eabakery', '@eabakery', 'https://x.com/eabakery'],
      }),
    ]);
  });
});

describe('fields recognised by their label (form-editor ids are slugs of the label)', () => {
  const slugField = (label: string, type = 'text') =>
    field(label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), { label, type });

  it('maps the Master Intake questions as staff wrote them', () => {
    const fields = [
      slugField('Brief business description', 'textarea'),
      slugField('Type of assistance needed', 'textarea'),
      slugField('Preferred contact method', 'select'),
      slugField('Business website', 'url'),
      slugField('Business / Organization Name'),
      slugField('How did you hear about us?'),
      slugField('What type of business is it?'),
    ];
    const answers = {
      'brief-business-description': 'IT services for small businesses',
      'type-of-assistance-needed': 'Grant writing',
      'preferred-contact-method': 'Phone',
      'business-website': 'nxtlvltech.com',
      'business-organization-name': 'Nxt Lvl Technology',
      'how-did-you-hear-about-us': 'A friend',
      'what-type-of-business-is-it': 'Technology',
    };
    expect(Object.fromEntries(mapAnswers(fields, answers).map((a) => [a.key, a.value]))).toEqual({
      businessDescription: 'IT services for small businesses',
      assistanceRequested: 'Grant writing',
      preferredContact: 'Phone',
      website: 'https://nxtlvltech.com',
      businessName: 'Nxt Lvl Technology',
      heardAboutUs: 'A friend',
      businessType: 'Technology',
    });
  });

  it('falls back to the field type, and skips answers that are not that kind of value', () => {
    const fields = [slugField('Your site', 'url'), slugField('Do you have a website?', 'select'), slugField('Best number', 'phone')];
    expect(mapAnswers(fields, { 'your-site': 'Yes', 'do-you-have-a-website': 'Yes', 'best-number': '313-555-0100' })
      .map((a) => [a.key, a.value])).toEqual([['phone', '313-555-0100']]);
  });

  it('leaves program-specific questions alone', () => {
    expect(mapAnswers([slugField('How many employees do you have?')], { 'how-many-employees-do-you-have': '5' })).toEqual([]);
  });
});

describe('phone numbers by kind', () => {
  const slugField = (label: string, type = 'text') =>
    field(label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), { label, type });
  const byKey = (fields: FormFieldShape[], answers: Record<string, unknown>) =>
    Object.fromEntries(mapAnswers(fields, answers).map((a) => [a.key, a.value]));

  it('keeps work and cell numbers apart, with the plain phone as the profile phone', () => {
    expect(byKey(
      [slugField('Phone', 'phone'), slugField('Work number', 'phone'), slugField('Cell phone', 'phone')],
      { phone: '313-555-0100', 'work-number': '313-555-0200', 'cell-phone': '313-555-0300' },
    )).toEqual({ phone: '313-555-0100', workPhone: '313-555-0200', cellPhone: '313-555-0300' });
  });

  it('uses the cell (else the work) number as the profile phone when no plain phone was asked', () => {
    expect(byKey([slugField('Work phone'), slugField('Mobile number')], { 'work-phone': '313-555-0200', 'mobile-number': '313-555-0300' }))
      .toEqual({ workPhone: '313-555-0200', cellPhone: '313-555-0300', phone: '313-555-0300' });
    expect(byKey([slugField('Office phone')], { 'office-phone': '313-555-0200' }))
      .toEqual({ workPhone: '313-555-0200', phone: '313-555-0200' });
  });

  it('does not take other numbers for a phone', () => {
    expect(byKey([slugField('Tax ID number'), slugField('Number of employees')], { 'tax-id-number': '123456789', 'number-of-employees': '12' })).toEqual({});
  });
});
