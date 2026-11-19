import { assertContractVersionContent, welcomeVersionContent } from './workflow-version-content';

describe('workflow version content', () => {
  it('requires a welcome subject and message', () => {
    expect(welcomeVersionContent({ subject: ' Welcome! ', body: ' Hi {{clientFirstName}} ' })).toEqual({
      subject: 'Welcome!',
      body: 'Hi {{clientFirstName}}',
    });
    expect(welcomeVersionContent({ programName: 'Grant', body: 'Hi' }).subject).toBe('Welcome to Grant');
    expect(() => welcomeVersionContent({ subject: 'Welcome', body: '   ' })).toThrow('needs a message');
    expect(() => welcomeVersionContent({ subject: '  ', body: 'Hi' })).toThrow('needs a subject');
  });

  it('requires agreement text, even when a document is uploaded', () => {
    expect(() => assertContractVersionContent({ content: 'Terms…' })).not.toThrow();
    expect(() => assertContractVersionContent({ content: 'Terms…', storedFileId: 'file-1' })).not.toThrow();
    // A document alone would send the client a blank agreement to sign.
    expect(() => assertContractVersionContent({ storedFileId: 'file-1' })).toThrow('Add the agreement text');
    expect(() => assertContractVersionContent({ content: '  ' })).toThrow('Add the contract text');
  });
});
