export default function Toast({ message }) {
  return (
    <div id="toast" hidden={!message}>
      {message}
    </div>
  )
}
