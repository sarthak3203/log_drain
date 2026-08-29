declare global {
  namespace Express {
    interface Request {
      project_id?: string;
      api_key_id?: string;
      user_id?: string;
    }
  }
}

export interface Log {
  id: number;
  project_id: string;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG" | string;
  message: string;
  service: string;
  timestamp: Date;
  metadata: Record<string, any>;
  embedding?: number[]; // 1536-element array when populated (text-embedding-3-small)
  anomaly_score?: number;
  is_anomaly?: boolean;
}
export interface LogInput {
  level?: string;
  message: string;
  service?: string;
  timestamp?: string;
  metadata?: Record<string, any>;
}
export interface Project {
  id: string;
  owner_id: string;
  name: string;
  created_at: Date;
}
export interface User {
  id: string;
  email: string;
  name?: string | null;
  created_at: Date;
  updated_at: Date;
}
export interface ApiKey {
  id: string;
  project_id: string;
  key_hash: string;
  name?: string;
  created_at: Date;
  last_used?: Date;
  revoked: boolean;
}
export interface AlertRule {
  id: string;
  project_id: string;
  name?: string;
  condition: {
    type: "error_count" | "anomaly";
    threshold?: number;
    window_minutes?: number;
  };
  service?: string;
  notify_url?: string;
  notify_email?: string;
  active: boolean;
}
// This gets attached to every Express request after authentication
export interface AuthenticatedRequest extends Express.Request {
  project_id: string;
  api_key_id: string;
}

export interface AuthenticatedUserRequest extends Express.Request {
  user_id: string;
}
