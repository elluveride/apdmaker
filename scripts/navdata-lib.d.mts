export type Row = (string | number | null)[];

export function parseCsv(text: string): string[][];
export function csvRecords(text: string): Record<string, string>[];
export function airacCycle(date: Date): { effective: Date; ident: string };
export function nasrFixUrl(effective: Date): string;
export function tileKey(lat: number, lon: number, size: number): string;
export function packAirports(records: Record<string, string>[]): { major: Row[]; tiles: Record<string, Row[]> };
export function packNavaids(records: Record<string, string>[]): Row[];
export function packFixes(records: Record<string, string>[]): Record<string, Row[]>;
export function packDiagrams(xml: string): { cycle: string; from: string; to: string; apd: Record<string, string> };
