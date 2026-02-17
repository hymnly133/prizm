import { PrizmClient } from '../client'
import type { EmbeddingStatus, EmbeddingTestResult, EmbeddingReloadResult } from '../clientTypes'

declare module '../client' {
  interface PrizmClient {
    getEmbeddingStatus(): Promise<EmbeddingStatus>
    testEmbedding(text: string, compareWith?: string): Promise<EmbeddingTestResult>
    reloadEmbedding(dtype?: string): Promise<EmbeddingReloadResult>
  }
}

PrizmClient.prototype.getEmbeddingStatus = async function (this: PrizmClient) {
  return this.request<EmbeddingStatus>('/embedding/status')
}

PrizmClient.prototype.testEmbedding = async function (
  this: PrizmClient,
  text: string,
  compareWith?: string
) {
  return this.request<EmbeddingTestResult>('/embedding/test', {
    method: 'POST',
    body: JSON.stringify({ text, compareWith })
  })
}

PrizmClient.prototype.reloadEmbedding = async function (this: PrizmClient, dtype?: string) {
  return this.request<EmbeddingReloadResult>('/embedding/reload', {
    method: 'POST',
    body: dtype ? JSON.stringify({ dtype }) : undefined
  })
}
