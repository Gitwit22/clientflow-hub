import { isLegacyContract, LEGACY_CONTRACT_HEADER } from './legacy-contract';

describe('isLegacyContract', () => {
  const real = { staffSignedAt: new Date(), contractTemplateId: 'template-1', generatedContent: 'Agreement' };

  it('recognizes drafts saved by the old in-browser builder', () => {
    expect(isLegacyContract({ staffSignedAt: null, contractTemplateId: '', generatedContent: 'This agreement…' })).toBe(true);
    expect(isLegacyContract({
      staffSignedAt: null, contractTemplateId: 'Service Agreement', generatedContent: `${LEGACY_CONTRACT_HEADER}\n\nThis agreement…`,
    })).toBe(true);
  });

  it('never flags a contract the workflow generated (always staff-signed on creation)', () => {
    expect(isLegacyContract(real)).toBe(false);
    expect(isLegacyContract({ ...real, contractTemplateId: '' })).toBe(false);
  });
});
