export function formatMoney(amountMinor: number, currency?: string): string;
export function formatDate(iso: string | null | undefined): string;
export function formatDateTime(iso: string | null | undefined): string;
export function parseHash(hash: string): { path: string[]; query: Record<string, string> };
export function buildHash(path: string[], query?: Record<string, string | number | undefined | null>): string;
export function pageWindow(page: number, totalPages: number, radius?: number): Array<number | null>;
export function statusInfo(status: string): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' };
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void;
