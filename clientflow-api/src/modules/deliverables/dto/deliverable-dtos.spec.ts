import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateDeliverableTemplateDto,
  ReorderDeliverableTemplatesDto,
  SetProgramDeliverableDateDto,
} from './deliverable-template.dto';
import { UpdateEnrollmentDeliverableDto } from './update-enrollment-deliverable.dto';

const errors = <T extends object>(type: new () => T, body: object) =>
  validateSync(plainToInstance(type, body), { whitelist: true, forbidNonWhitelisted: true }).map((error) => error.property);

describe('deliverable request validation', () => {
  it('accepts a status with no date, a null date, and clearing notes', () => {
    expect(errors(UpdateEnrollmentDeliverableDto, { status: 'DELIVERED' })).toEqual([]);
    expect(errors(UpdateEnrollmentDeliverableDto, { status: 'AVAILABLE', scheduledFor: null, notes: null })).toEqual([]);
    expect(errors(UpdateEnrollmentDeliverableDto, { scheduledFor: '2026-10-21' })).toEqual([]);
  });

  it('refuses unknown statuses, bad dates, setting next action through PATCH and unknown fields', () => {
    expect(errors(UpdateEnrollmentDeliverableDto, { status: 'DONE' })).toEqual(['status']);
    expect(errors(UpdateEnrollmentDeliverableDto, { scheduledFor: 'next week' })).toEqual(['scheduledFor']);
    expect(errors(UpdateEnrollmentDeliverableDto, { isNextAction: true })).toEqual(['isNextAction']);
    expect(errors(UpdateEnrollmentDeliverableDto, { cycleId: 'x' })).toEqual(['cycleId']);
  });

  it('validates program deliverables', () => {
    expect(errors(CreateDeliverableTemplateDto, { title: 'Coaching Session', cadence: 'MONTHLY' })).toEqual([]);
    expect(errors(CreateDeliverableTemplateDto, { title: '', cadence: 'WEEKLY' })).toEqual(['title', 'cadence']);
    expect(errors(CreateDeliverableTemplateDto, { title: 'x', programId: 'other' })).toEqual(['programId']);
    expect(errors(ReorderDeliverableTemplatesDto, { orderedIds: ['a', 2] })).toEqual(['orderedIds']);
  });

  it('validates a program-wide date', () => {
    expect(errors(SetProgramDeliverableDateDto, { month: '2026-10', scheduledFor: '2026-10-18' })).toEqual([]);
    expect(errors(SetProgramDeliverableDateDto, { month: '2026-10', scheduledFor: null })).toEqual([]);
    expect(errors(SetProgramDeliverableDateDto, { month: '2026-13', scheduledFor: '2026-10-18T10:00:00Z' })).toEqual(['month', 'scheduledFor']);
    expect(errors(CreateDeliverableTemplateDto, { title: 'Grant Day', programWideDate: 'yes' })).toEqual(['programWideDate']);
  });
});
