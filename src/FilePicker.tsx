import { sizeLabel } from './files';
export function FilePicker({
  label,
  file,
  accept,
  disabled = false,
  onChange,
}: {
  label: string;
  file: File | null;
  accept: string;
  disabled?: boolean;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="document-picker">
      <span>{label}</span>
      <span className={'document-picker-field' + (disabled ? ' disabled' : '')}>
        <span className="document-picker-action">Выбрать файл</span>
        <span className="document-picker-name">{file?.name || 'Файл не выбран'}</span>
        {file && <small>{sizeLabel(file.size)}</small>}
        <input
          aria-label={label}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </span>
    </label>
  );
}
