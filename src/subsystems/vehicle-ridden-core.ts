import { Vec3 } from "vec3";
// clamp(min, x, max) — the engine's Mth.clamp port, used by EntityAttachments.getClamped
// for the passenger index.
import { clamp } from "../physics/info/math";

const f32 = Math.fround;

// =============================================================================
// Constants
// =============================================================================

/** Ground-accel normalization numerator 0.6³. */
export const GROUND_ACCEL_NUMERATOR = 0.21600002;
/** Default block friction; on-ground speed boost applies only when friction > 0.6. */
export const FRICTION_SPEED_THRESHOLD = 0.6;
/** STEP_HEIGHT attribute default for players. */
export const STEP_HEIGHT = f32(0.6);
/** Base Entity.maxUpStep — non-living entities don't step. */
export const ENTITY_BASE_MAX_UP_STEP = f32(0.0);
/** Ridden-entity step floor: maxUpStep = max(step, 1.0) when a Player controls the mount. */
export const RIDDEN_STEP_FLOOR = f32(1.0);
/** getInputVector zero-length cutoff. */
export const INPUT_ZERO_CUTOFF = 1.0e-7;
/** getInputVector normalize threshold — normalize input only if lengthSqr > 1. */
export const INPUT_NORMALIZE_THRESHOLD = 1.0;
/** getFlyingSpeed multiplier when player-ridden. */
export const PLAYER_RIDDEN_FLYING_SPEED_MULT = f32(0.1);
/** getFlyingSpeed when NOT player-ridden. */
export const DEFAULT_FLYING_SPEED = f32(0.02);
/** Per-tick decay of xxa/zza in applyInput. */
export const INPUT_DECAY = f32(0.98);

// Horse-family input shaping constants.
export const HORSE_STRAFE_MULT = f32(0.5); // controller.xxa * 0.5F
export const HORSE_BACKWARD_MULT = f32(0.25); // forward *= 0.25F when forward <= 0
export const HORSE_PITCH_MULT = f32(0.5); // mount pitch = controller.xRot * 0.5F

// Strider speed factors.
export const STRIDER_SPEED_NORMAL = f32(0.55);
export const STRIDER_SPEED_SUFFOCATING = f32(0.35);

const DEG2RAD = Math.PI / 180.0;

// =============================================================================
// Minimal vector helpers (Vec3-shaped {x,y,z})
// =============================================================================

export const VEC_ZERO = new Vec3(0, 0, 0);

function v3(x: number, y: number, z: number): Vec3 {
  return new Vec3(x, y, z);
}

// =============================================================================
// getInputVector / moveRelative
//   The mount-relative Vec3(strafe, 0, forward) -> world-space velocity rotated by
//   the mount's yaw (which tickRidden has just synced to the controller's yaw).
//   `yRotDeg` is the vanilla yaw in DEGREES (Minecraft world yaw).
// =============================================================================

/** Vec3.normalize: dist<1e-5 -> ZERO. */
function normalize(input: Vec3): Vec3 {
  const dist = Math.sqrt(input.x * input.x + input.y * input.y + input.z * input.z);
  return dist < f32(1.0e-5) ? v3(0, 0, 0) : v3(input.x / dist, input.y / dist, input.z / dist);
}

export function getInputVector(input: Vec3, speed: number, yRotDeg: number): Vec3 {
  const length = input.x * input.x + input.y * input.y + input.z * input.z; // lengthSqr
  if (length < INPUT_ZERO_CUTOFF) {
    return v3(0, 0, 0);
  }
  const base = length > INPUT_NORMALIZE_THRESHOLD ? normalize(input) : input;
  const m = v3(base.x * speed, base.y * speed, base.z * speed);
  const rad = f32(yRotDeg * DEG2RAD);
  // vanilla uses Mth.sin/cos (f32 lookup table); we use Math.sin/cos (f64) to match
  // the engine's own applyInputs for cross-parity.
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return v3(m.x * cos - m.z * sin, m.y, m.z * cos + m.x * sin);
}

/** moveRelative: deltaMovement += getInputVector(input, speed, yRot). */
export function moveRelative(deltaMovement: Vec3, speed: number, input: Vec3, yRotDeg: number): Vec3 {
  const d = getInputVector(input, speed, yRotDeg);
  return v3(deltaMovement.x + d.x, deltaMovement.y + d.y, deltaMovement.z + d.z);
}

// =============================================================================
// Friction-influenced speed + flying speed
// =============================================================================

/**
 * getFrictionInfluencedSpeed.
 * On ground: friction>0.6 ? speed*(0.21600002/friction³) : speed.
 * Airborne:  getFlyingSpeed().
 */
export function getFrictionInfluencedSpeed(
  speed: number,
  blockFriction: number,
  onGround: boolean,
  playerControlled: boolean
): number {
  if (onGround) {
    return blockFriction > FRICTION_SPEED_THRESHOLD
      ? f32(speed * f32(GROUND_ACCEL_NUMERATOR / (blockFriction * blockFriction * blockFriction)))
      : speed;
  }
  return getFlyingSpeed(speed, playerControlled);
}

/**
 * getFlyingSpeed: getControllingPassenger() instanceof Player ? getSpeed()*0.1F : 0.02F.
 */
export function getFlyingSpeed(speed: number, playerControlled: boolean): number {
  return playerControlled ? f32(speed * PLAYER_RIDDEN_FLYING_SPEED_MULT) : DEFAULT_FLYING_SPEED;
}

// =============================================================================
// maxUpStep
//   maxUpStep = (float)getAttributeValue(STEP_HEIGHT);
//   return getControllingPassenger() instanceof Player ? max(maxUpStep, 1.0F) : maxUpStep;
// =============================================================================

export function livingMaxUpStep(stepHeightAttr: number, playerControlled: boolean): number {
  const base = f32(stepHeightAttr);
  return playerControlled ? Math.max(base, RIDDEN_STEP_FLOOR) : base;
}

// =============================================================================
// The ridden MOVEMENT spine
// =============================================================================

/** A player controller's WASD/look, as the mount reads them next tick. */
export interface RiderControl {
  /** strafe input. */
  xxa: number;
  /** forward input. */
  zza: number;
  /** yaw in degrees (world yaw). */
  yRot: number;
  /** pitch in degrees. */
  xRot: number;
  /** held jump key (jump-charge gate; per-family). */
  jumping?: boolean;
}

/** Mount rotation/heading state that travel + getInputVector read. */
export interface MountState {
  /** world position (feet). */
  pos: Vec3;
  /** velocity (deltaMovement), blocks/tick. */
  vel: Vec3;
  /** mount yaw in degrees (world yaw); tickRidden syncs this to the controller. */
  yRot: number;
  /** mount pitch in degrees. */
  xRot: number;
  /** the movement-speed scalar setSpeed writes and travel reads. */
  speed: number;
  /** mount's own input fields (an AI mob; usually 0). applyInput decays these. */
  xxa: number;
  yya: number;
  zza: number;
  onGround: boolean;
  /** previous-tick yaw mirror (yRotO = yBodyRot = yHeadRot synced in tickRidden). */
  yRotO?: number;
}

/**
 * A per-mount "trait" — the family (horse/strider/camel/ghast) supplies these.
 * Bases mirror LivingEntity: getRiddenInput returns selfInput, tickRidden empty,
 * getRiddenSpeed returns getSpeed.
 */
export interface RiddenMount {
  /** controlling-passenger gate (saddle/seat). True => travelRidden branch. */
  isPlayerControlled(): boolean;
  /** mount alive (dispatch gate). */
  isAlive(): boolean;
  /** single-authority engine: treat as always-true. */
  canSimulateMovement(): boolean;

  /** map the controller's WASD into a MOUNT-RELATIVE input Vec3 (X=strafe, Z=forward). */
  getRiddenInput(controller: RiderControl, selfInput: Vec3): Vec3;
  /** sync mount rotation to controller look + trigger jump (subclass). Mutates `state`. */
  tickRidden(controller: RiderControl, riddenInput: Vec3): void;
  /** per-tick movement speed -> setSpeed (usually MOVEMENT_SPEED attr). */
  getRiddenSpeed(controller: RiderControl): number;

  /** the live mutable mount state (pos/vel/yaw/speed/...). */
  state: MountState;

  /**
   * The standard friction/gravity move pipeline.
   * Supplied by the engine; the spine just hands it the rotated input + speed.
   * Implementations should run moveRelative(getFrictionInfluencedSpeed, input) ->
   * move -> gravity/drag. For a pure-spine unit, a closed-form stub is enough.
   */
  travel(input: Vec3): void;
}

/** setSpeed: this.speed = speed. */
export function setSpeed(state: MountState, speed: number): void {
  state.speed = speed;
}

/**
 * travelRidden — the generic ridden step the specific vehicles plug into.
 *
 *   riddenInput = getRiddenInput(controller, selfInput);
 *   tickRidden(controller, riddenInput);
 *   if (canSimulateMovement()) { setSpeed(getRiddenSpeed(controller)); travel(riddenInput); }
 *   else                       { setDeltaMovement(ZERO); }
 */
export function travelRidden(mount: RiddenMount, controller: RiderControl, selfInput: Vec3): void {
  const riddenInput = mount.getRiddenInput(controller, selfInput);
  mount.tickRidden(controller, riddenInput);
  if (mount.canSimulateMovement()) {
    setSpeed(mount.state, mount.getRiddenSpeed(controller));
    mount.travel(riddenInput);
  } else {
    mount.state.vel = v3(0, 0, 0); // setDeltaMovement(ZERO) — non-authoritative side
  }
}

/**
 * aiStep dispatch slice.
 *   applyInput(): xxa*=0.98F; zza*=0.98F
 *   input = Vec3(xxa, yya, zza)
 *   if (getControllingPassenger() instanceof Player && isAlive()) travelRidden(controller, input)
 *   else if (canSimulateMovement() && isEffectiveAi())            travel(input)
 *
 * `controller` is null when the mount is riderless (runs normal AI travel).
 */
export function mountAiStep(
  mount: RiddenMount,
  controller: RiderControl | null,
  isEffectiveAi: boolean = true
): void {
  const s = mount.state;
  // applyInput: decay the mount's OWN input fields.
  s.xxa = f32(s.xxa * INPUT_DECAY);
  s.zza = f32(s.zza * INPUT_DECAY);
  const selfInput = v3(s.xxa, s.yya, s.zza);

  if (controller !== null && mount.isPlayerControlled() && mount.isAlive()) {
    travelRidden(mount, controller, selfInput);
  } else if (mount.canSimulateMovement() && isEffectiveAi) {
    mount.travel(selfInput);
  }
}

// =============================================================================
// Base + family ridden traits
// =============================================================================

/**
 * Base LivingEntity ridden behavior: getRiddenInput returns selfInput, tickRidden empty,
 * getRiddenSpeed = getSpeed(). Families extend this; the spine treats them all uniformly.
 */
export abstract class BaseRiddenMount implements RiddenMount {
  state: MountState;
  protected playerControlled = true;
  protected alive = true;

  constructor(state: MountState) {
    this.state = state;
  }

  isPlayerControlled(): boolean {
    return this.playerControlled;
  }
  isAlive(): boolean {
    return this.alive;
  }
  /** single-authority engine: always true. */
  canSimulateMovement(): boolean {
    return true;
  }

  getRiddenInput(_controller: RiderControl, selfInput: Vec3): Vec3 {
    return selfInput;
  }
  tickRidden(_controller: RiderControl, _riddenInput: Vec3): void {
    // empty base.
  }
  getRiddenSpeed(_controller: RiderControl): number {
    return this.state.speed; // getSpeed()
  }

  abstract travel(input: Vec3): void;

  /**
   * Sync the mount's rotation to the supplied (yaw,pitch) and mirror the body/head
   * yaw, as every family does in tickRidden BEFORE travel so getInputVector rotates
   * correctly:
   *   setRot(yaw, pitch); yRotO = yBodyRot = yHeadRot = getYRot();
   */
  protected syncRot(yawDeg: number, pitchDeg: number): void {
    this.state.yRot = yawDeg;
    this.state.xRot = pitchDeg;
    this.state.yRotO = this.state.yRot;
  }
}

/**
 * Horse family — the canonical mount.
 *  getRiddenInput  : sideways = xxa*0.5; forward = zza; if forward<=0 forward*=0.25
 *                    -> Vec3(sideways, 0, forward)
 *                    (rearing/standing guard returns ZERO; modeled by `standing`).
 *  getRiddenRotation: (yaw = controller.yRot, pitch = controller.xRot*0.5)
 *  tickRidden      : setRot(yaw,pitch); yRotO=yBodyRot=yHeadRot=yaw
 *  getRiddenSpeed  : MOVEMENT_SPEED attribute
 *  maxUpStep       : max(step, 1.0) while player-controlled
 */
export class HorseRiddenMount extends BaseRiddenMount {
  /** MOVEMENT_SPEED for this horse. */
  movementSpeed: number;
  /** STEP_HEIGHT for this horse. */
  stepHeightAttr: number;
  /** isStanding() && !allowStandSliding rearing guard. */
  standing = false;
  /** != 0 lets a rearing horse still slide. */
  playerJumpPendingScale = 0;
  allowStandSliding = false;
  private travelFn: (mount: HorseRiddenMount, input: Vec3) => void;

  constructor(
    state: MountState,
    movementSpeed: number,
    stepHeightAttr: number = STEP_HEIGHT,
    travelFn: (mount: HorseRiddenMount, input: Vec3) => void = defaultGroundTravel
  ) {
    super(state);
    this.movementSpeed = f32(movementSpeed);
    this.stepHeightAttr = f32(stepHeightAttr);
    this.travelFn = travelFn;
  }

  override getRiddenInput(controller: RiderControl, _selfInput: Vec3): Vec3 {
    // rearing guard
    if (
      this.state.onGround &&
      this.playerJumpPendingScale === 0 &&
      this.standing &&
      !this.allowStandSliding
    ) {
      return v3(0, 0, 0);
    }
    let sideways = f32(controller.xxa * HORSE_STRAFE_MULT);
    let forward = f32(controller.zza);
    if (forward <= 0.0) {
      forward = f32(forward * HORSE_BACKWARD_MULT);
    }
    return v3(sideways, 0.0, forward); // mount-relative
  }

  override tickRidden(controller: RiderControl, _riddenInput: Vec3): void {
    // getRiddenRotation = (yaw=controller.yRot, pitch=controller.xRot*0.5)
    this.syncRot(controller.yRot, f32(controller.xRot * HORSE_PITCH_MULT));
    // jump-charge handling -> horse-camel-riding topic (out of this core's scope).
  }

  override getRiddenSpeed(_controller: RiderControl): number {
    return this.movementSpeed; // MOVEMENT_SPEED
  }

  /** maxUpStep: max(step, 1.0) while a player controls it. */
  maxUpStep(): number {
    return livingMaxUpStep(this.stepHeightAttr, this.isPlayerControlled());
  }

  override travel(input: Vec3): void {
    this.travelFn(this, input);
  }
}

/**
 * Strider — ignores WASD, always full-forward; speed factor.
 *  getRiddenInput : Vec3(0,0,1)
 *  tickRidden     : setRot(yaw, pitch*0.5); yRotO=yBodyRot=yHeadRot=yaw
 *  getRiddenSpeed : MOVEMENT_SPEED * (suffocating?0.35:0.55) * boost
 */
export class StriderRiddenMount extends BaseRiddenMount {
  movementSpeed: number;
  suffocating = false;
  /** boostFactor (1.0..2.15); 1.0 when not boosting. */
  boostFactor = 1.0;
  private travelFn: (mount: StriderRiddenMount, input: Vec3) => void;

  constructor(
    state: MountState,
    movementSpeed: number,
    travelFn: (mount: StriderRiddenMount, input: Vec3) => void = defaultGroundTravel
  ) {
    super(state);
    this.movementSpeed = f32(movementSpeed);
    this.travelFn = travelFn;
  }

  override getRiddenInput(_controller: RiderControl, _selfInput: Vec3): Vec3 {
    return v3(0.0, 0.0, 1.0);
  }

  override tickRidden(controller: RiderControl, _riddenInput: Vec3): void {
    // setRot(controller.yRot, controller.xRot*0.5)
    this.syncRot(controller.yRot, f32(controller.xRot * HORSE_PITCH_MULT));
  }

  override getRiddenSpeed(_controller: RiderControl): number {
    const factor = this.suffocating ? STRIDER_SPEED_SUFFOCATING : STRIDER_SPEED_NORMAL;
    // (float)(MOVEMENT_SPEED * (0.35|0.55) * boostFactor())
    return f32(this.movementSpeed * factor * this.boostFactor);
  }

  override travel(input: Vec3): void {
    this.travelFn(this, input);
  }
}

/**
 * A minimal, self-contained `travel` for the generic ground case so the spine can
 * be exercised end-to-end without the full engine. Mirrors the relevant slice of
 * travelInAir -> handleRelativeFrictionAndCalculateMovement:
 *
 *   moveRelative(getFrictionInfluencedSpeed(friction), input)  -> world delta added to vel
 *   (the move()/gravity/drag steps are the engine's; left to the real travel)
 *
 * This applies the ONE step the ridden spine is responsible for: turning the
 * mount-relative input into a world-space velocity ADD using the mount's just-synced
 * yaw and its setSpeed'd speed. blockFriction defaults to 0.6 (no boost) so callers
 * that want the boosted ground speed pass a higher friction.
 */
export function defaultGroundTravel(mount: RiddenMount, input: Vec3): void {
  const s = mount.state;
  const frictionSpeed = getFrictionInfluencedSpeed(
    s.speed,
    FRICTION_SPEED_THRESHOLD,
    s.onGround,
    mount.isPlayerControlled()
  );
  s.vel = moveRelative(s.vel, frictionSpeed, input, s.yRot);
}

// =============================================================================
// Passenger ATTACHMENT half (applies to ALL vehicles incl. boats/minecarts)
// =============================================================================

/** EntityAttachment fallback kinds. */
export enum AttachmentFallback {
  AT_FEET, // (0,0,0)
  AT_HEIGHT, // (0, height, 0)
  AT_CENTER, // (0, height/2, 0)
}

/** PASSENGER=AT_HEIGHT, VEHICLE=AT_FEET. */
export enum AttachmentType {
  PASSENGER,
  VEHICLE,
}

const FALLBACK_OF: Record<AttachmentType, AttachmentFallback> = {
  [AttachmentType.PASSENGER]: AttachmentFallback.AT_HEIGHT,
  [AttachmentType.VEHICLE]: AttachmentFallback.AT_FEET,
};

export function createFallbackPoints(
  fallback: AttachmentFallback,
  _width: number,
  height: number
): Vec3[] {
  switch (fallback) {
    case AttachmentFallback.AT_FEET:
      return [v3(0, 0, 0)];
    case AttachmentFallback.AT_HEIGHT:
      return [v3(0, height, 0)];
    case AttachmentFallback.AT_CENTER:
      return [v3(0, height / 2.0, 0)];
  }
}

/**
 * A map of local attach points per type; missing types fall back per createFallbackPoints.
 */
export class EntityAttachments {
  private readonly points: Map<AttachmentType, Vec3[]>;

  private constructor(points: Map<AttachmentType, Vec3[]>) {
    this.points = points;
  }

  /** createDefault(width,height) — every type uses its fallback. */
  static createDefault(width: number, height: number): EntityAttachments {
    const m = new Map<AttachmentType, Vec3[]>();
    for (const t of [AttachmentType.PASSENGER, AttachmentType.VEHICLE]) {
      m.set(t, createFallbackPoints(FALLBACK_OF[t], width, height));
    }
    return new EntityAttachments(m);
  }

  /** Explicit points override the fallback. */
  static fromExplicit(
    explicit: Partial<Record<AttachmentType, Vec3[]>>,
    width: number,
    height: number
  ): EntityAttachments {
    const m = new Map<AttachmentType, Vec3[]>();
    for (const t of [AttachmentType.PASSENGER, AttachmentType.VEHICLE]) {
      const pts = explicit[t];
      m.set(t, pts && pts.length > 0 ? pts.map((p) => p.clone()) : createFallbackPoints(FALLBACK_OF[t], width, height));
    }
    return new EntityAttachments(m);
  }

  /** transformPoint: point.yRot(-rotY * PI/180). */
  private static transformPoint(point: Vec3, rotYDeg: number): Vec3 {
    return yRot(point, f32(-rotYDeg * DEG2RAD));
  }

  /** get(type,index,rotY) — throws if missing. */
  get(type: AttachmentType, index: number, rotYDeg: number): Vec3 {
    const pts = this.points.get(type);
    if (!pts || index < 0 || index >= pts.length) {
      throw new Error(`Had no attachment point of type: ${AttachmentType[type]} for index: ${index}`);
    }
    return EntityAttachments.transformPoint(pts[index], rotYDeg);
  }

  /** getClamped(type,index,rotY) — index clamped into range. Used for PASSENGER seating. */
  getClamped(type: AttachmentType, index: number, rotYDeg: number): Vec3 {
    const pts = this.points.get(type);
    if (!pts || pts.length === 0) {
      throw new Error(`Had no attachment points of type: ${AttachmentType[type]}`);
    }
    const i = clamp(0, index, pts.length - 1);
    return EntityAttachments.transformPoint(pts[i], rotYDeg);
  }
}

/** Vec3.yRot: xx = x*cos + z*sin; zz = z*cos - x*sin; (radians). */
export function yRot(p: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return v3(p.x * cos + p.z * sin, p.y, p.z * cos - p.x * sin);
}

/** EntityDimensions slice we need: width/height + the attach points. */
export interface VehicleDimensions {
  width: number;
  height: number;
  attachments: EntityAttachments;
}

/** A rider/vehicle entity, minimal shape for the attachment half. */
export interface AttachEntity {
  pos: Vec3;
  yRot: number;
  dimensions: VehicleDimensions;
  /** true => use LivingEntity scale path (getScale()*getAgeScale()); else plain Entity scale=1. */
  isLiving: boolean;
  /** mob scale; 1 for adults/non-living. */
  scale?: number;
  /** baby scale; 1 for adults. */
  ageScale?: number;
  /** ordered passenger list of THIS entity-as-vehicle (indexOf gives the PASSENGER index). */
  passengers?: AttachEntity[];
}

/**
 * getDefaultPassengerAttachmentPoint:
 *   idx = vehicle.getPassengers().indexOf(passenger);
 *   return attachments.getClamped(PASSENGER, idx, vehicle.yRot);
 */
export function getDefaultPassengerAttachmentPoint(
  vehicle: AttachEntity,
  passenger: AttachEntity,
  attachments: EntityAttachments
): Vec3 {
  const idx = (vehicle.passengers ?? []).indexOf(passenger);
  return attachments.getClamped(AttachmentType.PASSENGER, idx, vehicle.yRot);
}

/**
 * getPassengerRidingPosition:
 *   base:   position() + getDefaultPassengerAttachmentPoint(passenger, dims, 1.0)
 *   living: position() + getDefaultPassengerAttachmentPoint(passenger, dims(pose), getScale()*getAgeScale())
 * (the `scale` arg is unused by the default getPassengerAttachmentPoint, so for the default
 *  impl the LivingEntity scale only matters if dims are pre-scaled; we pass dims as-is).
 */
export function getPassengerRidingPosition(vehicle: AttachEntity, passenger: AttachEntity): Vec3 {
  // scale is computed for fidelity but, like vanilla's default getPassengerAttachmentPoint, is not
  // applied to the point here. Kept for documentation/fidelity.
  void (vehicle.isLiving ? f32((vehicle.scale ?? 1) * (vehicle.ageScale ?? 1)) : 1.0);
  const attach = getDefaultPassengerAttachmentPoint(vehicle, passenger, vehicle.dimensions.attachments);
  return v3(vehicle.pos.x + attach.x, vehicle.pos.y + attach.y, vehicle.pos.z + attach.z);
}

/**
 * getVehicleAttachmentPoint:
 *   getAttachments().get(VEHICLE, 0, this.yRot)  — the PASSENGER's own VEHICLE point (index 0).
 */
export function getVehicleAttachmentPoint(passenger: AttachEntity): Vec3 {
  return passenger.dimensions.attachments.get(AttachmentType.VEHICLE, 0, passenger.yRot);
}

/**
 * positionRider(passenger, moveFunction):
 *   pos = getPassengerRidingPosition(passenger);
 *   off = passenger.getVehicleAttachmentPoint(this);
 *   moveFunction(passenger, pos.x-off.x, pos.y-off.y, pos.z-off.z);
 * The rider is SNAP-positioned (no collide/step). Default moveFunction = setPos.
 */
export function positionRider(
  vehicle: AttachEntity,
  passenger: AttachEntity,
  moveFunction: (passenger: AttachEntity, x: number, y: number, z: number) => void = setPos
): void {
  const pos = getPassengerRidingPosition(vehicle, passenger);
  const off = getVehicleAttachmentPoint(passenger);
  moveFunction(passenger, pos.x - off.x, pos.y - off.y, pos.z - off.z);
}

/** setPos — the default MoveFunction; sets feet position. */
export function setPos(passenger: AttachEntity, x: number, y: number, z: number): void {
  passenger.pos = v3(x, y, z);
}

/**
 * rideTick:
 *   setDeltaMovement(ZERO); tick(); if (isPassenger()) getVehicle().positionRider(this);
 * The passenger has no velocity of its own; it is snapped to the attachment point.
 * (LivingEntity.rideTick additionally resetFallDistance.)
 */
export function rideTick(
  vehicle: AttachEntity,
  passenger: AttachEntity & { vel?: Vec3 },
  tick?: () => void
): void {
  passenger.vel = v3(0, 0, 0); // setDeltaMovement(ZERO)
  if (tick) tick();
  positionRider(vehicle, passenger);
}
