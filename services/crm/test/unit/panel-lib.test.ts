import { describe, expect, it } from 'vitest';
import { buildHash, formatDate, formatMoney, pageWindow, parseHash, statusInfo } from '../../panel/lib.js';

describe('panel helpers', () => {
  it('formats money from minor units', () => {
    expect(formatMoney(320_000, 'TRY').replace(/\s/g, ' ')).toBe('₺3.200');
    expect(formatMoney(320_050, 'TRY')).toContain('3.200,50');
  });

  it('formats a calendar date without shifting the day', () => {
    expect(formatDate('2026-11-10')).toContain('10');
    expect(formatDate('2026-11-10')).toContain('2026');
    expect(formatDate(null)).toBe('-');
  });

  it('round-trips routes and filters through the URL hash', () => {
    const hash = buildHash(['guests'], { q: 'ayşe yılmaz', page: 2, tag: '', marketing: undefined });
    expect(hash).toBe('#/guests?q=ay%C5%9Fe+y%C4%B1lmaz&page=2');
    expect(parseHash(hash)).toEqual({ path: ['guests'], query: { q: 'ayşe yılmaz', page: '2' } });
    expect(parseHash('#/guests/abc-123')).toEqual({ path: ['guests', 'abc-123'], query: {} });
    expect(parseHash('')).toEqual({ path: [], query: {} });
  });

  it('shows a window of page numbers around the current page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 3, 4, 5, 6, 7, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 8, 9, 10]);
  });

  it('labels reservation statuses in Turkish and tolerates unknown ones', () => {
    expect(statusInfo('CANCELLED')).toEqual({ label: 'İptal', tone: 'bad' });
    expect(statusInfo('SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', tone: 'muted' });
  });
});
