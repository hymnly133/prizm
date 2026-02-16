export interface ScoredDoc {
  id: string
  score: number
  [key: string]: any
}

/**
 * Reciprocal Rank Fusion
 * @param list1 First list of scored docs
 * @param list2 Second list of scored docs
 * @param k Constant k
 */
export function reciprocalRankFusion(
  list1: ScoredDoc[],
  list2: ScoredDoc[],
  k: number = 60
): ScoredDoc[] {
  const scores: Map<string, number> = new Map()
  const docs: Map<string, ScoredDoc> = new Map()

  const numLists = 2

  // Process list 1
  list1.forEach((doc, rank) => {
    const score = 1.0 / (k + rank + 1)
    scores.set(doc.id, (scores.get(doc.id) || 0) + score)
    docs.set(doc.id, doc)
  })

  // Process list 2
  list2.forEach((doc, rank) => {
    const score = 1.0 / (k + rank + 1)
    scores.set(doc.id, (scores.get(doc.id) || 0) + score)
    if (!docs.has(doc.id)) {
      docs.set(doc.id, doc)
    }
  })

  // Normalize: theoretical max = numLists / (k + 1) (rank 0 in every list)
  const maxScore = numLists / (k + 1)

  // Sort by score descending
  const sortedIds = Array.from(scores.keys()).sort(
    (a, b) => (scores.get(b) || 0) - (scores.get(a) || 0)
  )

  return sortedIds.map((id) => {
    const doc = docs.get(id)!
    return { ...doc, score: (scores.get(id) || 0) / maxScore }
  })
}

/**
 * N-way Reciprocal Rank Fusion（用于 agentic 多查询结果融合）
 */
export function reciprocalRankFusionMulti(lists: ScoredDoc[][], k: number = 60): ScoredDoc[] {
  const scores: Map<string, number> = new Map()
  const docs: Map<string, ScoredDoc> = new Map()

  const numLists = lists.length || 1

  for (const list of lists) {
    list.forEach((doc, rank) => {
      const score = 1.0 / (k + rank + 1)
      scores.set(doc.id, (scores.get(doc.id) || 0) + score)
      if (!docs.has(doc.id)) docs.set(doc.id, doc)
    })
  }

  // Normalize: theoretical max = numLists / (k + 1) (rank 0 in every list)
  const maxScore = numLists / (k + 1)

  const sortedIds = Array.from(scores.keys()).sort(
    (a, b) => (scores.get(b) || 0) - (scores.get(a) || 0)
  )
  return sortedIds.map((id) => {
    const doc = docs.get(id)!
    return { ...doc, score: (scores.get(id) || 0) / maxScore }
  })
}
