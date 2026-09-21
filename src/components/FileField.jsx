import { useId } from 'react'

// A styled stand-in for <input type="file"> — the native control's
// "Choose File" button can't be restyled directly, so this hides it
// (not display:none, or it drops out of the tab order) behind a real
// .btn label and shows the picked name next to it instead.
export default function FileField({ accept, file, onChange, id }) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <div className="filefield">
      <label className="btn ghost sm" htmlFor={inputId}>
        Choose File
      </label>
      <span className="filefield-name">{file ? file.name : 'No file chosen'}</span>
      <input
        id={inputId}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        className="filefield-input"
      />
    </div>
  )
}
