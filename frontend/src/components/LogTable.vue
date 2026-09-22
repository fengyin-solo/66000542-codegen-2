<template>
  <div class="panel">
    <h4>📋 日志流 ({{ store.result?.totalLogs || 0 }} 条)</h4>
    <div class="filters">
      <el-select v-model="store.selectedLevels" multiple collapse-tags collapse-tags-tooltip
                 placeholder="级别（可多选）" size="small" class="f-level">
        <el-option v-for="o in levelOptions" :key="o.value" :label="o.label" :value="o.value"/>
      </el-select>
      <el-select v-model="store.selectedSources" multiple collapse-tags collapse-tags-tooltip
                 placeholder="来源（可多选）" size="small" class="f-source">
        <el-option v-for="o in sourceOptions" :key="o.value" :label="o.label" :value="o.value"/>
      </el-select>
      <el-input v-model="store.messageKeyword" placeholder="检索消息关键词（空格分隔为 AND）"
                size="small" clearable class="f-kw"/>
      <el-radio-group v-model="store.sortBy" size="small">
        <el-radio-button value="time">按时间</el-radio-button>
        <el-radio-button value="level">按级别</el-radio-button>
      </el-radio-group>
      <el-button-group class="f-order">
        <el-button size="small" :type="store.sortOrder==='desc'?'primary':''"
                   @click="store.sortOrder='desc'">↓ 降序</el-button>
        <el-button size="small" :type="store.sortOrder==='asc'?'primary':''"
                   @click="store.sortOrder='asc'">↑ 升序</el-button>
      </el-button-group>
      <el-button size="small" text type="info" :disabled="!hasFilters" @click="store.resetFilters()">清空筛选</el-button>
      <span v-if="hasFilters" class="hit-count" :class="{zero: !displayLogs.length}">
        命中 {{ displayLogs.length }} 条
      </span>
    </div>
    <div class="table-wrap">
      <el-table :data="displayLogs" size="small" max-height="340" stripe>
        <el-table-column prop="id" label="#" width="50"/>
        <el-table-column prop="timestamp" label="时间" width="150"/>
        <el-table-column prop="level" label="级别" width="70">
          <template #default="{row}"><el-tag size="small" :type="levelTagType(row.level)">{{ row.level }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="120"/>
        <el-table-column prop="message" label="消息" show-overflow-tooltip/>
        <template #empty>
          <div class="empty-tip">
            <div class="empty-icon">{{ emptyInfo.icon }}</div>
            <div class="empty-text">{{ emptyInfo.text }}</div>
            <div v-if="emptyInfo.hint" class="empty-hint">👉 {{ emptyInfo.hint }}</div>
            <el-button v-if="hasFilters" size="small" style="margin-top:8px" @click="store.resetFilters()">
              清空全部筛选条件
            </el-button>
          </div>
        </template>
      </el-table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useLogStore } from '../store/log'
import type { LogEntry } from '../types'

const store = useLogStore()

const MONTHS: Record<string, string> = {
  Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06',
  Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12'
}

// 支持后端四种模拟日志格式：epoch 秒 / ISO / nginx / apache
function parseTimestamp(ts: string): number {
  if (!ts) return NaN
  const s = ts.trim()
  if (/^\d{10}$/.test(s)) return Number(s) * 1000
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s)
    return Number.isNaN(t) ? NaN : t
  }
  let m = s.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?$/)
  if (m) {
    const tz = m[7] ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : 'Z'
    return Date.parse(`${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${tz}`)
  }
  m = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/)
  if (m) return Date.parse(`${m[6]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}T${m[3]}:${m[4]}:${m[5]}Z`)
  const fallback = Date.parse(s)
  return Number.isNaN(fallback) ? NaN : fallback
}

// 级别严重度排序：ERROR > WARN > INFO/NOTICE > DEBUG（apache 小写级别也兼容）
function levelRank(level: string): number {
  switch (String(level).toUpperCase()) {
    case 'ERROR': return 0
    case 'WARN': case 'WARNING': return 1
    case 'INFO': case 'NOTICE': return 2
    case 'DEBUG': return 3
    default: return 4
  }
}

function levelTagType(level: string): 'danger' | 'warning' | 'info' {
  const lv = String(level).toUpperCase()
  if (lv === 'ERROR') return 'danger'
  if (lv === 'WARN' || lv === 'WARNING') return 'warning'
  return 'info'
}

const allLogs = computed<LogEntry[]>(() => store.result?.logs || [])

const levelOptions = computed(() =>
  [...new Set(allLogs.value.map(l => l.level))]
    .sort((a, b) => levelRank(a) - levelRank(b))
    .map(v => ({ value: v, label: v }))
)
const sourceOptions = computed(() =>
  [...new Set(allLogs.value.map(l => l.source))].sort().map(v => ({ value: v, label: v }))
)

const hasFilters = computed(() =>
  store.selectedLevels.length > 0 ||
  store.selectedSources.length > 0 ||
  store.messageKeyword.trim() !== ''
)

// 仅作用于表格展示，不改动 store.result —— 顶部条数与窗口聚合始终基于全部日志
const filteredLogs = computed<LogEntry[]>(() => {
  let rows = allLogs.value
  if (store.selectedLevels.length) {
    const wanted = new Set(store.selectedLevels.map(v => v.toUpperCase()))
    rows = rows.filter(l => wanted.has(l.level.toUpperCase()))
  }
  if (store.selectedSources.length) {
    const wanted = new Set(store.selectedSources)
    rows = rows.filter(l => wanted.has(l.source))
  }
  const terms = store.messageKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length) {
    rows = rows.filter(l => terms.every(t => l.message.toLowerCase().includes(t)))
  }
  return rows
})

const displayLogs = computed<LogEntry[]>(() => {
  const rows = filteredLogs.value.slice()
  const dir = store.sortOrder === 'asc' ? 1 : -1
  if (store.sortBy === 'level') {
    rows.sort((a, b) =>
      (levelRank(a.level) - levelRank(b.level)) * dir ||
      compareTime(a.timestamp, b.timestamp) * dir ||
      (a.id - b.id) * dir
    )
  } else {
    rows.sort((a, b) => compareTime(a.timestamp, b.timestamp) * dir || (a.id - b.id) * dir)
  }
  return rows
})

function compareTime(a: string, b: string): number {
  const ta = parseTimestamp(a)
  const tb = parseTimestamp(b)
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  return ta - tb
}

interface EmptyInfo { icon: string; text: string; hint?: string }

// 逐层施加条件，定位第一个导致结果为空的矛盾项并给出调整建议
const emptyInfo = computed<EmptyInfo>(() => {
  if (!store.result) return { icon: '📭', text: '尚未生成日志，请点击顶部「🔍 生成日志」按钮' }
  if (!allLogs.value.length) return { icon: '📭', text: '当前没有任何日志数据' }
  if (displayLogs.value.length) return { icon: '', text: '' }

  const availableLevels = [...new Set(allLogs.value.map(l => l.level))]
  const availableSources = [...new Set(allLogs.value.map(l => l.source))]
  const terms = store.messageKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean)

  let pool = allLogs.value

  if (store.selectedLevels.length) {
    const wanted = new Set(store.selectedLevels.map(v => v.toUpperCase()))
    const next = pool.filter(l => wanted.has(l.level.toUpperCase()))
    if (!next.length) {
      return {
        icon: '🏷️',
        text: `没有任何日志的级别为「${store.selectedLevels.join('、')}」`,
        hint: `本批日志仅含级别：${availableLevels.join('、')}，请调整「级别」筛选或清空该条件`
      }
    }
    pool = next
  }

  if (store.selectedSources.length) {
    const wanted = new Set(store.selectedSources)
    const next = pool.filter(l => wanted.has(l.source))
    if (!next.length) {
      const existsInAll = store.selectedSources.some(v => availableSources.includes(v))
      if (!existsInAll) {
        return {
          icon: '🔌',
          text: `没有任何日志的来源为「${store.selectedSources.join('、')}」`,
          hint: `本批日志仅含来源：${availableSources.join('、')}，请调整「来源」筛选或清空该条件`
        }
      }
      return {
        icon: '⛔',
        text: `级别「${store.selectedLevels.join('、')}」与来源「${store.selectedSources.join('、')}」在本批日志中没有交集`,
        hint: '两个条件互相矛盾，请放宽「级别」或「来源」其中一项'
      }
    }
    pool = next
  }

  if (terms.length) {
    const matched = pool.filter(l => terms.every(t => l.message.toLowerCase().includes(t)))
    if (!matched.length) {
      const anyTermMissing = terms.some(t => !pool.some(l => l.message.toLowerCase().includes(t)))
      const scoped = store.selectedLevels.length || store.selectedSources.length
      if (!scoped) {
        return {
          icon: '🔍',
          text: `没有消息包含关键词「${store.messageKeyword.trim()}」`,
          hint: anyTermMissing ? '请检查「关键词」拼写，或清空后换一个检索词' : '多个关键词需同时出现（AND），请减少关键词后重试'
        }
      }
      return {
        icon: '🔍',
        text: `在已选级别/来源范围内，没有消息包含关键词「${store.messageKeyword.trim()}」`,
        hint: '请调整「关键词」，或放宽上方的「级别」「来源」筛选'
      }
    }
  }

  return { icon: '📄', text: '没有符合当前条件的日志', hint: '请放宽筛选条件' }
})
</script>
<style scoped>
.panel{background:#1e293b;border-radius:8px;padding:12px;height:100%;border:1px solid #334155;display:flex;flex-direction:column}
.panel h4{color:#38bdf8;font-size:13px;margin-bottom:8px}
.filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
.f-level{width:130px}
.f-source{width:150px}
.f-kw{width:210px}
.f-order :deep(.el-button){margin-left:0}
.hit-count{font-size:11px;color:#94a3b8}
.hit-count.zero{color:#f87171;font-weight:600}
.table-wrap{flex:1;overflow:auto}
.empty-tip{padding:28px 12px;text-align:center;color:#94a3b8}
.empty-icon{font-size:28px;margin-bottom:8px}
.empty-text{font-size:13px;color:#cbd5e1}
.empty-hint{font-size:12px;color:#fbbf24;margin-top:6px}
</style>
