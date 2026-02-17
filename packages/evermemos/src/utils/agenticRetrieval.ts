import type { SearchResult } from '../types.js'
import { SUFFICIENCY_CHECK_PROMPT, REFINED_QUERY_PROMPT } from '../prompts.js'
import { parseJSON } from './llm.js'

/**
 * Minimal LLM completion interface needed by agentic retrieval utilities.
 * Kept separate from the full ICompletionProvider to avoid circular imports.
 */
export interface IAgenticCompletionProvider {
  generate(request: {
    prompt: string
    temperature?: number
    json?: boolean
    operationTag?: string
  }): Promise<string>
}

// ---------------------------------------------------------------------------
// Document formatting
// ---------------------------------------------------------------------------

function formatDocumentsForLLM(results: SearchResult[], maxDocs: number = 10): string {
  const lines: string[] = []
  for (let i = 0; i < Math.min(results.length, maxDocs); i++) {
    const r = results[i]
    lines.push(`[Memory ${i + 1}]`)
    lines.push(`Content: ${r.content}`)
    lines.push(`Relevance: ${r.score.toFixed(4)}`)
    lines.push('')
  }
  return lines.length > 0 ? lines.join('\n') : 'No retrieval results'
}

// ---------------------------------------------------------------------------
// Sufficiency check
// ---------------------------------------------------------------------------

export interface SufficiencyResult {
  isSufficient: boolean
  reasoning: string
  missingInfo: string[]
}

/**
 * Ask LLM whether the top-K retrieval results sufficiently answer the user query.
 * Falls back to "sufficient" on parse errors to avoid infinite retry loops.
 */
export async function checkSufficiency(
  query: string,
  results: SearchResult[],
  llm: IAgenticCompletionProvider,
  maxDocs: number = 5
): Promise<SufficiencyResult> {
  const retrievedDocs = formatDocumentsForLLM(results, maxDocs)
  const prompt = SUFFICIENCY_CHECK_PROMPT.replace('{{QUERY}}', query).replace(
    '{{RETRIEVED_DOCS}}',
    retrievedDocs
  )

  const raw = await llm.generate({
    prompt,
    temperature: 0,
    json: true,
    operationTag: 'memory:query_expansion'
  })

  const parsed = parseJSON(raw)
  if (parsed && typeof parsed.is_sufficient === 'boolean') {
    return {
      isSufficient: parsed.is_sufficient,
      reasoning: parsed.reasoning ?? '',
      missingInfo: Array.isArray(parsed.missing_information)
        ? parsed.missing_information.filter((x: unknown) => typeof x === 'string')
        : []
    }
  }

  return { isSufficient: true, reasoning: 'Failed to parse LLM response', missingInfo: [] }
}

// ---------------------------------------------------------------------------
// Refined query generation
// ---------------------------------------------------------------------------

/**
 * Generate 2-3 complementary queries targeting the missing information.
 * Falls back to the original query on errors.
 */
export async function generateRefinedQueries(
  originalQuery: string,
  results: SearchResult[],
  missingInfo: string[],
  llm: IAgenticCompletionProvider,
  maxDocs: number = 5
): Promise<string[]> {
  const retrievedDocs = formatDocumentsForLLM(results, maxDocs)
  const missingStr = missingInfo.length > 0 ? missingInfo.join(', ') : 'N/A'
  const prompt = REFINED_QUERY_PROMPT.replace('{{ORIGINAL_QUERY}}', originalQuery)
    .replace('{{RETRIEVED_DOCS}}', retrievedDocs)
    .replace('{{MISSING_INFO}}', missingStr)

  const raw = await llm.generate({
    prompt,
    temperature: 0.4,
    json: true,
    operationTag: 'memory:query_expansion'
  })

  const parsed = parseJSON(raw)
  if (parsed && Array.isArray(parsed.queries)) {
    const valid = parsed.queries
      .filter(
        (q: unknown) =>
          typeof q === 'string' &&
          q.trim().length >= 3 &&
          q.trim().toLowerCase() !== originalQuery.trim().toLowerCase()
      )
      .map((q: string) => q.trim())
      .slice(0, 3)
    if (valid.length > 0) return valid
  }

  return [originalQuery]
}
