import { expect } from 'vitest';
import { DomainError } from '../../src/shared/errors.js';

/** Asserts that `fn` throws a DomainError with the given code and returns it for further checks. */
export function expectDomainError(fn: () => unknown, code: string): DomainError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof DomainError).toBe(true);
  const error = caught as DomainError;
  expect(error.code).toBe(code);
  return error;
}

export async function expectDomainErrorAsync(promise: Promise<unknown>, code: string): Promise<DomainError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught instanceof DomainError).toBe(true);
  const error = caught as DomainError;
  expect(error.code).toBe(code);
  return error;
}
