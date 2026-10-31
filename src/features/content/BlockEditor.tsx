import { useState } from 'react';
import { blockNames, type JsonRecord } from '../../../shared/content';
import { FormFields, move, type ReferenceOptions, asRecord } from './Fields';
import { blockFields } from './fields';
export function BlockEditor({
  value,
  onChange,
  options,
}: {
  value: unknown;
  onChange: (blocks: JsonRecord[]) => void;
  options: ReferenceOptions;
}) {
  const [type, setType] = useState<(typeof blockNames)[number]>('hero');
  const blocks = Array.isArray(value) ? value.map(asRecord) : [];
  return (
    <section className="block-editor">
      <p className="eyebrow">Composición de página</p>
      <h2>Bloques de contenido</h2>
      <p className="muted">
        La lista vacía conserva el diseño original de las cuatro páginas de Salitre. Añadir bloques
        sustituye su composición.
      </p>
      {blocks.map((block, i) => {
        const name = block._type as (typeof blockNames)[number];
        return (
          <details className="block-panel" key={String(block._key)} open>
            <summary>
              {i + 1}. {String(block.title || name)}
            </summary>
            <div className="array-tools">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => onChange(move(blocks, i, -1))}
              >
                Subir bloque {i + 1}
              </button>
              <button
                type="button"
                disabled={i === blocks.length - 1}
                onClick={() => onChange(move(blocks, i, 1))}
              >
                Bajar bloque {i + 1}
              </button>
              <button type="button" onClick={() => onChange(blocks.filter((_, n) => n !== i))}>
                Quitar bloque {i + 1}
              </button>
            </div>
            {blockFields[name] ? (
              <FormFields
                definitions={[
                  ...blockFields[name],
                  {
                    name: 'variant',
                    label: 'Presentación',
                    type: 'select',
                    options: ['editorial', 'compact'],
                  },
                  {
                    name: 'alignment',
                    label: 'Alineación',
                    type: 'select',
                    options: ['left', 'center'],
                  },
                ]}
                value={block}
                onChange={(next) => onChange(blocks.map((old, n) => (n === i ? next : old)))}
                options={options}
              />
            ) : (
              <p role="alert">Bloque desconocido. No se eliminará automáticamente.</p>
            )}
          </details>
        );
      })}
      <div className="add-block">
        <label>
          Tipo de bloque
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {blockNames.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...blocks,
              {
                _key: crypto.randomUUID(),
                _type: type,
                variant: 'editorial',
                alignment: 'left',
                ...(type === 'divider' ? { spacing: 'medium', line: true } : {}),
              },
            ])
          }
        >
          Añadir bloque
        </button>
      </div>
    </section>
  );
}
