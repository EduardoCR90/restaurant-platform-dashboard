import { sectionLabels, type SectionName } from '../../../shared/visual';
import type { JsonRecord } from '../../../shared/content';
import { asRecord } from './Fields';
const sections: Record<string, SectionName[]> = {
  inicio: ['hero', 'essence', 'featured', 'storyPreview', 'reservation'],
  carta: ['menu'],
  restaurante: ['hero', 'story', 'chef', 'gallery', 'reservation'],
  reservas: ['contact'],
};
export function HistoricalSections({
  document,
  onChange,
}: {
  document: JsonRecord;
  onChange: (document: JsonRecord) => void;
}) {
  const slug = String(asRecord(document.slug).current || '');
  const keys = sections[slug];
  if (!keys || (Array.isArray(document.blocks) && document.blocks.length)) return null;
  const composition = asRecord(document.composition),
    flags = asRecord(composition.sections);
  return (
    <fieldset>
      <legend>Secciones de la composición actual</legend>
      <p className="muted">
        Ocultar conserva los contenidos. No necesitas convertir la página a bloques para activar o
        desactivar una sección.
      </p>
      {keys.map((key) => (
        <label className="check" key={key}>
          <input
            type="checkbox"
            checked={flags[key] !== false}
            onChange={(e) => {
              const next = { ...flags };
              if (e.target.checked) delete next[key];
              else next[key] = false;
              onChange({ ...document, composition: { ...composition, sections: next } });
            }}
          />
          {sectionLabels[key]}
        </label>
      ))}
    </fieldset>
  );
}
