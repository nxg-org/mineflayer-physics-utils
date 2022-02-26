
interface Modifier {uuid: string, operation: number /* there are others besides 0|1|2 */, amount: number}
interface Attribute {value: number, modifiers: Modifier[]}

export function getAttributeValue (prop: Attribute): number {
  let x = prop.value
  for (const mod of prop.modifiers) {
    if (mod.operation !== 0) continue
    x += mod.amount
  }
  let y = x
  for (const mod of prop.modifiers) {
    if (mod.operation !== 1) continue
    y += x * mod.amount
  }
  for (const mod of prop.modifiers) {
    if (mod.operation !== 2) continue
    y += y * mod.amount
  }
  return y
}

export function createAttributeValue (base: any): Attribute {
  const attributes = {
    value: base,
    modifiers: []
  }
  return attributes
}

export function addAttributeModifier (attributes: Attribute, modifier: Modifier) {
  const end = attributes.modifiers.length
  // add modifer at the end
  attributes.modifiers[end] = modifier
  return attributes
}

export function checkAttributeModifier (attributes: Attribute, uuid: string) {
  for (const modifier of attributes.modifiers) {
    if (modifier.uuid === uuid) return true
  }
  return false
}

export function deleteAttributeModifier (attributes: Attribute, uuid: string) {
  for (const modifier of attributes.modifiers) {
    if (modifier.uuid === uuid) attributes.modifiers.splice(attributes.modifiers.indexOf(modifier))
  }
  return attributes
}
