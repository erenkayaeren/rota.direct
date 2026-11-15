import { z } from 'zod';
import { parseLocalDate, type LocalDate } from '../../shared/local-date.js';

/** A calendar date as `YYYY-MM-DD`. Shape only: whether it is bookable is a domain rule. */
export const localDateSchema = z
  .string()
  .refine((value) => parseLocalDate(value) !== null, {
    message: 'must be a valid date in YYYY-MM-DD format',
  })
  .transform((value) => value as LocalDate);
