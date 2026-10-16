export class MgoError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryable = false) {
    super(message);
    this.name = "MgoError";
  }
}
export function publicError(error: unknown): MgoError {
  if (error instanceof MgoError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new MgoError("TIMEOUT", "等待服务响应超时了，当前点单内容会保留。", 504);
  }
  return new MgoError("SERVICE_ERROR", "服务暂时没有回应，请稍后再试。", 502);
}
