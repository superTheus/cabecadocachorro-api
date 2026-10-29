/** Safe across HTTP/logging boundaries; never contains upstream bodies or secrets. */
export class MuiraSoftError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'MuiraSoftError';
  }
}
