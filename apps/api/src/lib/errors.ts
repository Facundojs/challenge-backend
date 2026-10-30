export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, `${what} no encontrado`);
export const invalid = (msg: string) => new AppError(422, msg);
export const conflict = (msg: string) => new AppError(409, msg);
