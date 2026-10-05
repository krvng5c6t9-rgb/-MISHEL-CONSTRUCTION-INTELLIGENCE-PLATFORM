export type PermissionAction = 'view' | 'create' | 'edit' | 'approve' | 'delete' | 'export' | 'manage' | 'post';
export type PermissionScope = 'own' | 'department' | 'all';

export interface AuthPermission {
  module: string;
  action: PermissionAction;
  scope: PermissionScope;
}

export interface AuthUser {
  id: number;
  org_id: number;
  employee_id: number | null;
  role_id: number;
  role_name: string;
  full_name: string;
  email: string;
  user_type: 'internal' | 'client_portal' | 'subcontractor_portal';
  permissions: AuthPermission[];
}

export interface JwtPayload {
  sub: string;
  org_id: number;
  role_id: number;
  email: string;
}
