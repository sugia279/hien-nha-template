export class StudioError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function strictKeys(value, names) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== [...names].sort().join(',')
  )
    throw new StudioError(422, 'Unsupported request fields');
}
