import { canonicalFieldKey, FormFieldShape, normalizeFormFields } from './form-field-mapping';
import { answerText, diffProfile, mapAnswers, CurrentProfile } from './form-profile-mapper';

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
