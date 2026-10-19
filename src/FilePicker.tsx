import { sizeLabel } from './files';
export function FilePicker({
  label,
  file,
  accept,
  disabled = false,
  actionLabel = 'Выбрать файл',
  emptyLabel = 'Файл не выбран',
  onChange,
}: {
  label: string;
  file: File | null;
  accept: string;
  disabled?: boolean;
  actionLabel?: string;
  emptyLabel?: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="document-picker">
      <span>{label}</span>
      <span className={'document-picker-field' + (disabled ? ' disabled' : '')}>
        <span className="document-picker-action">{actionLabel}</span>
        <span className="document-picker-name">{file?.name || emptyLabel}</span>
        {file && <small>{sizeLabel(file.size)}</small>}
        <input
          aria-label={label}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
      </span>
    </label>
  );
}
