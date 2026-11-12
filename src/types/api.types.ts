// 클라이언트 요청/응답 DTO 타입 정의
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    fallbackAction?: string;
  };
}
