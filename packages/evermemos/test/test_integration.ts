import { MemoryManager } from '../src/core/MemoryManager'
import { SQLiteAdapter } from '../src/storage/sqlite'
// import { LanceDBAdapter } from '../src/storage/lancedb';
import { EventLogExtractor } from '../src/extractors/EventLogExtractor'
import { ForesightExtractor } from '../src/extractors/ForesightExtractor'
import { EpisodeExtractor } from '../src/extractors/EpisodeExtractor'
import { ProfileMemoryExtractor } from '../src/extractors/ProfileMemoryExtractor'
import { MemoryType, MemCell, RawDataType } from '../src/types'
import { ICompletionProvider } from '../src/utils/llm'
import { VectorStoreAdapter } from '../src/storage/interfaces'
import path from 'path'
import fs from 'fs'

// Mock LLM Provider
class MockLLMProvider implements ICompletionProvider {
  async generate(request: any): Promise<string> {
    console.log('Generating with prompt:', request.prompt.substring(0, 50) + '...')
    if (request.prompt.includes('profile')) {
      return JSON.stringify({
        user_profiles: [
          {
            user_id: 'user1',
            user_name: 'Test User',
            personality: [{ value: 'Openness', evidences: ['ev1'] }]
          }
        ]
      })
    }
    if (request.prompt.includes('event log')) {
      return JSON.stringify({
        event_log: {
          time: new Date().toISOString(),
          atomic_fact: ['User started a test']
        }
      })
    }
    return JSON.stringify({ content: 'Test content', summary: 'Test summary' })
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
  const manager = new MemoryManager(storage)

  manager.registerExtractor(MemoryType.EVENT_LOG, new EventLogExtractor(llm))
  manager.registerExtractor(MemoryType.FORESIGHT, new ForesightExtractor(llm))
  manager.registerExtractor(MemoryType.EPISODIC_MEMORY, new EpisodeExtractor(llm))
  manager.registerExtractor(MemoryType.PROFILE, new ProfileMemoryExtractor(llm))

  const memcell: MemCell = {
    event_id: 'ev1',
    user_id: 'user1',
    type: RawDataType.CONVERSATION,
    text: 'User: Hello, I am testing the system.',
    timestamp: new Date().toISOString()
  }

  console.log('Processing MemCell...')
  await manager.processMemCell(memcell)
  console.log('Processing complete.')
}

runTest().catch(console.error)
