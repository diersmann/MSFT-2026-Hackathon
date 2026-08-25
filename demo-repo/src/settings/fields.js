export function renderField(field) {
  switch (field.type) {
    case 'text':
      return { tag: 'input', props: { type: 'text', value: field.value } };
    case 'toggle':
      return { tag: 'input', props: { type: 'checkbox', checked: Boolean(field.value) } };
    case 'select':
      return { tag: 'select', props: { value: field.value }, options: field.options ?? [] };
    default:
      return { tag: 'span', props: {}, text: String(field.value ?? '') };
  }
}
