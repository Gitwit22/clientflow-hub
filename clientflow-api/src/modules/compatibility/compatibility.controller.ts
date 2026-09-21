import { All, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ScaffoldService } from '../../common/services/scaffold.service';

@Controller('admin/cf')
export class ClientflowCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Get('clients') listClients() { return this.scaffold.notImplemented('Clients'); }
  @Get('clients/:id') getClient() { return this.scaffold.notImplemented('Clients'); }
  @Post('clients') createClient() { return this.scaffold.notImplemented('Clients'); }
  @Patch('clients/:id') updateClient() { return this.scaffold.notImplemented('Clients'); }
  @Delete('clients/:id') deleteClient() { return this.scaffold.notImplemented('Clients'); }

  @Get('programs') listPrograms() { return this.scaffold.notImplemented('Programs'); }
  @Get('programs/:id/detail') getProgramDetail() { return this.scaffold.notImplemented('Programs'); }
  @Post('programs') createProgram() { return this.scaffold.notImplemented('Programs'); }
  @Patch('programs/:id') updateProgram() { return this.scaffold.notImplemented('Programs'); }

  @Get('enrollments') listEnrollments() { return this.scaffold.notImplemented('Enrollments'); }
  @Get('enrollments/:id') getEnrollment() { return this.scaffold.notImplemented('Enrollments'); }
  @Get('enrollments/:id/history') getEnrollmentHistory() { return this.scaffold.notImplemented('Enrollments'); }
  @Post('enrollments') createEnrollment() { return this.scaffold.notImplemented('Enrollments'); }
  @Patch('enrollments/:id') updateEnrollment() { return this.scaffold.notImplemented('Enrollments'); }

  @Get('form-templates') listFormTemplates() { return this.scaffold.notImplemented('Form templates'); }
  @Post('form-templates') createFormTemplate() { return this.scaffold.notImplemented('Form templates'); }
  @Patch('form-templates/:id') updateFormTemplate() { return this.scaffold.notImplemented('Form templates'); }
  @Delete('form-templates/:id') deleteFormTemplate() { return this.scaffold.notImplemented('Form templates'); }
  @Get('form-assignments') listFormAssignments() { return this.scaffold.notImplemented('Form assignments'); }
  @Post('form-assignments') createFormAssignment() { return this.scaffold.notImplemented('Form assignments'); }
  @Post('form-assignments/:id/send') sendFormAssignment() { return this.scaffold.notImplemented('Form email delivery'); }
  @Patch('form-assignments/:id') updateFormAssignment() { return this.scaffold.notImplemented('Form assignments'); }
  @Get('intake-submissions') listIntakeSubmissions() { return this.scaffold.notImplemented('Intake submissions'); }
  @Get('intake-submissions/:id') getIntakeSubmission() { return this.scaffold.notImplemented('Intake submissions'); }

  @Get('notifications') listNotifications() { return this.scaffold.notImplemented('Notifications'); }
  @Patch('notifications/read-all') markAllNotificationsRead() { return this.scaffold.notImplemented('Notifications'); }
  @Patch('notifications/:id/read') markNotificationRead() { return this.scaffold.notImplemented('Notifications'); }

  @Get('terms') listAllTerms() { return this.scaffold.notImplemented('Terms'); }
  @Get('monitoring') listAllMonitoring() { return this.scaffold.notImplemented('Monitoring'); }
  @Get('contracts') listAllContracts() { return this.scaffold.notImplemented('Contracts'); }
  @Get('documents') listAllDocuments() { return this.scaffold.notImplemented('Documents'); }
  @Get('communications') listAllCommunications() { return this.scaffold.notImplemented('Communications'); }
  @Get('final-reports') listAllFinalReports() { return this.scaffold.notImplemented('Final reports'); }

  @Get('clients/:clientId/terms') listTerms() { return this.scaffold.notImplemented('Terms'); }
  @Post('clients/:clientId/terms') createTerms() { return this.scaffold.notImplemented('Terms'); }
  @Patch('terms/:id') updateTerms() { return this.scaffold.notImplemented('Terms'); }
  @Post('enrollments/:enrollmentId/monitoring') createMonitoring() { return this.scaffold.notImplemented('Monitoring'); }
  @Post('enrollment-monitoring/:id/results') recordMonitoringResult() { return this.scaffold.notImplemented('Monitoring'); }
  @Get('enrollment-monitoring/:id/history') getMonitoringHistory() { return this.scaffold.notImplemented('Monitoring'); }
  @Get('clients/:clientId/contracts') listContracts() { return this.scaffold.notImplemented('Contracts'); }
  @Post('clients/:clientId/contracts') createContract() { return this.scaffold.notImplemented('Contracts'); }
  @Patch('contracts/:id') updateContract() { return this.scaffold.notImplemented('Contracts'); }

  @Get('clients/:clientId/documents') listDocuments() { return this.scaffold.notImplemented('Documents'); }
  @Post('clients/:clientId/documents/upload-intent') createUploadIntent() { return this.scaffold.notImplemented('Document storage'); }
  @Post('documents/:id/complete-upload') completeUpload() { return this.scaffold.notImplemented('Document storage'); }
  @Get('documents/:id/download') downloadDocument() { return this.scaffold.notImplemented('Document storage'); }
  @Get('clients/:clientId/communications') listCommunications() { return this.scaffold.notImplemented('Communications'); }
  @Post('clients/:clientId/communications') createCommunication() { return this.scaffold.notImplemented('Communications'); }
  @Get('clients/:clientId/final-reports') listFinalReports() { return this.scaffold.notImplemented('Final reports'); }
  @Post('clients/:clientId/final-reports') createFinalReport() { return this.scaffold.notImplemented('Final reports'); }
  @Get('activity') listActivity() { return this.scaffold.notImplemented('Activity'); }
  @Get('clients/:clientId/activity') listClientActivity() { return this.scaffold.notImplemented('Activity'); }
  @Post('activity') createActivity() { return this.scaffold.notImplemented('Activity'); }
  @Get('demo-status') getDemoStatus() { return this.scaffold.notImplemented('Demo transition'); }
  @Post('seed-demo') seedDemo() { return this.scaffold.notImplemented('Demo transition'); }
  @Post('remove-demo') removeDemo() { return this.scaffold.notImplemented('Demo transition'); }
}

@Controller('public/form')
export class PublicFormCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Get(':token') getForm() { return this.scaffold.notImplemented('Public forms'); }
  @Post(':token/submit') submitForm() { return this.scaffold.notImplemented('Public forms'); }
}

@Controller('auth')
export class AuthCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Post('login') login() { return this.scaffold.notImplemented('Authentication'); }
  @Post('refresh') refresh() { return this.scaffold.notImplemented('Authentication'); }
  @Post('logout') logout() { return this.scaffold.notImplemented('Authentication'); }
  @Get('me') getMe() { return this.scaffold.notImplemented('Authentication'); }
  @Patch('me') updateMe() { return this.scaffold.notImplemented('Authentication'); }
  @Post('change-password') changePassword() { return this.scaffold.notImplemented('Authentication'); }
  @Get('session') getSession() { return this.scaffold.notImplemented('Authentication'); }
  @Get('validate-invite') validateInvite() { return this.scaffold.notImplemented('Authentication'); }
  @Post('accept-invite') acceptInvite() { return this.scaffold.notImplemented('Authentication'); }
}

@Controller('organizations')
export class OrganizationsCompatibilityController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @Get(':orgId/settings') getSettings() { return this.scaffold.notImplemented('Organizations'); }
  @Patch(':orgId/settings') updateSettings() { return this.scaffold.notImplemented('Organizations'); }
  @Get(':orgId/members') listMembers() { return this.scaffold.notImplemented('Organizations'); }
  @Post(':orgId/invitations') inviteMember() { return this.scaffold.notImplemented('Organizations'); }
  @Post(':orgId/invitations/:memberId/revoke') revokeInvite() { return this.scaffold.notImplemented('Organizations'); }
  @Patch(':orgId/members/:memberId/role') updateMemberRole() { return this.scaffold.notImplemented('Organizations'); }
  @Post(':orgId/members/:memberId/disable') disableMember() { return this.scaffold.notImplemented('Organizations'); }
  @Post(':orgId/members/:memberId/enable') enableMember() { return this.scaffold.notImplemented('Organizations'); }
}

@Controller('api-boundary')
export class FutureApiBoundaryController {
  constructor(private readonly scaffold: ScaffoldService) {}

  @All('*') futureBoundary() { return this.scaffold.notImplemented('Normalized ClientFlow API'); }
}
