<template>
  <div class="panel" style="height:100%;display:flex;flex-direction:column">
    <h4>📋 日志流 ({{ totalLogs }} 条)</h4>

    <div class="filter-bar">
      <el-select
        v-model="store.tableLevels"
        multiple collapse-tags collapse-tags-tooltip
        placeholder="级别（全部）"
        size="small" style="width:130px"
      >
        <el-option v-for="l in levelOptions" :key="l" :label="l" :value="l"/>
      </el-select>
      <el-select
        v-model="store.tableSources"
        multiple collapse-tags collapse-tags-tooltip
        placeholder="来源（全部）"
        size="small" style="width:130px"
      >
        <el-option v-for="s in sourceOptions" :key="s" :label="s" :value="s"/>
      </el-select>
      <el-input
        v-model="store.tableKeyword"
        placeholder="检索消息关键词..."
        size="small" style="width:150px" clearable
      />
      <el-select v-model="store.tableSortBy" size="small" style="width:96px">
        <el-option label="按时间" value="time"/>
        <el-option label="按级别" value="level"/>
      </el-select>
      <el-tooltip :content="store.tableSortDesc ? '当前降序，点击切为升序' : '当前升序，点击切为降序'" placement="top">
        <el-button size="small" @click="store.tableSortDesc = !store.tableSortDesc">
          {{ store.tableSortDesc ? '↓ 降序' : '↑ 升序' }}
        </el-button>
      </el-tooltip>
      <el-button size="small" :disabled="!hasActiveFilters" @click="store.resetTableFilters()">重置</el-button>
    </div>

    <div class="result-meta">
      <template v-if="filteredLogs.length">
        命中 <b>{{ filteredLogs.length }}</b> / {{ totalLogs }} 条
        <span v-if="hasActiveFilters" class="muted">（顶部条数与窗口聚合仍按全部 {{ totalLogs }} 条统计）</span>
      </template>
      <span v-else-if="totalLogs" class="muted">命中 0 / {{ totalLogs }} 条</span>
      <span v-else class="muted">尚未生成日志</span>
    </div>

    <div v-if="totalLogs && !filteredLogs.length" class="empty-state">
      <div class="empty-icon">🔍</div>
      <div class="empty-title">没有符合条件的日志</div>
      <div v-if="diagnosis" class="empty-guidance">
        <div class="guidance-head">建议调整：</div>
        <ul>
          <li v-for="(d, i) in diagnosis.tips" :key="i">
            <el-tag size="small" :type="d.type" effect="dark">{{ d.label }}</el-tag>
            <span>{{ d.text }}</span>
          </li>
        </ul>
        <div class="empty-actions">
          <el-button
            v-for="f in diagnosis.fixes" :key="f.label"
            size="small" :type="f.type" @click="clearOne(f.key)"
          >
            清除「{{ f.label }}」
          </el-button>
          <el-button size="small" @click="store.resetTableFilters()">重置全部条件</el-button>
        </div>
      </div>
      <div v-else class="empty-guidance">
        当前未设置任何筛选条件，请先重新生成日志。
      </div>
    </div>

    <div v-else class="table-wrap">
      <el-table :data="filteredLogs" size="small" max-height="400" stripe>
        <el-table-column prop="id" label="#" width="50"/>
        <el-table-column prop="timestamp" label="时间" width="150"/>
        <el-table-column prop="level" label="级别" width="80">
          <template #default="{row}">
            <el-tag size="small" :type="levelTagType(row.level)">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="120"/>
        <el-table-column prop="message" label="消息" show-overflow-tooltip/>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLogStore } from '../store/log'
import type { LogEntry } from '@/types'

const store = useLogStore()

const allLogs = computed<LogEntry[]>(() => store.result?.logs ?? [])
const totalLogs = computed(() => store.result?.totalLogs ?? 0)

const hasActiveFilters = computed(() =>
  store.tableLevels.length > 0 || store.tableSources.length > 0 || store.tableKeyword.trim() !== ''
)

// 可选项来自当前（全量）日志，便于发现哪些级别/来源真实存在；级别按严重程度排序
const levelOptions = computed(() =>
  [...new Set(allLogs.value.map(l => l.level))]
    .sort((a, b) => severityOf(a) - severityOf(b) || a.localeCompare(b))
)
const sourceOptions = computed(() => uniqSorted(allLogs.value.map(l => l.source)))

function uniqSorted(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b))
}

const filteredLogs = computed(() => {
  const levels = new Set(store.tableLevels)
  const sources = new Set(store.tableSources)
  const kw = store.tableKeyword.trim().toLowerCase()
  const rows = allLogs.value.filter(l =>
    (levels.size === 0 || levels.has(l.level)) &&
    (sources.size === 0 || sources.has(l.source)) &&
    (kw === '' || l.message.toLowerCase().includes(kw))
  )

  const dir = store.tableSortDesc ? -1 : 1
  rows.sort((a, b) => {
    let cmp: number
    if (store.tableSortBy === 'level') {
      cmp = severityOf(a.level) - severityOf(b.level)
      if (cmp === 0) cmp = String(a.level).localeCompare(String(b.level))
    } else {
      cmp = parseTime(a.timestamp) - parseTime(b.timestamp)
    }
    return cmp !== 0 ? cmp * dir : (a.id - b.id) * dir
  })
  return rows
})

const SEVERITY: Record<string, number> = {
  debug: 0, DEBUG: 0,
  info: 1, INFO: 1, notice: 1,
  warn: 2, WARN: 2, warning: 2,
  error: 3, ERROR: 3, err: 3
}
function severityOf(level: string): number {
  if (level in SEVERITY) return SEVERITY[level]
  return SEVERITY[level.toLowerCase()] ?? 1
}

const MONTHS: Record<string, number> = {}
'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ').forEach((m, i) => { MONTHS[m] = i })

// 后端四种模板的时间格式互不相同，统一解析成可比较的毫秒值
function parseTime(ts: string): number {
  if (!ts) return 0
  if (/^\d+$/.test(ts)) return Number(ts) * 1000          // custom: epoch 秒
  let m = ts.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/) // nginx
  if (m) return Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6])
  m = ts.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})/) // apache
  if (m) return Date.UTC(+m[6], MONTHS[m[1]] ?? 0, +m[2], +m[3], +m[4], +m[5])
  const parsed = Date.parse(ts)                            // json_app: ISO8601
  return Number.isNaN(parsed) ? 0 : parsed
}

function levelTagType(level: string): 'danger' | 'warning' | 'info' | 'success' {
  const lv = level.toLowerCase()
  if (lv === 'error' || lv === 'err') return 'danger'
  if (lv === 'warn' || lv === 'warning') return 'warning'
  if (lv === 'debug') return 'info'
  return 'success' // info / notice
}

// ---- 空结果时的矛盾条件诊断：指出该调整哪一项 ----
type FixKey = 'level' | 'source' | 'keyword'
interface Tip { label: string; text: string; type: 'danger' | 'warning' | 'primary' }
interface Fix { label: string; key: FixKey; type: 'default' | 'primary' | 'warning' | 'danger' }

const diagnosis = computed<{ tips: Tip[]; fixes: Fix[] } | null>(() => {
  if (!totalLogs || filteredLogs.value.length) return null
  const tips: Tip[] = []
  const fixes: Fix[] = []

  const kw = store.tableKeyword.trim()
  const wantLevel = store.tableLevels.length > 0
  const wantSource = store.tableSources.length > 0
  const wantKeyword = kw !== ''

  // 先判断“选择值在数据里根本不存在”的情况
  if (wantLevel) {
    const available = new Set(levelOptions.value)
    const missing = store.tableLevels.filter(l => !available.has(l))
    if (missing.length) {
      tips.push({
        label: '级别', type: 'danger',
        text: `所选级别 ${missing.join('、')} 在当前日志中不存在，现有级别为 ${levelOptions.value.join('、') || '（无）'}，请改选或清空级别。`
      })
      fixes.push({ label: '级别', key: 'level', type: 'danger' })
    }
  }
  if (wantSource) {
    const available = new Set(sourceOptions.value)
    const missing = store.tableSources.filter(s => !available.has(s))
    if (missing.length) {
      tips.push({
        label: '来源', type: 'danger',
        text: `所选来源 ${missing.join('、')} 在当前日志中不存在，现有来源为 ${sourceOptions.value.join('、') || '（无）'}，请改选或清空来源。`
      })
      fixes.push({ label: '来源', key: 'source', type: 'danger' })
    }
  }
  if (tips.length) return { tips, fixes }

  // 选择值都存在，判断是哪一项把结果清零（去掉它即可命中）
  const kwLc = kw.toLowerCase()
  const matchLevel = (l: LogEntry) => !wantLevel || store.tableLevels.includes(l.level)
  const matchSource = (l: LogEntry) => !wantSource || store.tableSources.includes(l.source)
  const matchKeyword = (l: LogEntry) => !wantKeyword || l.message.toLowerCase().includes(kwLc)

  const culprits: FixKey[] = []
  if (wantLevel && allLogs.value.some(l => matchSource(l) && matchKeyword(l)))
    culprits.push('level')
  if (wantSource && allLogs.value.some(l => matchLevel(l) && matchKeyword(l)))
    culprits.push('source')
  if (wantKeyword && allLogs.value.some(l => matchLevel(l) && matchSource(l)))
    culprits.push('keyword')

  if (culprits.length === 1) {
    const key = culprits[0]
    if (key === 'keyword') {
      tips.push({ label: '关键词', type: 'warning', text: `消息中没有包含 “${kw}” 的日志（级别/来源条件本身有数据），请更换或放宽关键词。` })
    } else if (key === 'level') {
      tips.push({ label: '级别', type: 'warning', text: '当前级别与来源/关键词的交集为空：去掉级别限制后即可看到日志，请放宽级别选择。' })
    } else {
      tips.push({ label: '来源', type: 'warning', text: '当前来源与级别/关键词的交集为空：去掉来源限制后即可看到日志，请放宽来源选择。' })
    }
    fixes.push({ label: key === 'level' ? '级别' : key === 'source' ? '来源' : '关键词', key, type: 'warning' })
    return { tips, fixes }
  }

  if (culprits.length > 1) {
    const names = culprits.map(k => k === 'level' ? '级别' : k === 'source' ? '来源' : '关键词')
    const extra = wantKeyword ? `；关键词为 “${kw}”，也可一并更换` : ''
    tips.push({
      label: '条件冲突', type: 'danger',
      text: `${names.join('与')}互相矛盾：单独放宽其中任一项都能命中，请清除或调整其中之一${extra}。`
    })
    culprits.forEach(k => fixes.push({
      label: k === 'level' ? '级别' : k === 'source' ? '来源' : '关键词',
      key: k, type: k === 'keyword' ? 'warning' : 'danger'
    }))
    return { tips, fixes }
  }

  // 各项单独都无法命中，属于多方交叉冲突
  const active: string[] = []
  if (wantLevel) active.push('级别')
  if (wantSource) active.push('来源')
  if (wantKeyword) active.push(`关键词“${kw}”`)
  tips.push({
    label: '无交集', type: 'danger',
    text: `${active.join('、')} 的组合在全部日志中没有任何交集，无法通过放宽单项命中，建议重置全部条件后逐项设置。`
  })
  return { tips, fixes }
})

function clearOne(key: FixKey) {
  if (key === 'level') store.tableLevels = []
  else if (key === 'source') store.tableSources = []
  else store.tableKeyword = ''
}
</script>

<style scoped>
.panel{background:#1e293b;border-radius:8px;padding:12px;height:100%;border:1px solid #334155}
.panel h4{color:#38bdf8;font-size:13px;margin-bottom:8px}
.filter-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}
.result-meta{font-size:11px;color:#94a3b8;margin-bottom:6px;min-height:16px}
.result-meta b{color:#38bdf8}
.muted{color:#64748b}
.table-wrap{flex:1;overflow:auto}
.empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:20px 12px;color:#94a3b8;border:1px dashed #334155;border-radius:6px;overflow:auto}
.empty-icon{font-size:28px}
.empty-title{font-size:13px;color:#e2e8f0;font-weight:600}
.empty-guidance{font-size:12px;max-width:440px;width:100%}
.guidance-head{color:#fbbf24;margin-bottom:4px}
.empty-guidance ul{list-style:none;padding:0;margin:0 0 8px}
.empty-guidance li{display:flex;gap:6px;align-items:flex-start;margin:4px 0;line-height:20px}
.empty-guidance li .el-tag{flex-shrink:0;margin-top:1px}
.empty-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
</style>
