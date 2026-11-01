import { variantsForBlock, optionLabels } from '../../../shared/visual';
import { useState } from 'react';
import { blockNames, type JsonRecord } from '../../../shared/content';
import { FormFields, move, type ReferenceOptions, asRecord } from './Fields';
import { blockFields } from './fields';
const blockLabels: Record<string, string> = {
  hero: 'Hero / Presentación',
  richText: 'Texto enriquecido',
  imageText: 'Imagen y texto',
  galleryBlock: 'Galería',
  menuSection: 'Carta y platos',
  cards: 'Tarjetas editoriales',
  cta: 'Llamada a la acción',
  faq: 'Preguntas frecuentes',
  divider: 'Separador',
  notice: 'Aviso',
};
export function BlockEditor({
  value,
  onChange,
  options,
  historical = false,
  visualEnabled = true,
}: {
  historical?: boolean;
  visualEnabled?: boolean;
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
        Una lista vacía conserva la composición predefinida, si existe. Los bloques con variante
        propia la conservan; selecciona Heredar para usar el preset.
      </p>
      {blocks.map((block, i) => {
        const name = block._type as (typeof blockNames)[number];
        return (
          <details className="block-panel" key={String(block._key)} open>
            <summary>
              {i + 1}. {String(block.title || blockLabels[name] || name)}{' '}
              {block.enabled === false && '· Oculto'}
            </summary>
            <div className="array-tools">
              {visualEnabled && (
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      blocks.map((old, n) =>
                        n === i ? { ...old, enabled: old.enabled === false } : old,
                      ),
                    )
                  }
                >
                  {block.enabled === false ? 'Mostrar' : 'Ocultar'} bloque {i + 1}
                </button>
              )}
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
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `¿Quitar este bloque de la composición? Se conservarán sus imágenes.${historical && blocks.length === 1 ? ' La lista vacía recuperará la composición predefinida.' : ''}`,
                    )
                  )
                    onChange(blocks.filter((_, n) => n !== i));
                }}
              >
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
                    options: visualEnabled ? variantsForBlock(name) : ['editorial', 'compact'],
                    optionLabels,
                    allowInherit: true,
                  },
                  {
                    name: 'alignment',
                    label: 'Alineación',
                    type: 'select',
                    options: ['left', 'center'],
                    optionLabels: { left: 'Izquierda', center: 'Centro' },
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
              <option key={name} value={name}>
                {blockLabels[name]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            if (
              historical &&
              !blocks.length &&
              !window.confirm(
                'Añadir bloques sustituye la composición predefinida al publicar, sin borrar sus campos originales. ¿Continuar?',
              )
            )
              return;
            onChange([
              ...blocks,
              {
                _key: crypto.randomUUID(),
                _type: type,
                ...(visualEnabled ? { enabled: true } : { variant: 'editorial' }),
                alignment: 'left',
                ...(type === 'divider' ? { spacing: 'medium', line: true } : {}),
              },
            ]);
          }}
        >
          Añadir bloque
        </button>
      </div>
    </section>
  );
}
