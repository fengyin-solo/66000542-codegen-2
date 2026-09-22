import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { AnalysisResult, AlertRule } from '@/types'

export type SortKey = 'time' | 'level'
export type SortOrder = 'asc' | 'desc'

export const useLogStore = defineStore('log', () => {
  const result = ref<AnalysisResult | null>(null)
  const loading = ref(false)
  const searchQuery = ref('')
  const logType = ref('nginx')
  const rules = ref<AlertRule[]>([
    { id:1, name:'高频ERROR', type:'level', threshold:5, enabled:true },
    { id:2, name:'异常流量', type:'count', threshold:200, enabled:false },
    { id:3, name:'关键词命中', type:'keyword', threshold:0, enabled:true }
  ])

  // 日志流面板的定位条件：返回（重新生成/检测）后需保持，不随请求重置
  const selectedLevels = ref<string[]>([])
  const selectedSources = ref<string[]>([])
  const messageKeyword = ref('')
  const sortBy = ref<SortKey>('time')
  const sortOrder = ref<SortOrder>('desc')

  async function generate() {
    loading.value=true
    try { const {data} = await axios.post('/api/generate',{type:logType.value,count:1000}) ; result.value=data }
    finally { loading.value=false }
  }

  async function detect() {
    if (!result.value) return
    loading.value=true
    try { const {data} = await axios.post('/api/detect',{logs:result.value.logs,rules:rules.value.filter(r=>r.enabled),query:searchQuery.value}) ; result.value=data }
    finally { loading.value=false }
  }

  function resetFilters() {
    selectedLevels.value = []
    selectedSources.value = []
    messageKeyword.value = ''
  }

  return { result, loading, searchQuery, logType, rules,
    selectedLevels, selectedSources, messageKeyword, sortBy, sortOrder,
    generate, detect, resetFilters }
})
