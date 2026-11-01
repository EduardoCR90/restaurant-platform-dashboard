import type { JsonRecord, Kind } from './content.ts';

// Presentation is privileged. Content, block order and enabled remain editorial.
export const designBlockFields = [
  'variant',
  'alignment',
  'position',
  'width',
  'spacing',
  'line',
] as const;
const record = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonical(v)]),
  );
}
export function protectedDesign(kind: Kind, value: unknown): unknown {
  const doc = record(value);
  if (kind === 'settings') return canonical({ theme: doc.theme, logo: doc.logo });
  if (kind !== 'page') return {};
  return (Array.isArray(doc.blocks) ? doc.blocks : [])
    .map((item) => {
      const block = record(item);
      return canonical({
        _key: block._key,
        _type: block._type,
        ...Object.fromEntries(
          designBlockFields.filter((k) => k in block).map((k) => [k, block[k]]),
        ),
      });
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
export function designChanged(kind: Kind, before: unknown, after: unknown): boolean {
  return (
    JSON.stringify(protectedDesign(kind, before)) !== JSON.stringify(protectedDesign(kind, after))
  );
}
