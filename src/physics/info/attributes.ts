
export type Modifier = {uuid: string, operation: number /*there are others besides 0|1|2 */, amount: number}
export type Attribute = {value: number, modifiers: Modifier[]}


/**
 * AttributeInstance::calculateValue (without the final clamp): add, then
 * add-multiplied-base, then multiply by (1 + amount) for each
 * add-multiplied-total modifier.
 */
export function getAttributeValue(prop: Attribute): number {
    let x = prop.value;
    for (const mod of prop.modifiers ?? []) {
        if (mod.operation !== 0) continue;
        x += mod.amount;
    }
    let y = x;
    for (const mod of prop.modifiers ?? []) {
        if (mod.operation !== 1) continue;
        y += x * mod.amount;
    }
    for (const mod of prop.modifiers ?? []) {
        if (mod.operation !== 2) continue;
        y *= 1.0 + mod.amount;
    }
    return y;
}

/** Copy whose modifier list can be edited without touching the original. */
export function copyAttributeValue(prop: Attribute): Attribute {
    return { value: prop.value, modifiers: prop.modifiers?.slice() ?? [] };
}

export function createAttributeValue(base: any): Attribute {
    const attributes = {
        value: base,
        modifiers: [],
    };
    return attributes;
}

export function addAttributeModifier(attributes: Attribute, modifier: Modifier) {
    const end = attributes.modifiers.length;
    // add modifer at the end
    attributes.modifiers[end] = modifier;
    return attributes;
}

export function checkAttributeModifier(attributes: Attribute, uuid: string) {
    for (const modifier of attributes.modifiers) {
        if (modifier.uuid === uuid) return true;
    }
    return false;
}

export function deleteAttributeModifier(attributes: Attribute, uuid: string) {
    for (let i = attributes.modifiers.length - 1; i >= 0; i--) {
        if (attributes.modifiers[i].uuid === uuid) attributes.modifiers.splice(i, 1);
    }
    return attributes;
}
