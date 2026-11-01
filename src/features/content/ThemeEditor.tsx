import {
  contrastRatio,
  resolveVisualTheme,
  selectPreset,
  presetNames,
  managedVisualKeys,
  visualLabels,
  visualTokenSchemas,
  colorFields,
  numberFields,
  choiceFields,
  optionLabels,
} from '../../../shared/visual';
export function ThemeEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  let invalid = false;
  let preview;
  try {
    preview = resolveVisualTheme(data);
  } catch {
    invalid = true;
    preview = resolveVisualTheme(
      presetNames.includes(data.preset as (typeof presetNames)[number])
        ? { preset: data.preset }
        : {},
    );
  }
  const set = (key: string, next: unknown) => {
    const result = { ...data };
    if (next === undefined || next === '') delete result[key];
    else result[key] = next;
    onChange(result);
  };
  const ratio = contrastRatio(preview.paper, preview.ink);
  function preset(next: string) {
    if (next === data.preset) return;
    if (
      Object.keys(data).some((k) => managedVisualKeys.includes(k) && k !== 'preset') &&
      !window.confirm(
        'Aplicar otro preset sustituye los ajustes visuales personalizados. Los contenidos y las imágenes se conservarán. ¿Continuar?',
      )
    )
      return;
    onChange(
      next
        ? selectPreset(data, next as (typeof presetNames)[number])
        : Object.fromEntries(Object.entries(data).filter(([k]) => !managedVisualKeys.includes(k))),
    );
  }
  return (
    <fieldset className="theme-editor">
      <legend>Identidad visual</legend>
      <label>
        Preset visual
        <select
          value={typeof data.preset === 'string' ? data.preset : ''}
          onChange={(e) => preset(e.target.value)}
        >
          <option value="">Conservar identidad predeterminada</option>
          <option value="elegant">Elegant · editorial y premium</option>
          <option value="modern">Modern · contemporáneo y minimalista</option>
          <option value="casual">Casual · informal y expresivo</option>
        </select>
      </label>
      <p className="muted">
        Los cambios se guardan como borrador. La web cambiará solo después de publicar y completar
        su despliegue.
      </p>
      {data.preset ? (
        <div
          className="theme-preview"
          aria-label="Vista previa orientativa del tema"
          style={{
            background: preview.paper,
            color: preview.ink,
            fontFamily: preview.font === 'sans' ? 'Arial,sans-serif' : 'Georgia,serif',
          }}
        >
          <strong>Una mesa con personalidad</strong>
          <p>Tu contenido, con una identidad propia.</p>
          <span
            style={{
              background: preview.button === 'outline' ? 'transparent' : preview.ink,
              color: preview.button === 'outline' ? preview.ink : preview.paper,
              border: `1px solid ${preview.ink}`,
              borderRadius: { square: '0', soft: '.35rem', pill: '3rem' }[preview.buttonShape],
            }}
          >
            Ejemplo de botón
          </span>
          <small>Vista orientativa; la composición final se verá en la web publicada.</small>
        </div>
      ) : (
        <p>
          Sin preset se mantienen los valores actuales de la web. Los campos vacíos heredan su
          configuración.
        </p>
      )}
      {invalid && (
        <p role="status">Completa los valores válidos para actualizar la vista previa.</p>
      )}
      <details>
        <summary>Personalizar colores</summary>
        <div className="theme-controls">
          {colorFields.map((key) => (
            <div key={key}>
              <label>
                {visualLabels[key]}
                <input
                  aria-label={`Selector de color: ${visualLabels[key]}`}
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(String(data[key])) ? String(data[key]) : preview[key]
                  }
                  onChange={(e) => set(key, e.target.value)}
                />
                <input
                  aria-label={`Valor de color: ${visualLabels[key]}`}
                  value={String(data[key] ?? '')}
                  placeholder="Heredar · #RRGGBB"
                  pattern="#[0-9a-fA-F]{6}"
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
              <button type="button" onClick={() => set(key, undefined)}>
                Heredar {visualLabels[key].toLowerCase()}
              </button>
            </div>
          ))}
        </div>
        <p role="status">
          Contraste orientativo texto/fondo: {ratio.toFixed(1)}:1.
          {ratio < 4.5 ? ' Contraste insuficiente: usa al menos 4.5:1.' : ''}
        </p>
      </details>
      <details>
        <summary>Tipografías, botones y variantes</summary>
        <div className="theme-controls">
          {choiceFields.map((key) => (
            <label key={key}>
              {visualLabels[key]}
              <select
                value={typeof data[key] === 'string' ? String(data[key]) : ''}
                onChange={(e) => set(key, e.target.value)}
              >
                <option value="">Heredar</option>
                {visualTokenSchemas[key].options.map((option) => (
                  <option key={option} value={option}>
                    {optionLabels[option] || option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </details>
      <details>
        <summary>Espaciados y anchuras</summary>
        <div className="theme-controls">
          {numberFields.map((key) => (
            <label key={key}>
              {visualLabels[key]}
              <input
                type="number"
                min={visualTokenSchemas[key].minValue ?? undefined}
                max={visualTokenSchemas[key].maxValue ?? undefined}
                step={key === 'contentMax' ? 1 : 0.25}
                value={typeof data[key] === 'number' ? String(data[key]) : ''}
                placeholder={`Heredar (${preview[key]})`}
                onChange={(e) =>
                  set(key, e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            </label>
          ))}
        </div>
      </details>
    </fieldset>
  );
}
