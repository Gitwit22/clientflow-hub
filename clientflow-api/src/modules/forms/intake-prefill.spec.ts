import { buildIntakePrefill, buildProgramPrefill } from './intake-prefill';

const client = {
  primaryContactName: 'John Steele',
  businessName: 'Nxt Lvl Technology Solutions LLC',
  email: 'john@example.com',
  phone: '3137041654',
  website: 'https://nxtlvl.tech',
  socialLinks: ['https://instagram.com/nxtlvl'],
  intake: { businessDescription: 'IT services (corrected by staff)', budgetNeed: '', uploadedFiles: ['a.pdf'] },
};

describe('buildIntakePrefill', () => {
  it('fills profile questions from the profile and the rest from the previous answers', () => {
    const fields = [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'email', label: 'Email', type: 'email' },
      { id: 'business-website', label: 'Business website', type: 'url' },
      { id: 'brief-business-description', label: 'Brief business description', type: 'textarea' },
      { id: 'budget', label: 'Budget or funding need', type: 'text' },
      { id: 'social', label: 'Social media', type: 'social_links' },
      { id: 'years-in-business', label: 'Years in business', type: 'number' },
      { id: 'services', label: 'Services you offer', type: 'checkbox' },
      { id: 'logo', label: 'Logo', type: 'file' },
      { id: 'sign', label: 'Signature', type: 'signature' },
    ];
    const previous = {
      'brief-business-description': 'IT services',
      budget: '$5,000',
      'years-in-business': 4,
      services: ['Repairs', 'Networking'],
      logo: 'stored-file-1',
      sign: 'John',
    };

    expect(buildIntakePrefill(fields, client, previous)).toEqual({
      name: 'John Steele',
      email: 'john@example.com',
      'business-website': 'https://nxtlvl.tech',
      // Staff corrected it on the profile, so the profile wins over the old answer.
      'brief-business-description': 'IT services (corrected by staff)',
      // Blank on the profile: the client's previous answer is kept.
      budget: '$5,000',
      social: ['https://instagram.com/nxtlvl'],
      'years-in-business': '4',
      services: ['Repairs', 'Networking'],
    });
  });

  it('works with no previous submission and ignores values it cannot show', () => {
    expect(buildIntakePrefill([{ id: 'phone', label: 'Phone', type: 'phone' }], client)).toEqual({ phone: '3137041654' });
    expect(buildIntakePrefill([{ id: 'x', label: 'Anything', type: 'text' }], null, { x: { nested: true } })).toEqual({});
  });
});

describe('buildProgramPrefill', () => {
  it('repeats the previous program answers', () => {
    expect(
      buildProgramPrefill(
        [{ id: 'goal', label: 'Your goal', type: 'textarea' }, { id: 'upload', label: 'Upload', type: 'file' }],
        { goal: 'Grow sales', upload: 'f1' },
      ),
    ).toEqual({ goal: 'Grow sales' });
  });
});
