import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Who may manage an organization and its members. Every role change, invite, member
 * enable/disable, settings change and live-mode switch goes through these checks.
 */
export const ADMIN_ROLES = ['super_admin', 'org_admin', 'reviewer'] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

const MANAGER_ROLES: readonly string[] = ['super_admin', 'org_admin'];

export interface RoleActor {
  id: string;
  role: string;
}

export function isManager(actor: RoleActor): boolean {
  return MANAGER_ROLES.includes(actor.role);
}

/** Organization settings, invites, member changes and live mode need an org_admin or super_admin. */
export function requireManager(actor: RoleActor): void {
  if (!isManager(actor)) throw new ForbiddenException('Only organization admins can manage this organization.');
}

export function parseRole(value: unknown): AdminRoleName {
  if (typeof value !== 'string' || !(ADMIN_ROLES as readonly string[]).includes(value)) {
    throw new BadRequestException(`Role must be one of: ${ADMIN_ROLES.join(', ')}.`);
  }
  return value as AdminRoleName;
}

/** Only a super_admin may grant super_admin. */
export function assertCanGrantRole(actor: RoleActor, role: AdminRoleName): void {
  requireManager(actor);
  if (role === 'super_admin' && actor.role !== 'super_admin') {
    throw new ForbiddenException('Only a super admin can grant the super admin role.');
  }
}

/**
 * Changing another member (role, enable/disable, revoke): nobody changes their own role or
 * access, and only a super_admin can change a super_admin.
 */
export function assertCanManageMember(actor: RoleActor, member: RoleActor): void {
  requireManager(actor);
  if (actor.id === member.id) throw new ForbiddenException('You cannot change your own role or access.');
  if (member.role === 'super_admin' && actor.role !== 'super_admin') {
    throw new ForbiddenException('Only a super admin can change another super admin.');
  }
}
