// Tiny DOM builder. Text always goes through createTextNode / textContent, never innerHTML:
// guest names, notes and tags are user-supplied, so they must never be parsed as markup.

/**
 * h('button', { class: 'primary', onclick: fn, disabled: true }, 'Kaydet')
 * Children may be strings, numbers, nodes, arrays or null/false (skipped).
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
    else if (name === 'class') element.className = value;
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(element) {
  element.replaceChildren();
}
