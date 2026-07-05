/**
 * Subsystem: fall-distance-and-damage (Minecraft 26.2)
 * ----------------------------------------------------
 * A standalone, self-contained tracker + calculator for the vanilla fall-distance
 * accumulator (`Entity.fallDistance`) and the fall-damage trigger.
 *
 * Imports nothing from the player engine (botcraft.ts / physics/engines/*).
 *
 * Units: blocks and blocks/tick (20 tps). `fallDistance` is a JS `number` modelling the vanilla
 * `double` field; the PER-TICK accumulation delta is narrowed to a Java float (`Math.fround`).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SAFE_FALL_DISTANCE attribute default — no damage for the first 3 blocks
 *  (RangedAttribute 3.0, clamp [-1024,1024]). */
export const SAFE_FALL_DISTANCE_DEFAULT = 3.0;
/** SAFE_FALL_DISTANCE clamp range. */
export const SAFE_FALL_DISTANCE_MIN = -1024.0;
export const SAFE_FALL_DISTANCE_MAX = 1024.0;

/** FALL_DAMAGE_MULTIPLIER attribute default (RangedAttribute 1.0, clamp [0,100]). */
export const FALL_DAMAGE_MULTIPLIER_DEFAULT = 1.0;
/** FALL_DAMAGE_MULTIPLIER clamp range. */
export const FALL_DAMAGE_MULTIPLIER_MIN = 0.0;
export const FALL_DAMAGE_MULTIPLIER_MAX = 100.0;

/** Epsilon added to fall power so an exactly-safeFall fall floors to 0. */
export const POWER_EPSILON = 1.0e-6;

/** Lava per-tick fall-distance decay factor. */
export const LAVA_DECAY = 0.5;

/** checkFallDistanceAccumulation (elytra/leash/launch) downward-speed threshold, b/t. */
export const ELYTRA_CLAMP_SPEED = -0.5;
/** checkFallDistanceAccumulation clamp ceiling (gliding level). */
export const ELYTRA_CLAMP_TO = 1.0;

/** Max distance of the FALLDAMAGE_RESETTING clip ray. */
export const RESET_RAYCAST_MAX = 8.0;
/** Min SQUARED post-collision movement length to run the resetting ray. */
export const RESET_RAYCAST_MIN_MOVE_SQ = 1.0;

/** Post-impulse fall-grace window, ticks (wind-charge / mace). */
export const IMPULSE_GRACE_TICKS = 40;

/** Per-block fall `damageModifier` (the arg to causeFallDamage). */
export const FALL_MODIFIER_GENERIC = 1.0;
export const FALL_MODIFIER_HAY = 0.2;
export const FALL_MODIFIER_SLIME = 0.0; // only if !suppressingBounce
export const FALL_MODIFIER_HONEY = 0.2;
/** Bed halves the DISTANCE (modifier stays the inherited 1.0). */
export const BED_DISTANCE_MULT = 0.5;
/** Pointed dripstone tip (pointing up): +2.5 distance and modifier 2.0. */
export const DRIPSTONE_EXTRA_DISTANCE = 2.5;
export const FALL_MODIFIER_DRIPSTONE = 2.0;

/** The `#minecraft:fall_damage_resetting` tag = `#climbable` + sweet_berry_bush + cobweb.
 *  (Block names without the `minecraft:` namespace; expand `#climbable` to its members.) */
export const FALL_DAMAGE_RESETTING_BLOCKS: ReadonlySet<string> = new Set<string>([
  // #minecraft:climbable members
  "ladder",
  "vine",
  "scaffolding",
  "twisting_vines",
  "twisting_vines_plant",
  "weeping_vines",
  "weeping_vines_plant",
  "cave_vines",
  "cave_vines_plant",
  // explicit non-climbable members of the resetting tag
  "sweet_berry_bush",
  "cobweb",
]);

/** Java float narrowing (the per-tick `(float)ya` cast). */
const f = Math.fround;

/** Mth.clamp(value, lo, hi) — used for attribute clamps. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

// ---------------------------------------------------------------------------
// Per-block fallOn dispatch (Block.fallOn + overrides) — returns the
// (distance, modifier) pair passed to causeFallDamage, or null for "no damage path".
// ---------------------------------------------------------------------------

export interface FallOnResult {
  /** the fall distance value handed to causeFallDamage (bed halves it; dripstone adds 2.5). */
  distance: number;
  /** the damageModifier handed to causeFallDamage. */
  modifier: number;
}

export interface FallOnContext {
  /** sneaking/shifting -> Entity.isSuppressingBounce(). */
  suppressingBounce?: boolean;
  /** pointed dripstone TIP that points UP (the only damaging dripstone orientation). */
  dripstoneTipUp?: boolean;
}

/**
 * Resolve a block's `fallOn` into the (distance, modifier) it forwards to causeFallDamage.
 * Returns `null` when the block has NO fall-damage path (powder snow; suppressed slime).
 *
 *  - generic            -> (d, 1.0)
 *  - hay_block          -> (d, 0.2)
 *  - slime_block        -> (d, 0.0) iff !suppressingBounce else NONE
 *  - honey_block        -> (d, 0.2)
 *  - bed                -> (d*0.5, 1.0)
 *  - powder_snow        -> NONE (no super)
 *  - pointed_dripstone (tip up) -> (d+2.5, 2.0)
 *  - sweet_berry_bush   -> inherits generic (1.0); in practice nullified by the resetting tag/makeStuckInBlock.
 */
export function resolveFallOn(
  blockName: string,
  fallDistance: number,
  ctx: FallOnContext = {}
): FallOnResult | null {
  switch (blockName) {
    case "hay_block":
      return { distance: fallDistance, modifier: FALL_MODIFIER_HAY };
    case "honey_block":
      return { distance: fallDistance, modifier: FALL_MODIFIER_HONEY };
    case "slime_block":
      // only if NOT suppressing bounce; modifier 0.0 -> zero damage anyway.
      return ctx.suppressingBounce ? null : { distance: fallDistance, modifier: FALL_MODIFIER_SLIME };
    case "bed":
    case "white_bed":
    case "orange_bed":
    case "magenta_bed":
    case "light_blue_bed":
    case "yellow_bed":
    case "lime_bed":
    case "pink_bed":
    case "gray_bed":
    case "light_gray_bed":
    case "cyan_bed":
    case "purple_bed":
    case "blue_bed":
    case "brown_bed":
    case "green_bed":
    case "red_bed":
    case "black_bed":
      // super.fallOn with d*0.5, inherited modifier 1.0.
      return { distance: fallDistance * BED_DISTANCE_MULT, modifier: FALL_MODIFIER_GENERIC };
    case "powder_snow":
      return null; // no super -> no fall damage.
    case "pointed_dripstone":
      // only a tip pointing UP deals the +2.5 / x2.0 path; else generic.
      return ctx.dripstoneTipUp
        ? { distance: fallDistance + DRIPSTONE_EXTRA_DISTANCE, modifier: FALL_MODIFIER_DRIPSTONE }
        : { distance: fallDistance, modifier: FALL_MODIFIER_GENERIC };
    default:
      // generic (covers sweet_berry_bush, farmland, turtle_egg, etc. — modifier 1.0).
      return { distance: fallDistance, modifier: FALL_MODIFIER_GENERIC };
  }
}

// ---------------------------------------------------------------------------
// Pure damage math — LivingEntity.calculateFallPower / calculateFallDamage.
// ---------------------------------------------------------------------------

/** calculateFallPower(d) = d + 1e-6 - safeFallDistance. */
export function calculateFallPower(
  fallDistance: number,
  safeFallDistance = SAFE_FALL_DISTANCE_DEFAULT
): number {
  return fallDistance + POWER_EPSILON - safeFallDistance;
}

/**
 * calculateFallDamage(d, modifier) = floor( power(d) * modifier * FALL_DAMAGE_MULTIPLIER ).
 * NO max(0,...) here — a sub-safe fall yields a NEGATIVE floor; the only-apply gate lives in
 * causeFallDamage (`if (dmg > 0)`). `fallDamageImmune` short-circuits 0.
 */
export function calculateFallDamage(
  fallDistance: number,
  modifier = FALL_MODIFIER_GENERIC,
  opts: {
    safeFallDistance?: number;
    fallDamageMultiplier?: number;
    fallDamageImmune?: boolean;
  } = {}
): number {
  if (opts.fallDamageImmune) return 0;
  const safeFall = opts.safeFallDistance ?? SAFE_FALL_DISTANCE_DEFAULT;
  const mult = opts.fallDamageMultiplier ?? FALL_DAMAGE_MULTIPLIER_DEFAULT;
  const power = calculateFallPower(fallDistance, safeFall);
  return Math.floor(power * modifier * mult);
}

/** Applied damage = raw floor if > 0 else 0 (the `if (dmg > 0)` gate). */
export function appliedFallDamage(rawDamage: number): number {
  return rawDamage > 0 ? rawDamage : 0;
}

// ---------------------------------------------------------------------------
// FallDistanceTracker — the per-entity accumulator + landing trigger + impulse grace.
// ---------------------------------------------------------------------------

/** Minimal impact-position type for the impulse-grace clamp (only `.y` is read). */
export interface ImpactPos {
  y: number;
}

/** Per-tick movement input to the accumulator (the post-collision move result). */
export interface FallTickInput {
  /** post-collision vertical displacement this tick. */
  movementY: number;
  /** post-collision horizontal+vertical movement, used by the resetting raycast guard. */
  movementX?: number;
  movementZ?: number;
  /** state gates (read at the relevant points in the vanilla tick order). */
  isInWater?: boolean; // !isInWater gate for accumulation + water reset
  isInLava?: boolean; // lava *= 0.5
  onClimbable?: boolean; // onClimbable reset
  slowFalling?: boolean; // travel reset
  levitation?: boolean; // travel reset
  riding?: boolean; // reset every tick while riding
  inBubbleColumn?: boolean; // bubble-column reset
  stuckInBlock?: boolean; // makeStuckInBlock (cobweb/sweet-berry) reset
  /** current y-position, only needed when an impulse grace is active. */
  positionY?: number;
}

export interface LandingResult {
  /** true if the entity is on the ground this tick (landing occurred). */
  landed: boolean;
  /** the fallDistance consumed by fallOn (the value BEFORE the reset), 0 if none. */
  consumedFallDistance: number;
  /** raw floored damage from calculateFallDamage (may be negative; not yet gated). */
  rawDamage: number;
  /** applied damage after the `>0` gate. */
  appliedDamage: number;
}

export interface FallTrackerOptions {
  safeFallDistance?: number; // SAFE_FALL_DISTANCE attribute (default 3.0)
  fallDamageMultiplier?: number; // FALL_DAMAGE_MULTIPLIER attribute (default 1.0)
  /** mayfly (creative/flight-capable) -> causeFallDamage returns false (no fall damage). */
  mayfly?: boolean;
  /** FALL_DAMAGE_IMMUNE -> 0 damage. */
  fallDamageImmune?: boolean;
}

export class FallDistanceTracker {
  /** The accumulator (blocks). Vanilla `Entity.fallDistance`, a double. */
  public fallDistance = 0;

  /** Impulse-grace state (wind charge / mace). */
  private currentImpulseImpactPos: ImpactPos | null = null;
  private currentImpulseContextResetGraceTime = 0;

  constructor(public readonly opts: FallTrackerOptions = {}) {}

  private get safeFall(): number {
    return clamp(
      this.opts.safeFallDistance ?? SAFE_FALL_DISTANCE_DEFAULT,
      SAFE_FALL_DISTANCE_MIN,
      SAFE_FALL_DISTANCE_MAX
    );
  }

  private get fallMult(): number {
    return clamp(
      this.opts.fallDamageMultiplier ?? FALL_DAMAGE_MULTIPLIER_DEFAULT,
      FALL_DAMAGE_MULTIPLIER_MIN,
      FALL_DAMAGE_MULTIPLIER_MAX
    );
  }

  public resetFallDistance(): void {
    this.fallDistance = 0;
  }

  /**
   * checkFallDistanceAccumulation() — clamp fall distance to 1.0 while not steeply descending.
   * Called by elytra glide / leash / sulfur launch each tick.
   * `if (vel.y > -0.5 && fallDistance > 1.0) fallDistance = 1.0`.
   */
  public checkFallDistanceAccumulation(velY: number): void {
    if (velY > ELYTRA_CLAMP_SPEED && this.fallDistance > ELYTRA_CLAMP_TO) {
      this.fallDistance = ELYTRA_CLAMP_TO;
    }
  }

  /** Entity.baseTick lava decay — `if (isInLava) fallDistance *= 0.5`. */
  public applyLavaDecay(): void {
    this.fallDistance *= LAVA_DECAY;
  }

  // --- Impulse grace (wind charge / mace) -------------------------------------

  public setIgnoreFallDamageFromCurrentImpulse(impactPos: ImpactPos): void {
    this.applyPostImpulseGraceTime(IMPULSE_GRACE_TICKS); // grace = max(grace, 40)
    this.currentImpulseImpactPos = { y: impactPos.y };
  }

  public applyPostImpulseGraceTime(ticks: number): void {
    this.currentImpulseContextResetGraceTime = Math.max(this.currentImpulseContextResetGraceTime, ticks);
  }

  /** isIgnoringFallDamageFromCurrentImpulse() — impactPos != null. */
  public isIgnoringFallDamageFromCurrentImpulse(): boolean {
    return this.currentImpulseImpactPos != null;
  }

  public resetCurrentImpulseContext(): void {
    this.currentImpulseContextResetGraceTime = 0;
    this.currentImpulseImpactPos = null;
  }

  /** tryResetCurrentImpulseContext() — reset only if grace already expired. */
  public tryResetCurrentImpulseContext(): void {
    if (this.currentImpulseContextResetGraceTime === 0) {
      this.resetCurrentImpulseContext();
    }
  }

  /**
   * Tick the impulse grace window down by 1 (the `currentImpulseContextResetGraceTime` countdown).
   * Call once per tick AFTER step(); at 0 the next causeFallDamage with no landing-above will not
   * auto-reset.
   */
  public tickImpulseGrace(): void {
    if (this.currentImpulseContextResetGraceTime > 0) {
      this.currentImpulseContextResetGraceTime--;
    }
  }

  // --- Per-tick resets (run at the distinct points of the vanilla tick) -------

  /**
   * Run the independent per-tick fall-distance resets that happen OUTSIDE the move/accumulate path,
   * in the vanilla evaluation order:
   *   travel:  SLOW_FALLING || LEVITATION -> reset
   *   climb:   onClimbable -> reset
   *   lava:    isInLava -> *= 0.5
   *   bubble:  inBubbleColumn -> reset
   *   stuck:   stuckInBlock (cobweb/berry) -> reset
   *   riding:  riding -> reset
   * NOTE: water reset is handled inside step() (updateFluidInteraction is invoked from checkFallDamage).
   */
  public applyPreMoveResets(input: FallTickInput): void {
    if (input.slowFalling || input.levitation) this.resetFallDistance();
    if (input.onClimbable) this.resetFallDistance();
    if (input.isInLava) this.applyLavaDecay();
    if (input.inBubbleColumn) this.resetFallDistance();
    if (input.stuckInBlock) this.resetFallDistance();
    if (input.riding) this.resetFallDistance();
  }

  /**
   * The FALLDAMAGE_RESETTING raycast inside Entity.move.
   * Reset fall distance when, with accumulated distance AND a post-collision movement of >= 1 block
   * (SQUARED length), the movement ray hits a `fall_damage_resetting`-tagged block within min(len,8).
   *
   * @param movement post-collision movement vector this tick.
   * @param rayHitResetting a callback the caller supplies: cast the ray
   *        `pos -> pos + movement.normalize()*min(len,8)` against resetting-tagged blocks and return
   *        true on a non-MISS hit. (World access lives outside this module.)
   */
  public maybeResetByRaycast(
    movement: { x: number; y: number; z: number },
    rayHitResetting: () => boolean
  ): void {
    const lenSq = movement.x * movement.x + movement.y * movement.y + movement.z * movement.z;
    if (this.fallDistance !== 0 && lenSq >= RESET_RAYCAST_MIN_MOVE_SQ) {
      if (rayHitResetting()) {
        this.resetFallDistance();
      }
    }
  }

  // --- The core: accumulate + land (Entity.checkFallDamage) -------------------

  /**
   * The fall-distance accumulate + landing trigger (Entity.checkFallDamage), with the
   * water reset hook (updateFluidInteraction) folded in:
   *
   *   1. if !isInWater AND we entered water this tick -> resetFallDistance.
   *      Here, modelled as: `isInWater` true -> reset (water zeroes fall distance).
   *   2. if (!isInWater && ya < 0)  fallDistance -= (float)ya     // adds the descent
   *   3. if (onGround):
   *        if (fallDistance > 0): fallOn(block, fallDistance) -> causeFallDamage
   *        resetFallDistance()
   *
   * @param onGround whether the entity is on the ground after this move.
   * @param blockBelowName the block at getOnPosLegacy() (for the fallOn dispatch). Default "stone".
   * @returns the landing result (damage numbers), all 0 when not landing.
   */
  public step(
    input: FallTickInput,
    onGround: boolean,
    blockBelowName = "stone",
    fallOnCtx: FallOnContext = {}
  ): LandingResult {
    const inWater = !!input.isInWater;

    // (1) Water contact zeroes fall distance. Modelled as: being in water this tick -> reset before
    // accumulation (and accumulation is gated off anyway).
    if (inWater) {
      this.resetFallDistance();
    }

    // (2) Accumulate the descent: not-in-water && ya<0 -> += -(float)ya.
    const ya = input.movementY;
    if (!inWater && ya < 0.0) {
      this.fallDistance -= f(ya); // `-(float)ya` — narrow per-tick delta to a Java float
    }

    // (3) Landing.
    const result: LandingResult = {
      landed: onGround,
      consumedFallDistance: 0,
      rawDamage: 0,
      appliedDamage: 0,
    };

    if (onGround) {
      if (this.fallDistance > 0.0) {
        result.consumedFallDistance = this.fallDistance;
        const dmg = this.causeFallDamageFromFallOn(blockBelowName, this.fallDistance, input.positionY, fallOnCtx);
        result.rawDamage = dmg.raw;
        result.appliedDamage = dmg.applied;
      }
      this.resetFallDistance();
    }

    return result;
  }

  /**
   * Block.fallOn -> causeFallDamage -> calculateFallDamage, for a landing. Returns {raw, applied}:
   * per-block fallOn (resolveFallOn) + the mayfly gate + the impulse-grace clamp + calculateFallDamage.
   *
   * @param positionY current y (only consulted when an impulse grace is active).
   */
  public causeFallDamageFromFallOn(
    blockBelowName: string,
    fallDistance: number,
    positionY?: number,
    fallOnCtx: FallOnContext = {}
  ): { raw: number; applied: number } {
    // mayfly (creative / flight-capable): causeFallDamage returns false -> no damage.
    if (this.opts.mayfly) return { raw: 0, applied: 0 };

    // Per-block fallOn -> (distance, modifier), or NONE (powder snow / suppressed slime).
    const fallOn = resolveFallOn(blockBelowName, fallDistance, fallOnCtx);
    if (fallOn == null) return { raw: 0, applied: 0 };

    // Impulse grace: effectiveFallDistance = min(fallDistance, impactPos.y - getY()) while ignoring
    // impulse fall dmg.
    let effectiveDistance = fallOn.distance;
    if (this.isIgnoringFallDamageFromCurrentImpulse() && positionY != null && this.currentImpulseImpactPos) {
      effectiveDistance = Math.min(fallOn.distance, this.currentImpulseImpactPos.y - positionY);
      const landedAboveImpact = effectiveDistance <= 0.0;
      if (landedAboveImpact) {
        this.resetCurrentImpulseContext();
      } else {
        this.tryResetCurrentImpulseContext();
      }
    }

    const raw = calculateFallDamage(effectiveDistance, fallOn.modifier, {
      safeFallDistance: this.safeFall,
      fallDamageMultiplier: this.fallMult,
      fallDamageImmune: this.opts.fallDamageImmune,
    });
    const applied = appliedFallDamage(raw);
    if (applied > 0) {
      this.resetCurrentImpulseContext(); // on actual damage
    }
    return { raw, applied };
  }
}
