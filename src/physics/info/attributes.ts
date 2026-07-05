
type Modifier = {uuid: string, operation: number /*there are others besides 0|1|2 */, amount: number}
type Attribute = {value: number, modifiers: Modifier[]}


const ATTRIBUTE_RANGES: { [name: string]: [number, number] } = {
    movement_speed: [0.0, 1024.0],
    jump_strength: [0.0, 32.0],
    gravity: [-1.0, 1.0],
    step_height: [0.0, 10.0],
    water_movement_efficiency: [0.0, 1.0],
    movement_efficiency: [0.0, 1.0],
    sneaking_speed: [0.0, 1.0],
    scale: [0.0625, 16.0],
    bounciness: [0.0, 1.0],
    friction_modifier: [0.0, 2048.0],
    air_drag_modifier: [0.0, 2048.0],
};

function sanitizeValue(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return value < min ? min : value > max ? max : value;
}

export function getAttributeValue(prop: Attribute, attributeName?: string): number {
    let x = prop.value;
    const mods = prop.modifiers ?? [];
    for (const mod of mods) {
        if (mod.operation !== 0) continue;
        x += mod.amount;
    }
    let y = x;
    for (const mod of mods) {
        if (mod.operation !== 1) continue;
        y += x * mod.amount;
    }
    for (const mod of mods) {
        if (mod.operation !== 2) continue;
        y += y * mod.amount;
    }
    if (attributeName !== undefined) {
        const key = attributeName.startsWith("minecraft:") ? attributeName.slice("minecraft:".length) : attributeName;
        const range = ATTRIBUTE_RANGES[key];
        if (range !== undefined) return sanitizeValue(y, range[0], range[1]);
    }
    return y;
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
    // Iterate backwards so in-place removal does not skip elements.
    for (let i = attributes.modifiers.length - 1; i >= 0; i--) {
        if (attributes.modifiers[i].uuid === uuid) attributes.modifiers.splice(i, 1);
    }
    return attributes;
}
