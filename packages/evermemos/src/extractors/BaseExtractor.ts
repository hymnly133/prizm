import { MemCell, BaseMemory, MemoryType } from '../types.js'

export interface IExtractor {
  extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null>
}

export abstract class BaseExtractor implements IExtractor {
  abstract extract<T extends BaseMemory>(memcell: MemCell): Promise<T[] | null>

  protected getMemoryType(): MemoryType {
    throw new Error('Method not implemented.')
  }
}
