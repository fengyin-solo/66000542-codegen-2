/// <reference types="../../node_modules/.vue-global-types/vue_3.5_0_0_0.d.ts" />
import { computed } from 'vue';
import { useLogStore } from '../store/log';
const store = useLogStore();
const allLogs = computed(() => store.result?.logs ?? []);
const totalLogs = computed(() => store.result?.totalLogs ?? 0);
const hasActiveFilters = computed(() => store.tableLevels.length > 0 || store.tableSources.length > 0 || store.tableKeyword.trim() !== '');
// 可选项来自当前（全量）日志，便于发现哪些级别/来源真实存在；级别按严重程度排序
const levelOptions = computed(() => [...new Set(allLogs.value.map(l => l.level))]
    .sort((a, b) => severityOf(a) - severityOf(b) || a.localeCompare(b)));
const sourceOptions = computed(() => uniqSorted(allLogs.value.map(l => l.source)));
function uniqSorted(items) {
    return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}
const filteredLogs = computed(() => {
    const levels = new Set(store.tableLevels);
    const sources = new Set(store.tableSources);
    const kw = store.tableKeyword.trim().toLowerCase();
    const rows = allLogs.value.filter(l => (levels.size === 0 || levels.has(l.level)) &&
        (sources.size === 0 || sources.has(l.source)) &&
        (kw === '' || l.message.toLowerCase().includes(kw)));
    const dir = store.tableSortDesc ? -1 : 1;
    rows.sort((a, b) => {
        let cmp;
        if (store.tableSortBy === 'level') {
            cmp = severityOf(a.level) - severityOf(b.level);
            if (cmp === 0)
                cmp = String(a.level).localeCompare(String(b.level));
        }
        else {
            cmp = parseTime(a.timestamp) - parseTime(b.timestamp);
        }
        return cmp !== 0 ? cmp * dir : (a.id - b.id) * dir;
    });
    return rows;
});
const SEVERITY = {
    debug: 0, DEBUG: 0,
    info: 1, INFO: 1, notice: 1,
    warn: 2, WARN: 2, warning: 2,
    error: 3, ERROR: 3, err: 3
};
function severityOf(level) {
    if (level in SEVERITY)
        return SEVERITY[level];
    return SEVERITY[level.toLowerCase()] ?? 1;
}
const MONTHS = {};
'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ').forEach((m, i) => { MONTHS[m] = i; });
// 后端四种模板的时间格式互不相同，统一解析成可比较的毫秒值
function parseTime(ts) {
    if (!ts)
        return 0;
    if (/^\d+$/.test(ts))
        return Number(ts) * 1000; // custom: epoch 秒
    let m = ts.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/); // nginx
    if (m)
        return Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]);
    m = ts.match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})/); // apache
    if (m)
        return Date.UTC(+m[6], MONTHS[m[1]] ?? 0, +m[2], +m[3], +m[4], +m[5]);
    const parsed = Date.parse(ts); // json_app: ISO8601
    return Number.isNaN(parsed) ? 0 : parsed;
}
function levelTagType(level) {
    const lv = level.toLowerCase();
    if (lv === 'error' || lv === 'err')
        return 'danger';
    if (lv === 'warn' || lv === 'warning')
        return 'warning';
    if (lv === 'debug')
        return 'info';
    return 'success'; // info / notice
}
const diagnosis = computed(() => {
    if (!totalLogs || filteredLogs.value.length)
        return null;
    const tips = [];
    const fixes = [];
    const kw = store.tableKeyword.trim();
    const wantLevel = store.tableLevels.length > 0;
    const wantSource = store.tableSources.length > 0;
    const wantKeyword = kw !== '';
    // 先判断“选择值在数据里根本不存在”的情况
    if (wantLevel) {
        const available = new Set(levelOptions.value);
        const missing = store.tableLevels.filter(l => !available.has(l));
        if (missing.length) {
            tips.push({
                label: '级别', type: 'danger',
                text: `所选级别 ${missing.join('、')} 在当前日志中不存在，现有级别为 ${levelOptions.value.join('、') || '（无）'}，请改选或清空级别。`
            });
            fixes.push({ label: '级别', key: 'level', type: 'danger' });
        }
    }
    if (wantSource) {
        const available = new Set(sourceOptions.value);
        const missing = store.tableSources.filter(s => !available.has(s));
        if (missing.length) {
            tips.push({
                label: '来源', type: 'danger',
                text: `所选来源 ${missing.join('、')} 在当前日志中不存在，现有来源为 ${sourceOptions.value.join('、') || '（无）'}，请改选或清空来源。`
            });
            fixes.push({ label: '来源', key: 'source', type: 'danger' });
        }
    }
    if (tips.length)
        return { tips, fixes };
    // 选择值都存在，判断是哪一项把结果清零（去掉它即可命中）
    const kwLc = kw.toLowerCase();
    const matchLevel = (l) => !wantLevel || store.tableLevels.includes(l.level);
    const matchSource = (l) => !wantSource || store.tableSources.includes(l.source);
    const matchKeyword = (l) => !wantKeyword || l.message.toLowerCase().includes(kwLc);
    const culprits = [];
    if (wantLevel && allLogs.value.some(l => matchSource(l) && matchKeyword(l)))
        culprits.push('level');
    if (wantSource && allLogs.value.some(l => matchLevel(l) && matchKeyword(l)))
        culprits.push('source');
    if (wantKeyword && allLogs.value.some(l => matchLevel(l) && matchSource(l)))
        culprits.push('keyword');
    if (culprits.length === 1) {
        const key = culprits[0];
        if (key === 'keyword') {
            tips.push({ label: '关键词', type: 'warning', text: `消息中没有包含 “${kw}” 的日志（级别/来源条件本身有数据），请更换或放宽关键词。` });
        }
        else if (key === 'level') {
            tips.push({ label: '级别', type: 'warning', text: '当前级别与来源/关键词的交集为空：去掉级别限制后即可看到日志，请放宽级别选择。' });
        }
        else {
            tips.push({ label: '来源', type: 'warning', text: '当前来源与级别/关键词的交集为空：去掉来源限制后即可看到日志，请放宽来源选择。' });
        }
        fixes.push({ label: key === 'level' ? '级别' : key === 'source' ? '来源' : '关键词', key, type: 'warning' });
        return { tips, fixes };
    }
    if (culprits.length > 1) {
        const names = culprits.map(k => k === 'level' ? '级别' : k === 'source' ? '来源' : '关键词');
        tips.push({
            label: '条件冲突', type: 'danger',
            text: `${names.join('与')}互相矛盾：单独放宽其中任一项都能命中，请调整或清除其中之一（关键词为 “${kw || '（空）'}”）。`
        });
        culprits.forEach(k => fixes.push({
            label: k === 'level' ? '级别' : k === 'source' ? '来源' : '关键词',
            key: k, type: k === 'keyword' ? 'warning' : 'danger'
        }));
        return { tips, fixes };
    }
    // 各项单独都无法命中，属于多方交叉冲突
    const active = [];
    if (wantLevel)
        active.push('级别');
    if (wantSource)
        active.push('来源');
    if (wantKeyword)
        active.push(`关键词“${kw}”`);
    tips.push({
        label: '无交集', type: 'danger',
        text: `${active.join('、')} 的组合在全部日志中没有任何交集，无法通过放宽单项命中，建议重置全部条件后逐项设置。`
    });
    return { tips, fixes };
});
function clearOne(key) {
    if (key === 'level')
        store.tableLevels = [];
    else if (key === 'source')
        store.tableSources = [];
    else
        store.tableKeyword = '';
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['result-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-guidance']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-guidance']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-guidance']} */ ;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "panel" },
    ...{ style: {} },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h4, __VLS_intrinsicElements.h4)({});
(__VLS_ctx.totalLogs);
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "filter-bar" },
});
const __VLS_0 = {}.ElSelect;
/** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    modelValue: (__VLS_ctx.store.tableLevels),
    multiple: true,
    collapseTags: true,
    collapseTagsTooltip: true,
    placeholder: "级别（全部）",
    size: "small",
    ...{ style: {} },
}));
const __VLS_2 = __VLS_1({
    modelValue: (__VLS_ctx.store.tableLevels),
    multiple: true,
    collapseTags: true,
    collapseTagsTooltip: true,
    placeholder: "级别（全部）",
    size: "small",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
__VLS_3.slots.default;
for (const [l] of __VLS_getVForSourceType((__VLS_ctx.levelOptions))) {
    const __VLS_4 = {}.ElOption;
    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
    // @ts-ignore
    const __VLS_5 = __VLS_asFunctionalComponent(__VLS_4, new __VLS_4({
        key: (l),
        label: (l),
        value: (l),
    }));
    const __VLS_6 = __VLS_5({
        key: (l),
        label: (l),
        value: (l),
    }, ...__VLS_functionalComponentArgsRest(__VLS_5));
}
var __VLS_3;
const __VLS_8 = {}.ElSelect;
/** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    modelValue: (__VLS_ctx.store.tableSources),
    multiple: true,
    collapseTags: true,
    collapseTagsTooltip: true,
    placeholder: "来源（全部）",
    size: "small",
    ...{ style: {} },
}));
const __VLS_10 = __VLS_9({
    modelValue: (__VLS_ctx.store.tableSources),
    multiple: true,
    collapseTags: true,
    collapseTagsTooltip: true,
    placeholder: "来源（全部）",
    size: "small",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
__VLS_11.slots.default;
for (const [s] of __VLS_getVForSourceType((__VLS_ctx.sourceOptions))) {
    const __VLS_12 = {}.ElOption;
    /** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
    // @ts-ignore
    const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
        key: (s),
        label: (s),
        value: (s),
    }));
    const __VLS_14 = __VLS_13({
        key: (s),
        label: (s),
        value: (s),
    }, ...__VLS_functionalComponentArgsRest(__VLS_13));
}
var __VLS_11;
const __VLS_16 = {}.ElInput;
/** @type {[typeof __VLS_components.ElInput, typeof __VLS_components.elInput, ]} */ ;
// @ts-ignore
const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
    modelValue: (__VLS_ctx.store.tableKeyword),
    placeholder: "检索消息关键词...",
    size: "small",
    ...{ style: {} },
    clearable: true,
}));
const __VLS_18 = __VLS_17({
    modelValue: (__VLS_ctx.store.tableKeyword),
    placeholder: "检索消息关键词...",
    size: "small",
    ...{ style: {} },
    clearable: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_17));
const __VLS_20 = {}.ElSelect;
/** @type {[typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, typeof __VLS_components.ElSelect, typeof __VLS_components.elSelect, ]} */ ;
// @ts-ignore
const __VLS_21 = __VLS_asFunctionalComponent(__VLS_20, new __VLS_20({
    modelValue: (__VLS_ctx.store.tableSortBy),
    size: "small",
    ...{ style: {} },
}));
const __VLS_22 = __VLS_21({
    modelValue: (__VLS_ctx.store.tableSortBy),
    size: "small",
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_21));
__VLS_23.slots.default;
const __VLS_24 = {}.ElOption;
/** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
// @ts-ignore
const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({
    label: "按时间",
    value: "time",
}));
const __VLS_26 = __VLS_25({
    label: "按时间",
    value: "time",
}, ...__VLS_functionalComponentArgsRest(__VLS_25));
const __VLS_28 = {}.ElOption;
/** @type {[typeof __VLS_components.ElOption, typeof __VLS_components.elOption, ]} */ ;
// @ts-ignore
const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
    label: "按级别",
    value: "level",
}));
const __VLS_30 = __VLS_29({
    label: "按级别",
    value: "level",
}, ...__VLS_functionalComponentArgsRest(__VLS_29));
var __VLS_23;
const __VLS_32 = {}.ElTooltip;
/** @type {[typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, typeof __VLS_components.ElTooltip, typeof __VLS_components.elTooltip, ]} */ ;
// @ts-ignore
const __VLS_33 = __VLS_asFunctionalComponent(__VLS_32, new __VLS_32({
    content: (__VLS_ctx.store.tableSortDesc ? '当前降序，点击切为升序' : '当前升序，点击切为降序'),
    placement: "top",
}));
const __VLS_34 = __VLS_33({
    content: (__VLS_ctx.store.tableSortDesc ? '当前降序，点击切为升序' : '当前升序，点击切为降序'),
    placement: "top",
}, ...__VLS_functionalComponentArgsRest(__VLS_33));
__VLS_35.slots.default;
const __VLS_36 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
    ...{ 'onClick': {} },
    size: "small",
}));
const __VLS_38 = __VLS_37({
    ...{ 'onClick': {} },
    size: "small",
}, ...__VLS_functionalComponentArgsRest(__VLS_37));
let __VLS_40;
let __VLS_41;
let __VLS_42;
const __VLS_43 = {
    onClick: (...[$event]) => {
        __VLS_ctx.store.tableSortDesc = !__VLS_ctx.store.tableSortDesc;
    }
};
__VLS_39.slots.default;
(__VLS_ctx.store.tableSortDesc ? '↓ 降序' : '↑ 升序');
var __VLS_39;
var __VLS_35;
const __VLS_44 = {}.ElButton;
/** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
// @ts-ignore
const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
    ...{ 'onClick': {} },
    size: "small",
    disabled: (!__VLS_ctx.hasActiveFilters),
}));
const __VLS_46 = __VLS_45({
    ...{ 'onClick': {} },
    size: "small",
    disabled: (!__VLS_ctx.hasActiveFilters),
}, ...__VLS_functionalComponentArgsRest(__VLS_45));
let __VLS_48;
let __VLS_49;
let __VLS_50;
const __VLS_51 = {
    onClick: (...[$event]) => {
        __VLS_ctx.store.resetTableFilters();
    }
};
__VLS_47.slots.default;
var __VLS_47;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "result-meta" },
});
if (__VLS_ctx.filteredLogs.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.b, __VLS_intrinsicElements.b)({});
    (__VLS_ctx.filteredLogs.length);
    (__VLS_ctx.totalLogs);
    if (__VLS_ctx.hasActiveFilters) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
            ...{ class: "muted" },
        });
        (__VLS_ctx.totalLogs);
    }
}
else if (__VLS_ctx.totalLogs) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "muted" },
    });
    (__VLS_ctx.totalLogs);
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({
        ...{ class: "muted" },
    });
}
if (__VLS_ctx.totalLogs && !__VLS_ctx.filteredLogs.length) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-state" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-icon" },
    });
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "empty-title" },
    });
    if (__VLS_ctx.diagnosis) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-guidance" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "guidance-head" },
        });
        __VLS_asFunctionalElement(__VLS_intrinsicElements.ul, __VLS_intrinsicElements.ul)({});
        for (const [d, i] of __VLS_getVForSourceType((__VLS_ctx.diagnosis.tips))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.li, __VLS_intrinsicElements.li)({
                key: (i),
            });
            const __VLS_52 = {}.ElTag;
            /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
            // @ts-ignore
            const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({
                size: "small",
                type: (d.type),
                effect: "dark",
            }));
            const __VLS_54 = __VLS_53({
                size: "small",
                type: (d.type),
                effect: "dark",
            }, ...__VLS_functionalComponentArgsRest(__VLS_53));
            __VLS_55.slots.default;
            (d.label);
            var __VLS_55;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.span, __VLS_intrinsicElements.span)({});
            (d.text);
        }
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-actions" },
        });
        for (const [f] of __VLS_getVForSourceType((__VLS_ctx.diagnosis.fixes))) {
            const __VLS_56 = {}.ElButton;
            /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
            // @ts-ignore
            const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
                ...{ 'onClick': {} },
                key: (f.label),
                size: "small",
                type: (f.type),
            }));
            const __VLS_58 = __VLS_57({
                ...{ 'onClick': {} },
                key: (f.label),
                size: "small",
                type: (f.type),
            }, ...__VLS_functionalComponentArgsRest(__VLS_57));
            let __VLS_60;
            let __VLS_61;
            let __VLS_62;
            const __VLS_63 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.totalLogs && !__VLS_ctx.filteredLogs.length))
                        return;
                    if (!(__VLS_ctx.diagnosis))
                        return;
                    __VLS_ctx.clearOne(f.key);
                }
            };
            __VLS_59.slots.default;
            (f.label);
            var __VLS_59;
        }
        const __VLS_64 = {}.ElButton;
        /** @type {[typeof __VLS_components.ElButton, typeof __VLS_components.elButton, typeof __VLS_components.ElButton, typeof __VLS_components.elButton, ]} */ ;
        // @ts-ignore
        const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_66 = __VLS_65({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_65));
        let __VLS_68;
        let __VLS_69;
        let __VLS_70;
        const __VLS_71 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.totalLogs && !__VLS_ctx.filteredLogs.length))
                    return;
                if (!(__VLS_ctx.diagnosis))
                    return;
                __VLS_ctx.store.resetTableFilters();
            }
        };
        __VLS_67.slots.default;
        var __VLS_67;
    }
    else {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "empty-guidance" },
        });
    }
}
else {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "table-wrap" },
    });
    const __VLS_72 = {}.ElTable;
    /** @type {[typeof __VLS_components.ElTable, typeof __VLS_components.elTable, typeof __VLS_components.ElTable, typeof __VLS_components.elTable, ]} */ ;
    // @ts-ignore
    const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
        data: (__VLS_ctx.filteredLogs),
        size: "small",
        maxHeight: "400",
        stripe: true,
    }));
    const __VLS_74 = __VLS_73({
        data: (__VLS_ctx.filteredLogs),
        size: "small",
        maxHeight: "400",
        stripe: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_73));
    __VLS_75.slots.default;
    const __VLS_76 = {}.ElTableColumn;
    /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
    // @ts-ignore
    const __VLS_77 = __VLS_asFunctionalComponent(__VLS_76, new __VLS_76({
        prop: "id",
        label: "#",
        width: "50",
    }));
    const __VLS_78 = __VLS_77({
        prop: "id",
        label: "#",
        width: "50",
    }, ...__VLS_functionalComponentArgsRest(__VLS_77));
    const __VLS_80 = {}.ElTableColumn;
    /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
    // @ts-ignore
    const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
        prop: "timestamp",
        label: "时间",
        width: "150",
    }));
    const __VLS_82 = __VLS_81({
        prop: "timestamp",
        label: "时间",
        width: "150",
    }, ...__VLS_functionalComponentArgsRest(__VLS_81));
    const __VLS_84 = {}.ElTableColumn;
    /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
    // @ts-ignore
    const __VLS_85 = __VLS_asFunctionalComponent(__VLS_84, new __VLS_84({
        prop: "level",
        label: "级别",
        width: "80",
    }));
    const __VLS_86 = __VLS_85({
        prop: "level",
        label: "级别",
        width: "80",
    }, ...__VLS_functionalComponentArgsRest(__VLS_85));
    __VLS_87.slots.default;
    {
        const { default: __VLS_thisSlot } = __VLS_87.slots;
        const [{ row }] = __VLS_getSlotParams(__VLS_thisSlot);
        const __VLS_88 = {}.ElTag;
        /** @type {[typeof __VLS_components.ElTag, typeof __VLS_components.elTag, typeof __VLS_components.ElTag, typeof __VLS_components.elTag, ]} */ ;
        // @ts-ignore
        const __VLS_89 = __VLS_asFunctionalComponent(__VLS_88, new __VLS_88({
            size: "small",
            type: (__VLS_ctx.levelTagType(row.level)),
        }));
        const __VLS_90 = __VLS_89({
            size: "small",
            type: (__VLS_ctx.levelTagType(row.level)),
        }, ...__VLS_functionalComponentArgsRest(__VLS_89));
        __VLS_91.slots.default;
        (row.level);
        var __VLS_91;
    }
    var __VLS_87;
    const __VLS_92 = {}.ElTableColumn;
    /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
    // @ts-ignore
    const __VLS_93 = __VLS_asFunctionalComponent(__VLS_92, new __VLS_92({
        prop: "source",
        label: "来源",
        width: "120",
    }));
    const __VLS_94 = __VLS_93({
        prop: "source",
        label: "来源",
        width: "120",
    }, ...__VLS_functionalComponentArgsRest(__VLS_93));
    const __VLS_96 = {}.ElTableColumn;
    /** @type {[typeof __VLS_components.ElTableColumn, typeof __VLS_components.elTableColumn, ]} */ ;
    // @ts-ignore
    const __VLS_97 = __VLS_asFunctionalComponent(__VLS_96, new __VLS_96({
        prop: "message",
        label: "消息",
        showOverflowTooltip: true,
    }));
    const __VLS_98 = __VLS_97({
        prop: "message",
        label: "消息",
        showOverflowTooltip: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_97));
    var __VLS_75;
}
/** @type {__VLS_StyleScopedClasses['panel']} */ ;
/** @type {__VLS_StyleScopedClasses['filter-bar']} */ ;
/** @type {__VLS_StyleScopedClasses['result-meta']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['muted']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-state']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-icon']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-title']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-guidance']} */ ;
/** @type {__VLS_StyleScopedClasses['guidance-head']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-actions']} */ ;
/** @type {__VLS_StyleScopedClasses['empty-guidance']} */ ;
/** @type {__VLS_StyleScopedClasses['table-wrap']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            store: store,
            totalLogs: totalLogs,
            hasActiveFilters: hasActiveFilters,
            levelOptions: levelOptions,
            sourceOptions: sourceOptions,
            filteredLogs: filteredLogs,
            levelTagType: levelTagType,
            diagnosis: diagnosis,
            clearOne: clearOne,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
