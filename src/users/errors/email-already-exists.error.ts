export class EmailAlreadyExistsError extends Error {
  constructor() {
    super('User with this email already exists');
    this.name = 'EmailAlreadyExistsError';
  }
}
