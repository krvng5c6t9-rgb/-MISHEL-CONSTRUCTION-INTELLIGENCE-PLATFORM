import { Navigate, Outlet } from 'react-router-dom';
import { getToken } from '../lib/api';

export function ProtectedRoute() {
  return getToken() ? <Outlet /> : <Navigate to="/login" replace />;
}
