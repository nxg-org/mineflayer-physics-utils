import { AABB, AABBUtils } from '@nxg-org/mineflayer-util-plugin'
import entityLoader, { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { PlayerPoses, PlayerPosesByNumber } from '../states/poses'
import md from 'minecraft-data'
import { EntityState } from '../states/entityState'
import { IPhysics } from '../engines/IPhysics'

function getPose (entity: Entity) {
  const pose = entity.metadata.find((e) => (e as any).type === 18)
  return (pose != null) ? ((pose as any).value as number) : PlayerPoses.STANDING
}

function applyMdToNewEntity (entityType: md.Entity): Entity {
  const tmp = new Entity(10)
  return tmp
}

function load (data: md.IndexedData) {
  EPhysicsCtx.mcData = data
  EPhysicsCtx.entityData = data.entitiesByName
  EPhysicsCtx.mobData = data.mobs
  EPhysicsCtx.entityConstructor = (entityLoader as any)(data.version.minecraftVersion)
}

export const emptyVec = new Vec3(0, 0, 0)

type PlayerPoseContext = { [key in PlayerPoses]: { width: number, height: number } }
export class EPhysicsCtx {
  public static loadData: (data: md.IndexedData) => void = load
  public static entityConstructor: new (id: number) => Entity
  public static mcData: md.IndexedData
  public static entityData: md.IndexedData['entitiesByName']
  public static mobData: md.IndexedData['mobs']

  public static readonly playerPoseContext: PlayerPoseContext = {
    0: { width: 0.6, height: 1.8 },
    1: { width: 0.2, height: 0.2 },
    2: { width: 0.6, height: 0.6 },
    3: { width: 0.6, height: 0.6 },
    4: { width: 0.6, height: 0.6 },
    5: { width: 0.6, height: 0.6 },
    6: { width: 0.6, height: 1.5 },
    7: { width: 0.2, height: 0.2 }
  }

  public readonly position: Vec3
  public readonly velocity: Vec3

  constructor (
    public ctx: IPhysics,
    public pose: PlayerPoses,
    public readonly state: EntityState,
    public readonly entityType: md.Entity,
    public readonly useControls: boolean
  ) {
    this.position = state.position
    this.velocity = state.velocity
  }

  public static FROM_ENTITY (ctx: IPhysics, entity: Entity) {
    return new EPhysicsCtx(
      ctx,
      getPose(entity),
      EntityState.CREATE_FROM_ENTITY(ctx, entity),
      EPhysicsCtx.entityData[entity.name!], // unsafe.
      entity.type === 'player' || entity.type === 'mob'
    )
  }

  public static FROM_ENTITY_TYPE (ctx: IPhysics, entityType: md.Entity) {
    const isMob = !!EPhysicsCtx.mobData[entityType.id]
    const newE = applyMdToNewEntity(entityType)
    return new EPhysicsCtx(
      ctx,
      PlayerPoses.STANDING,
      EntityState.CREATE_FROM_ENTITY(ctx, newE),
      entityType,
      entityType.type === 'player' || isMob
    )
  }

  public clone () {
    return new EPhysicsCtx(this.ctx, this.state.pose, this.state.clone(), this.entityType, this.useControls)
  }

  public get height (): number {
    if (this.entityType.type === 'player') {
      return EPhysicsCtx.playerPoseContext[this.pose].height
    }
    return this.entityType.height ?? 0
  }

  public get width (): number {
    if (this.entityType.type === 'player') {
      return EPhysicsCtx.playerPoseContext[this.pose].width
    }
    return this.entityType.width ?? 0
  }

  public getHalfWidth (): number {
    return this.width / 2
  }

  public getCurrentBBWithPose (): AABB {
    const halfWidth = this.getHalfWidth()
    return new AABB(
      this.position.x - halfWidth,
      this.position.y,
      this.position.z - halfWidth,
      this.position.x + halfWidth,
      this.position.y + this.height,
      this.position.z + halfWidth
    )
  }

  public getBBWithPose (position: { x: number, y: number, z: number }): AABB {
    const halfWidth = this.getHalfWidth()
    return new AABB(
      position.x - halfWidth,
      position.y,
      position.z - halfWidth,
      position.x + halfWidth,
      position.y + this.height,
      position.z + halfWidth
    )
  }

  public getBB (position: { x: number, y: number, z: number }): AABB {
    const halfWidth = this.entityType.width ? this.entityType.width / 2 : 0
    return new AABB(
      position.x - halfWidth,
      position.y,
      position.z - halfWidth,
      position.x + halfWidth,
      position.y + (this.entityType.height ?? 0),
      position.z + halfWidth
    )
  }
}
