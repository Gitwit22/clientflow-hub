import { answerFields, labelledAnswers } from './answer-list';

describe('labelledAnswers', () => {
  const fields = answerFields([
    { id: 'name', label: 'Business name', type: 'text' },
    { id: 'sign', label: 'Signature', type: 'signature' },
    { label: 'no id' },
  ]);

  it('labels flat stored answers in form order', () => {
    expect(labelledAnswers(fields, { sign: 'Pat', name: 'Acme' })).toEqual([
      { fieldId: 'name', label: 'Business name', type: 'text', value: 'Acme' },
      { fieldId: 'sign', label: 'Signature', type: 'signature', value: 'Pat' },
    ]);
  });

  it('keeps answers to fields that were removed from the form', () => {
    expect(labelledAnswers(fields, { name: 'Acme', oldQuestion: 'yes' })).toEqual([
      { fieldId: 'name', label: 'Business name', type: 'text', value: 'Acme' },
      { fieldId: 'oldQuestion', label: 'oldQuestion', value: 'yes' },
    ]);
  });

  it('passes an already-labelled list through and ignores anything else', () => {
    const list = [{ fieldId: 'a', label: 'A', value: 1 }];
    expect(labelledAnswers(fields, list)).toBe(list);
    expect(labelledAnswers(fields, null)).toEqual([]);
  });
});
