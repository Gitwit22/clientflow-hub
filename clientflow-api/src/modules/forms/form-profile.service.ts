import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeFormFields } from './form-field-mapping';
import {
  CurrentProfile,
  diffProfile,
  mapAnswers,
  ProfileChange,
  profileUpdateFromAnswers,
  socialLinksOf,
} from './form-profile-mapper';

export interface ProfileActor {
  id: string;
  displayName: string;
}

export interface ProfileChangePreview {
  key: string;
  label: string;
  target: ProfileChange['target'];
  currentValue: string;
  newValue: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies a submitted form's answers to the client profile.
 *
 * The server owns the mapping: it loads the assignment and its template itself, recomputes every
 * value from the stored answers, and writes only the keys the caller approved. The browser never
 * supplies values, and the write merges into the client's CURRENT database state instead of
 * replacing `intake` from a possibly stale copy.
 */
@Injectable()
export class FormProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(organizationId: string, clientId: string, assignmentId: string): Promise<ProfileChangePreview[]> {
    const { mapped } = await this.loadMappedAnswers(this.prisma, organizationId, clientId, assignmentId);
    const client = await this.requireClient(this.prisma, organizationId, clientId);
    return diffProfile(mapped, client as CurrentProfile).map(
      ({ key, label, target, currentValue, newValue }) => ({ key, label, target, currentValue, newValue }),
    );
  }

  async apply(
    organizationId: string,
    actor: ProfileActor,
    clientId: string,
    assignmentId: string,
    approvedKeys: unknown,
  ) {
    if (
      !Array.isArray(approvedKeys)
      || approvedKeys.length === 0
      || !approvedKeys.every((key) => typeof key === 'string' && key.length > 0)
    ) {
      throw new BadRequestException('Choose at least one field to apply.');
    }
    const approved = new Set<string>(approvedKeys);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const { mapped, assignment, templateName } = await this.loadMappedAnswers(
            tx,
            organizationId,
            clientId,
            assignmentId,
          );
          const mappable = new Set(mapped.map((answer) => answer.key));
          const unknown = [...approved].filter((key) => !mappable.has(key));
          if (unknown.length > 0) {
            throw new BadRequestException(
              `These fields are not available from the submitted answers: ${unknown.join(', ')}.`,
            );
          }

          // Re-read inside the transaction so the merge uses the client as it is right now.
          const client = await this.requireClient(tx, organizationId, clientId);
          const changes = diffProfile(mapped, client as CurrentProfile).filter((change) =>
            approved.has(change.key),
          );
          if (changes.length === 0) return { client, applied: [] as string[] };

          const data: Prisma.CfClientUpdateInput = {};
          const intakeChanges: Record<string, string> = {};
          for (const change of changes) {
            if (change.target === 'socialLinks') {
              data.socialLinks = socialLinksOf(change.value);
            } else if (typeof change.value === 'string') {
              if (change.target === 'top') (data as Record<string, unknown>)[change.key] = change.value;
              else intakeChanges[change.key] = change.value;
            }
          }
          if (Object.keys(intakeChanges).length > 0) {
            const currentIntake = isRecord(client.intake) ? client.intake : {};
            data.intake = { ...currentIntake, ...intakeChanges };
          }

          const updated = await tx.cfClient.update({ where: { id: client.id }, data });
          await tx.cfActivityLog.create({
            data: {
              organizationId,
              clientId: client.id,
              enrollmentId: assignment.enrollmentId,
              actorUserId: actor.id,
              action: 'FORM_RESPONSES_APPLIED',
              description: `Applied ${changes.map((change) => change.label).join(', ')} from "${templateName}" to the client profile.`,
              user: actor.displayName,
              isDemo: client.isDemo,
            },
          });
          return { client: updated, applied: changes.map((change) => change.key) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 15_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('The client profile changed while applying. Reload and try again.');
      }
      throw error;
    }
  }

  /**
   * Staff edited a submitted form's answers: the client's profile follows the edited answers (as on
   * submit: names fill blanks only, the email never changes), and the stored intake submission shows
   * them too, so the profile's Intake card and Overview always match the latest answers.
   */
  async syncEditedAnswers(organizationId: string, actor: ProfileActor, assignmentId: string) {
    const assignment = await this.prisma.cfFormAssignment.findFirst({ where: { id: assignmentId, organizationId } });
    if (!assignment?.submittedAt || !isRecord(assignment.responses)) return { applied: [] as string[] };
    await this.prisma.cfIntakeSubmission.updateMany({
      where: { organizationId, formAssignmentId: assignment.id },
      data: { responsePayload: assignment.responses },
    });

    const { mapped, templateName } = await this.loadMappedAnswers(this.prisma, organizationId, assignment.clientId, assignment.id);
    const client = await this.requireClient(this.prisma, organizationId, assignment.clientId);
    const update = profileUpdateFromAnswers(mapped, client, 'submit');
    if (!update.labels.length) return { applied: [] as string[] };

    const { intake, ...columns } = update.data;
    await this.prisma.cfClient.update({
      where: { id: client.id },
      data: { ...columns, ...(intake ? { intake: intake as Prisma.InputJsonObject } : {}) },
    });
    await this.prisma.cfActivityLog.create({
      data: {
        organizationId,
        clientId: client.id,
        enrollmentId: assignment.enrollmentId,
        actorUserId: actor.id,
        action: 'FORM_RESPONSES_APPLIED',
        description: `Profile updated from edited answers on "${templateName}": ${update.labels.join(', ')}.`,
        user: actor.displayName,
        isDemo: client.isDemo,
      },
    });
    return { applied: update.labels };
  }

  private async requireClient(db: Prisma.TransactionClient | PrismaService, organizationId: string, clientId: string) {
    const client = await db.cfClient.findFirst({ where: { id: clientId, organizationId } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  /** The assignment must belong to this client and organization. */
  private async loadMappedAnswers(
    db: Prisma.TransactionClient | PrismaService,
    organizationId: string,
    clientId: string,
    assignmentId: string,
  ) {
    if (!assignmentId) throw new BadRequestException('assignmentId is required.');
    const assignment = await db.cfFormAssignment.findFirst({
      where: { id: assignmentId, organizationId, clientId },
    });
    if (!assignment) throw new NotFoundException('Form assignment not found for this client.');
    if (!isRecord(assignment.responses) || Object.keys(assignment.responses).length === 0) {
      throw new BadRequestException('This form has no submitted answers to apply.');
    }
    const template = await db.cfFormTemplate.findFirst({
      where: { id: assignment.formId, organizationId },
      select: { name: true, fields: true },
    });
    if (!template) throw new NotFoundException('Form template not found.');

    const mapped = mapAnswers(normalizeFormFields(template.fields), assignment.responses);
    return { assignment, mapped, templateName: template.name };
  }
}
