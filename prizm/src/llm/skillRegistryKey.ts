/**
 * Registry 唯一键：用于区分同名不同源的 skill。
 * 格式: source:owner/repo:skillPath
 */

export type RegistrySource = 'github' | 'curated' | 'skillkit' | 'skillsmp'

export interface SkillOrigin {
  source: RegistrySource
  owner: string
  repo: string
  skillPath: string
}

export function getRegistryKey(params: {
  source: string
  owner: string
  repo: string
  skillPath: string
}): string {
  const { source, owner, repo, skillPath } = params
  return `${source}:${owner}/${repo}:${skillPath}`
}
