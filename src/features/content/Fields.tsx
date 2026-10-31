import { useId, useState } from 'react';
import type { JsonRecord } from '../../../shared/content';
import { contentApi } from '../../services/platform';
import { useRestaurant } from '../restaurants/RestaurantProvider';
import type { Field } from './fields';
export type ReferenceOptions = {
  category: { id: string; title: string }[];
  dish: { id: string; title: string }[];
};
export function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
const rows = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.map(asRecord) : []);
export function move<T>(values: T[], index: number, delta: number): T[] {
  const copy = [...values];
  const next = index + delta;
  if (next < 0 || next >= copy.length) return values;
  [copy[index], copy[next]] = [copy[next], copy[index]];
  return copy;
}
export function FormFields({
  definitions,
  value,
  onChange,
  options,
}: {
  definitions: Field[];
  value: JsonRecord;
  onChange: (value: JsonRecord) => void;
  options: ReferenceOptions;
}) {
  return (
    <>
      {definitions.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={field.name === 'self' ? value : value[field.name]}
          onChange={(next) =>
            onChange(field.name === 'self' ? asRecord(next) : { ...value, [field.name]: next })
          }
          options={options}
        />
      ))}
    </>
  );
}
function ImageField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const ctx = useRestaurant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = asRecord(value);
  const ref = asRecord(data.asset)._ref;
  const integration = ctx.data?.integrations.find((i) => i.restaurant_id === ctx.restaurant?.id);
  const match =
    typeof ref === 'string' ? ref.match(/^image-([a-z0-9]+)-(\d+x\d+)-(jpg|png|webp)$/) : null;
  const src =
    match && integration
      ? `https://cdn.sanity.io/images/${integration.external_project_id}/${integration.external_dataset}/${match[1]}-${match[2]}.${match[3]}?w=500&auto=format`
      : null;
  async function upload(file: File) {
    if (!ctx.restaurant) return;
    setBusy(true);
    setError('');
    try {
      const asset = await contentApi.upload(ctx.restaurant.id, file);
      onChange({
        ...data,
        _type: 'editorialImage',
        asset: { _type: 'reference', _ref: asset._id },
        alt: data.alt || '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la imagen');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="image-field">
      {src && <img src={src} alt={typeof data.alt === 'string' ? data.alt : ''} />}
      <label>
        Archivo JPEG, PNG o WebP · máximo 8 MiB
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {typeof ref === 'string' && (
        <>
          <label>
            Texto alternativo
            <input
              value={String(data.alt || '')}
              onChange={(e) => onChange({ ...data, alt: e.target.value })}
            />
          </label>
          <button type="button" onClick={() => onChange(null)}>
            Quitar de este documento
          </button>
        </>
      )}
      {busy && <p role="status">Subiendo imagen…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function PortableEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const paragraphs = rows(value);
  function set(index: number, next: JsonRecord) {
    onChange(paragraphs.map((p, i) => (i === index ? next : p)));
  }
  return (
    <div>
      {paragraphs.map((p, index) => (
        <section className="array-item" key={String(p._key)}>
          <div className="array-tools">
            <strong>Párrafo {index + 1}</strong>
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onChange(move(paragraphs, index, -1))}
            >
              Subir párrafo
            </button>
            <button
              type="button"
              disabled={index === paragraphs.length - 1}
              onClick={() => onChange(move(paragraphs, index, 1))}
            >
              Bajar párrafo
            </button>
            <button
              type="button"
              onClick={() => onChange(paragraphs.filter((_, i) => i !== index))}
            >
              Quitar párrafo
            </button>
          </div>
          <label>
            Estilo
            <select
              value={String(p.style || 'normal')}
              onChange={(e) => set(index, { ...p, style: e.target.value })}
            >
              {['normal', 'h2', 'h3', 'blockquote'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Lista
            <select
              value={String(p.listItem || '')}
              onChange={(e) => {
                const next = { ...p };
                if (e.target.value) next.listItem = e.target.value;
                else delete next.listItem;
                set(index, next);
              }}
            >
              <option value="">Sin lista</option>
              <option value="bullet">Viñetas</option>
              <option value="number">Numerada</option>
            </select>
          </label>
          {rows(p.children).map((span, s) => {
            function change(next: JsonRecord) {
              set(index, {
                ...p,
                children: rows(p.children).map((old, i) => (i === s ? next : old)),
              });
            }
            const marks = Array.isArray(span.marks) ? (span.marks as string[]) : [];
            return (
              <div key={String(span._key)} className="span-editor">
                <label>
                  Texto {s + 1}
                  <textarea
                    value={String(span.text || '')}
                    onChange={(e) => change({ ...span, text: e.target.value })}
                  />
                </label>
                {[
                  ...['strong', 'em'].map((name) => ({
                    id: name,
                    label: name === 'strong' ? 'Negrita' : 'Cursiva',
                  })),
                  ...rows(p.markDefs).map((def) => ({
                    id: String(def._key),
                    label: `Enlace: ${String(def.href)}`,
                  })),
                ].map((mark) => (
                  <label className="check" key={mark.id}>
                    <input
                      type="checkbox"
                      checked={marks.includes(mark.id)}
                      onChange={(e) =>
                        change({
                          ...span,
                          marks: e.target.checked
                            ? [...marks, mark.id]
                            : marks.filter((m) => m !== mark.id),
                        })
                      }
                    />
                    {mark.label}
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    set(index, { ...p, children: rows(p.children).filter((_, i) => i !== s) })
                  }
                >
                  Quitar fragmento
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() =>
              set(index, {
                ...p,
                children: [
                  ...rows(p.children),
                  { _type: 'span', _key: crypto.randomUUID(), text: '', marks: [] },
                ],
              })
            }
          >
            Añadir fragmento
          </button>
          {rows(p.markDefs).map((def, i) => (
            <label key={String(def._key)}>
              Destino del enlace {i + 1}
              <input
                value={String(def.href || '')}
                onChange={(e) =>
                  set(index, {
                    ...p,
                    markDefs: rows(p.markDefs).map((d, n) =>
                      n === i ? { ...d, href: e.target.value } : d,
                    ),
                  })
                }
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() =>
              set(index, {
                ...p,
                markDefs: [
                  ...rows(p.markDefs),
                  { _type: 'link', _key: crypto.randomUUID(), href: '/' },
                ],
              })
            }
          >
            Añadir enlace al párrafo
          </button>
        </section>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...paragraphs,
            {
              _type: 'block',
              _key: crypto.randomUUID(),
              style: 'normal',
              markDefs: [],
              children: [{ _type: 'span', _key: crypto.randomUUID(), text: '', marks: [] }],
            },
          ])
        }
      >
        Añadir párrafo
      </button>
    </div>
  );
}
function FieldInput({
  field,
  value,
  onChange,
  options,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  options: ReferenceOptions;
}) {
  const id = useId();
  const data = asRecord(value);
  if (field.type === 'object')
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {field.resettable && (
          <>
            <p>Sin personalizar conserva la composición y el texto originales.</p>
            <button type="button" onClick={() => onChange(undefined)}>
              Restaurar texto original: {field.label}
            </button>
          </>
        )}
        <FormFields
          definitions={field.fields || []}
          value={data}
          onChange={onChange}
          options={options}
        />
      </fieldset>
    );
  if (field.type === 'image')
    return (
      <fieldset>
        <legend>{field.label}</legend>
        <ImageField value={value} onChange={onChange} />
      </fieldset>
    );
  if (field.type === 'link')
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {field.resettable && (
          <>
            <p>
              {value === null
                ? 'Enlace oculto.'
                : value === undefined
                  ? 'Se utiliza el enlace original.'
                  : 'Enlace personalizado.'}
            </p>
            <button type="button" onClick={() => onChange(undefined)}>
              Restaurar enlace original
            </button>
            <button type="button" onClick={() => onChange(null)}>
              Ocultar enlace
            </button>
          </>
        )}
        {value ? (
          <>
            <label>
              Texto del enlace
              <input
                value={String(data.label || '')}
                onChange={(e) => onChange({ ...data, label: e.target.value })}
              />
            </label>
            <label>
              Destino (HTTPS o ruta interna)
              <input
                value={String(data.href || '')}
                onChange={(e) => onChange({ ...data, href: e.target.value })}
              />
            </label>
            <button type="button" onClick={() => onChange(null)}>
              Quitar enlace
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => onChange({ _type: 'contentLink', label: '', href: '/' })}
          >
            Añadir enlace
          </button>
        )}
      </fieldset>
    );
  if (field.type === 'array') {
    const items = rows(value);
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {items.map((item, i) => (
          <div className="array-item" key={String(item._key || i)}>
            <div className="array-tools">
              <strong>{i + 1}</strong>
              <button type="button" disabled={i === 0} onClick={() => onChange(move(items, i, -1))}>
                Subir {i + 1}
              </button>
              <button
                type="button"
                disabled={i === items.length - 1}
                onClick={() => onChange(move(items, i, 1))}
              >
                Bajar {i + 1}
              </button>
              <button type="button" onClick={() => onChange(items.filter((_, n) => n !== i))}>
                Quitar {i + 1}
              </button>
            </div>
            <FormFields
              definitions={field.fields || []}
              value={item}
              onChange={(next) => onChange(items.map((old, n) => (n === i ? next : old)))}
              options={options}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, { ...field.initial, _key: crypto.randomUUID() }])}
        >
          Añadir elemento
        </button>
      </fieldset>
    );
  }
  if (field.type === 'richtext')
    return (
      <fieldset>
        <legend>{field.label}</legend>
        <PortableEditor value={value} onChange={onChange} />
      </fieldset>
    );
  if (field.type === 'references') {
    const selected = rows(value);
    return (
      <fieldset>
        <legend>{field.label}</legend>
        {options[field.target || 'category'].map((option) => (
          <label className="check" key={option.id}>
            <input
              type="checkbox"
              checked={selected.some((v) => v._ref === option.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [
                        ...selected,
                        { _type: 'reference', _key: crypto.randomUUID(), _ref: option.id },
                      ]
                    : selected.filter((v) => v._ref !== option.id),
                )
              }
            />
            {option.title}
          </label>
        ))}
      </fieldset>
    );
  }
  if (field.type === 'reference')
    return (
      <label>
        {field.label}
        <select
          value={String(data._ref || '')}
          required={field.required}
          onChange={(e) => onChange({ _type: 'reference', _ref: e.target.value })}
        >
          <option value="">Selecciona una categoría</option>
          {options[field.target || 'category'].map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </label>
    );
  if (field.type === 'boolean')
    return (
      <label className="check">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  if (field.type === 'select')
    return (
      <label>
        {field.label}
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Selecciona
          </option>
          {field.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  return (
    <label htmlFor={id}>
      {field.label}
      {field.required ? ' *' : ''}
      {field.type === 'textarea' || field.type === 'strings' ? (
        <textarea
          id={id}
          required={field.required}
          rows={field.type === 'strings' ? 3 : 4}
          value={
            field.type === 'strings'
              ? Array.isArray(value)
                ? value.join('\n')
                : ''
              : String(value ?? '')
          }
          onChange={(e) =>
            onChange(field.type === 'strings' ? e.target.value.split('\n') : e.target.value)
          }
        />
      ) : (
        <input
          id={id}
          required={field.required}
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.type === 'number' ? 0 : undefined}
          step={field.name === 'price' ? '0.01' : field.type === 'number' ? '1' : undefined}
          value={String(value ?? '')}
          onChange={(e) =>
            onChange(
              field.type === 'number'
                ? Number(e.target.value)
                : !field.required && e.target.value === ''
                  ? undefined
                  : e.target.value,
            )
          }
        />
      )}
    </label>
  );
}
