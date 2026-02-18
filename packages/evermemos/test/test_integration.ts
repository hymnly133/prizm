import { MemoryManager } from '../src/core/MemoryManager'
import { SQLiteAdapter } from '../src/storage/sqlite'
import { UnifiedExtractor } from '../src/extractors/UnifiedExtractor'
import { MemoryType, MemCell, RawDataType } from '../src/types'
import { ICompletionProvider } from '../src/utils/llm'
import { VectorStoreAdapter } from '../src/storage/interfaces'
import path from 'path'
import fs from 'fs'

// Mock LLM Provider
class MockLLMProvider implements ICompletionProvider {
  async generate(request: any): Promise<string> {
    console.log('Generating with prompt:', request.prompt.substring(0, 50) + '...')
    return [
      '## Narrative',
      'Test narrative content',
      '',
      '## Event Log',
      '- User started a test',
      '',
      '## Foresight',
      '- User may need further testing',
      '',
      '## Profile',
      '- User is testing the system'
    ].join('\n')
  }

  async getEmbedding(text: string): Promise<number[]> {
    return new Array(1536).fill(0.1)
  }
}

// Mock Vector Store Adapter
class MockVectorAdapter implements VectorStoreAdapter {
  async add(collectionName: string, items: any[]): Promise<void> {
    console.log('[MockVector] Adding ' + items.length + ' items to ' + collectionName)
  }
  async search(collectionName: string, query: number[], limit?: number): Promise<any[]> {
    return []
  }
  async createTable(tableName: string, schema: any): Promise<void> {}
  async delete(collectionName: string, filter: string): Promise<void> {}
  async get(collectionName: string, id: string): Promise<any> {
    return null
  }
}

async function runTest() {
  const dbPath = path.join(__dirname, 'test.db')

  // Cleanup
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)

  const storage = {
    relational: new SQLiteAdapter(dbPath),
    vector: new MockVectorAdapter()
  }

  const llm = new MockLLMProvider()
  const unifiedExtractor = new UnifiedExtractor(llm)
  const manager = new MemoryManager(storage, {
    unifiedExtractor,
    embeddingProvider: llm
  })

  const memcell: MemCell = {
    event_id: 'ev1',
    user_id: 'user1',
    type: RawDataType.CONVERSATION,
    text: 'User: Hello, I am testing the system.',
    timestamp: new Date().toISOString(),
    deleted: false,
    scene: 'assistant'
  }

  console.log('Processing MemCell via processPerRound...')
  await manager.processPerRound(memcell, { scope: 'default' })
  console.log('Processing complete.')
}

runTest().catch(console.error)
