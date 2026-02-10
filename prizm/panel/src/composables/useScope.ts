/**
 * Scope 切换 composable - 全局共享
 */

import { ref, readonly, type Ref } from 'vue'
import { getScopes } from '../api/client'

const currentScope = ref('default')
const scopes = ref<string[]>(['default'])

export function useScope() {
  async function loadScopes() {
    try {
      const res = await getScopes()
      scopes.value = res.scopes?.length ? res.scopes : ['default']
      if (!scopes.value.includes(currentScope.value)) {
        currentScope.value = scopes.value[0] ?? 'default'
      }
    } catch {
      scopes.value = ['default']
      currentScope.value = 'default'
    }
  }

  function setScope(scope: string) {
    currentScope.value = scope
    if (!scopes.value.includes(scope)) {
      scopes.value = [scope, ...scopes.value].filter(Boolean).sort()
    }
  }

  return {
    currentScope: readonly(currentScope) as Ref<string>,
    scopes: readonly(scopes) as Ref<string[]>,
    setScope,
    loadScopes
  }
}
