// Pixel position of a character offset inside a <textarea>, relative to the textarea's top-left
// (already accounting for its scroll). Textareas don't expose this, so it's measured with an
// invisible copy of the textarea that has the same text and styles up to that offset.

const COPIED_STYLES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'wordSpacing',
  'tabSize',
] as const

export function caretPosition(textarea: HTMLTextAreaElement, offset: number) {
  const style = window.getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const prop of COPIED_STYLES) mirror.style[prop] = style[prop]
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    borderStyle: 'solid',
  })
  mirror.textContent = textarea.value.slice(0, offset)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(offset) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3
  const position = {
    top: marker.offsetTop - textarea.scrollTop,
    left: marker.offsetLeft - textarea.scrollLeft,
    lineHeight,
  }
  mirror.remove()
  return position
}
