import { RegisterDto } from './register.dto.js';

const VALID_EMAIL = 'user@example.com';
const VALID_PASSWORD = 'secret123';

function parse(input: unknown) {
  return RegisterDto.schema.safeParse(input);
}

function failedPaths(input: unknown) {
  const result = parse(input);
  expect(result.success).toBe(false);
  return result.error?.issues.map((issue) => issue.path);
}

describe('RegisterDto schema', () => {
  it('accepts valid input and returns normalized data', () => {
    const result = parse({
      email: '  User@Example.COM ',
      password: ' secret123 ',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      email: 'user@example.com',
      password: ' secret123 ',
    });
  });

  describe('email', () => {
    it('keeps plus-addressing as a distinct address', () => {
      const result = parse({
        email: 'User+Tag@example.com',
        password: VALID_PASSWORD,
      });

      expect(result.data?.email).toBe('user+tag@example.com');
    });

    it('accepts email of exactly 254 characters', () => {
      const email = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;
      expect(email).toHaveLength(254);

      expect(parse({ email, password: VALID_PASSWORD }).success).toBe(true);
    });

    it.each([
      ['malformed', 'nope'],
      ['empty', ''],
      ['whitespace only', '   '],
      ['missing domain', 'user@'],
      [
        'longer than 254 characters',
        `${'a'.repeat(64)}@${'b'.repeat(186)}.com`,
      ],
      ['not a string', 42],
    ])('rejects %s email', (_case, email) => {
      expect(failedPaths({ email, password: VALID_PASSWORD })).toEqual([
        ['email'],
      ]);
    });
  });

  describe('password', () => {
    it.each([
      ['exactly 8 characters', 'abcdefg1'],
      ['non-latin letters', 'пароль123'],
      // 'я' takes 2 bytes in UTF-8: 35 * 2 + 2 = 72 bytes, but only 37 characters
      ['exactly 72 bytes', 'я'.repeat(35) + '1a'],
    ])('accepts password with %s', (_case, password) => {
      expect(parse({ email: VALID_EMAIL, password }).success).toBe(true);
    });

    it.each([
      ['shorter than 8 characters', 'abcdef1'],
      ['no digit', 'secretsecret'],
      ['no letter', '12345678'],
      // 35 * 2 + 3 = 73 bytes: bcrypt would silently ignore the tail
      ['more than 72 bytes', 'я'.repeat(35) + '12a'],
      ['not a string', 12345678],
    ])('rejects password with %s', (_case, password) => {
      expect(failedPaths({ email: VALID_EMAIL, password })).toEqual([
        ['password'],
      ]);
    });
  });

  describe('object shape', () => {
    it('rejects unknown fields', () => {
      const result = parse({
        email: VALID_EMAIL,
        password: VALID_PASSWORD,
        role: 'admin',
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    });

    it.each([
      ['email', { password: VALID_PASSWORD }],
      ['password', { email: VALID_EMAIL }],
    ])('rejects missing %s', (field, input) => {
      expect(failedPaths(input)).toEqual([[field]]);
    });
  });
});
