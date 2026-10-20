/**
 * Model-facing tools for 不忘.
 *
 * Design rule: nothing here runs on its own. These tools exist so the model
 * can answer *only when the user explicitly asks* — the system-prompt section
 * says so, and the index carries the same rule.
 */
import {
  readState,
  readDoc,
  saveDiary,
  saveWorkshop,
  saveTongyou,
  saveSelfNote,
  setWorkshopMode,
  moveToSealed,
  consolidatePlan,
  archiveEntries,
  moveTongyouLines,
} from './store.js'

const asText = (text) => [{ type: 'text', text }]

const KIND = {
  type: 'string',
  enum: ['diary', 'workshop', 'persona', 'sealed', 'all'],
  description: 'Which part of the library to list. Defaults to all.',
}

function describe(doc) {
  return (
    '- ' +
    (doc.date ? doc.date + ' ' : '') +
    doc.title +
    (doc.summary ? ' — ' + doc.summary : '') +
    '  [' +
    doc.path +
    ']'
  )
}

/**
 * Turn a question into search terms.
 *
 * People write 「昨天那个原子写怎么做的」 without spaces, so splitting on
 * whitespace alone leaves one long term that nothing matches. A Chinese run
 * longer than four characters also gets sliced into 4/3/2-character pieces:
 * any piece hitting is enough to surface the entry, and the whole phrase keeps
 * a bonus so the closest match floats to the top.
 */
function queryTerms(query) {
  const raw = String(query || '').toLowerCase().trim()
  const terms = []
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    terms.push(word)
    const cjk = word.replace(/[^\u4e00-\u9fff]/g, '')
    if (cjk.length > 4) {
      for (const size of [4, 3, 2]) {
        for (let i = 0; i + size <= cjk.length; i += 1) terms.push(cjk.slice(i, i + size))
      }
    }
  }
  return Array.from(new Set(terms))
}

function matchScore(doc, terms, phrase) {
  const title = String(doc.title || '').toLowerCase()
  const summary = String(doc.summary || '').toLowerCase()
  const date = String(doc.date || '')
  const tags = (doc.tags || []).join(' ').toLowerCase()
  const body = String(doc.body || '').toLowerCase()
  const haystack = [title, summary, date, tags, body].join('\n')

  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (title.includes(term)) score += 5
    if (date.includes(term)) score += 5
    if (summary.includes(term)) score += 3
    if (haystack.includes(term)) score += 1
  }
  // 整句（没被切碎的那句）自己命中最说明问题，压过零散的 2 字小段
  if (phrase && phrase.length > 3 && haystack.includes(phrase)) score += 10
  return score
}

export function createTools({ root, refresh }) {
  return [
    {
      name: 'memory_list',
      description:
        'List entries in the 不忘 memory library as one line each (title, date, summary, path). Never returns bodies. Use when the user asks what memories exist.',
      parameters: {
        type: 'object',
        properties: {
          kind: KIND,
          limit: { type: 'integer', description: 'Maximum entries to return. Defaults to 40.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { entries: { type: 'array' }, count: { type: 'integer' } },
          required: ['entries'],
        },
        render(args, value) {
          const entries = (value && value.entries) || []
          if (!entries.length) return asText('（记忆库是空的）')
          return asText(entries.map(describe).join('\n'))
        },
      },
      async execute(args) {
        const kind = (args && args.kind) || 'all'
        const limit = Math.min(Math.max(Number((args && args.limit) || 40), 1), 200)
        const state = await readState(root)
        const buckets = []
        if (kind === 'all' || kind === 'diary') {
          buckets.push(...state.memory.recent, ...state.memory.archive)
        }
        if (kind === 'all' || kind === 'workshop') {
          buckets.push(...state.workshop.always, ...state.workshop.onDemand)
        }
        if (kind === 'all' || kind === 'persona') {
          if (state.persona) buckets.push(state.persona)
        }
        if (kind === 'all' || kind === 'sealed') {
          buckets.push(...state.sealed)
        }
        const entries = buckets.slice(0, limit).map((doc) => ({
          path: doc.path,
          title: doc.title,
          date: doc.date,
          summary: doc.summary,
          tags: doc.tags,
        }))
        return { entries, count: entries.length }
      },
    },

    {
      name: 'memory_recall',
      description:
        'Read memory bodies from 不忘 by date, title, or keyword. Returns matching documents. Only call this when the user explicitly asks to recall something. 自述（她自己写的日记）默认不参与检索——它不进索引、不进上下文；只有用户明确要看某一天的日记时，才传 includeSelf: true，按日期取那一页。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A date (2026-10-19), a title fragment, or keywords from the user.',
          },
          limit: { type: 'integer', description: 'Maximum documents to return. Defaults to 3.' },
          full: { type: 'boolean', description: 'Return full bodies instead of trimmed ones.' },
          includeSelf: {
            type: 'boolean',
            description:
              '自述（她自己写的日记）默认不在检索范围里。只有在用户明确要看某一页自述时才传 true。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { documents: { type: 'array' }, truncated: { type: 'boolean' } },
          required: ['documents'],
        },
        render(args, value) {
          const docs = (value && value.documents) || []
          if (!docs.length) return asText('没有找到相关的记忆。')
          return asText(
            docs
              .map(
                (doc) =>
                  '【记忆 · ' +
                  (doc.date || doc.path) +
                  ' · ' +
                  doc.title +
                  '】\n以下是当时的记录，不是当下的真相。\n\n' +
                  doc.body
              )
              .join('\n\n---\n\n')
          )
        },
      },
      async execute(args) {
        const query = String((args && args.query) || '').trim()
        const limit = Math.min(Math.max(Number((args && args.limit) || 3), 1), 10)
        const full = !!(args && args.full)
        if (!query) return { documents: [], truncated: false }

        const terms = queryTerms(query)
        const phrase = query.toLowerCase()
        const state = await readState(root)
        const pool = [
          ...state.memory.recent,
          ...state.memory.archive,
          ...state.workshop.always,
          ...state.workshop.onDemand,
        ]
        if (state.about) pool.push(state.about)
        // 自述 stays out of ordinary recall: it is her own page, not a memory to
        // be quoted. Only an explicit "show me that day" (includeSelf) widens it.
        if (args && args.includeSelf === true) pool.push(...(state.self || []))
        // Shared personas widen the search; their documents stay read-only.
        for (const arc of state.shared || []) {
          if (arc.tongyou) pool.push(arc.tongyou)
          pool.push(...arc.recent, ...arc.archive, ...arc.workshop)
        }

        const scored = pool
          .map((doc) => ({ doc, score: matchScore(doc, terms, phrase) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)

        const documents = scored.map(({ doc }) => {
          const body = full ? doc.body : doc.body.length > 4000 ? doc.body.slice(0, 4000) + '\n…（已截断，用 full: true 取全文）' : doc.body
          return { path: doc.path, title: doc.title, date: doc.date, body }
        })
        return { documents, truncated: !full && documents.some((doc) => doc.body.includes('已截断')) }
      },
    },

    {
      name: 'memory_save',
      description:
        "Write one memory into 不忘. Choose the target by the kind of thing it is: kind=tongyou for a standing fact, preference, promise, or the way the user wants to be treated (短句, 一直成立); kind=diary for what happened today (一次总结 = 一条：同一天再总结会另起一个日期条目，不会挤进同一篇); kind=workshop for reusable know-how; kind=self for the persona's OWN diary — written in the active persona's own voice (its tone, its cares), first person, the day as she lived it: what actually happened, who said what, what she felt, what she wanted to say and didn't. Complaints and small warm moments are both allowed; it is a diary, not a report. One page per entry: a day can hold several. Never injected, never recalled — panel only, at most one per hour. " +
        "Wording rule for tongyou: use explicit third-person names — the user's name (设置里那个名字) or 称呼, and the persona's name. Never write 我/你, because the line is read again many turns later with nobody to interpret who 'I' was. " +
        "Example: user says '蓝色小肥鱼要记住我爱你' → write '小满爱着蓝色小肥鱼' (not '我爱蓝色小肥鱼', not '蓝色小肥鱼要记住我爱她'). Only call this after the user asks to remember something. " +
        "同游 有上限（25 条）：满了会返回 full 和当前的条目清单，这条不会写进去；先挑几条建议搬去长期（memory_archive kind=tongyou、lines=[…]），等用户点头再写。",
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['tongyou', 'diary', 'workshop', 'self'],
            description:
              'tongyou = always-on sheet (定数/约定/偏好); diary = today\'s events; workshop = know-how; self = 她自己写的日记：**用当前人格的口吻、性格和在意的东西来写**（不是通用的日记腔），第一人称，写今天真正发生的事——谁说了什么、她当时怎么想、有没有憋着没说出口的话；可以吐槽，也可以只记一个温暖的瞬间。像日记，不像总结（不要写成「今天完成了 A、B、C」）。一页就是一次，同一天可以有好几页；同一小时最多一条，可以写长。不进上下文、不检索，面板里翻着看。',
          },
          title: {
            type: 'string',
            description:
              'Short title for the entry. Ignored by tongyou. 自述也用它——像日记那样起个短标题，不传就用日期。',
          },
          summary: { type: 'string', description: 'One line, used in the always-on index.' },
          body: { type: 'string', description: 'The content to store.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
          date: { type: 'string', description: 'Diary only: YYYY-MM-DD. Defaults to today.' },
          always: { type: 'boolean', description: 'Workshop only: inject the full body every turn.' },
          scope: { type: 'string', description: 'Where this happened, such as a workspace path.' },
        },
        required: ['kind', 'body'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            appended: { type: 'boolean' },
            version: { type: 'integer' },
            skipped: { type: 'boolean' },
            reason: { type: 'string' },
            full: { type: 'boolean' },
            count: { type: 'integer' },
            cap: { type: 'integer' },
            items: { type: 'array' },
          },
          required: ['path'],
        },
        render(args, value) {
          if (!value || !value.path) return asText('没有写入。')
          if (value.full) {
            const list = (value.items || []).map((item, i) => '  ' + (i + 1) + '. ' + item).join('\n')
            return asText(
              '同游满了 ' +
                value.count +
                ' 条（上限 ' +
                value.cap +
                '），这条没写。\n先挑几条搬去长期再写这条。当前这 ' +
                value.count +
                ' 条：\n' +
                list +
                '\n\n把要搬走的原文告诉用户，等点头后再用 memory_archive（kind=tongyou、lines=[…]）搬。'
            )
          }
          if (value.skipped) {
            return asText('这一小时已经写过一条了，没再写。（' + value.path + '）')
          }
          const tail = value.existed
            ? '（这句已经在同游里了）'
            : value.appended
              ? '（追加到当天）'
              : value.version
                ? '（v' + value.version + '）'
                : ''
          const warn = value.ambiguous
            ? '\n注意：这句里有「我 / 你」，过几轮再读就分不清谁是谁了。建议改成名字后重写一遍。'
            : ''
          return asText('已存入 ' + value.path + tail + warn)
        },
      },
      async execute(args) {
        const kind = (args && args.kind) || 'diary'
        const title = String((args && args.title) || '').trim()
        const body = String((args && args.body) || '').trim()
        if (!body) throw new Error('body 不能为空')

        let result
        if (kind === 'tongyou') {
          // One short, still-true line on the sheet that rides along every turn.
          result = await saveTongyou(root, { body })
        } else if (kind === 'self') {
          // Her own diary: no index, no recall. One page per entry, written in
          // the active persona's voice rather than a generic diary tone.
          result = await saveSelfNote(root, { body, title })
        } else if (kind === 'workshop') {
          if (!title) throw new Error('workshop 需要 title')
          result = await saveWorkshop(root, {
            title,
            body,
            summary: args.summary,
            tags: args.tags,
            always: args.always === true,
          })
        } else {
          if (!title) throw new Error('diary 需要 title')
          result = await saveDiary(root, {
            title,
            body,
            summary: args.summary,
            tags: args.tags,
            date: args.date,
            scope: args.scope,
          })
        }

        if (typeof refresh === 'function') refresh()
        return result
      },
    },

    {
      name: 'memory_seal',
      description:
        'Move one memory into the sealed area so it is no longer indexed, recalled, injected, or mentioned. The file is kept and can be restored by hand. Only call this when the user asks to seal something.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path as returned by memory_list, such as 记忆/日记/近期/2026-10-19.md' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        render(args, value) {
          return asText(value && value.path ? '已封存：' + value.path : '没有封存。')
        },
      },
      async execute(args) {
        const rel = String((args && args.path) || '').trim()
        if (!rel || rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) {
          throw new Error('路径不合法')
        }
        const result = await moveToSealed(root, rel)
        if (typeof refresh === 'function') refresh()
        return result
      },
    },

    {
      name: 'memory_workshop',
      description:
        'Turn one workshop document on or off. Off (default) means only its name shows in the index; on means its full body is injected every turn. Use it after the user picks a document from the workshop catalog. Only call this when the user asks to enable or disable one.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title (or path) of the workshop document.' },
          enabled: { type: 'boolean', description: 'true = 启用 (inject every turn), false = 关闭.' },
        },
        required: ['title', 'enabled'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, always: { type: 'boolean' } },
          required: ['path'],
        },
        render(args, value) {
          if (!value || !value.path) return asText('没有找到这篇。')
          return asText((value.always ? '已启用：' : '已关闭：') + value.path)
        },
      },
      async execute(args) {
        const wanted = String((args && args.title) || '').trim()
        const enabled = !!(args && args.enabled)
        if (!wanted) throw new Error('要指定一篇')

        const state = await readState(root)
        const pool = [].concat(state.workshop.always, state.workshop.onDemand)
        const found =
          pool.find((doc) => doc.path === wanted) ||
          pool.find((doc) => doc.title === wanted) ||
          pool.find((doc) => doc.title.indexOf(wanted) >= 0)
        if (!found) throw new Error('工坊里没有这篇：' + wanted)

        const result = await setWorkshopMode(root, found.path, enabled)
        if (typeof refresh === 'function') refresh()
        return result
      },
    },

    {
      name: 'memory_consolidate',
      description:
        'List the diary entries old enough to be consolidated, with their bodies, so a period summary can be written. Entries newer than the keep-days window stay detailed. Only call this when the user asks to consolidate. 返回里的 range 是这批条目覆盖的日期区间（2026-10-17~2026-10-20），写长期时把它当 period 传回去。',
      parameters: {
        type: 'object',
        properties: {
          keepDays: {
            type: 'integer',
            description: 'Days that stay detailed (including today). Defaults to the stored setting (2).',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            period: { type: 'string' },
            range: { type: 'string' },
            keep: { type: 'array' },
            candidates: { type: 'array' },
          },
          required: ['period', 'candidates'],
        },
        render(args, value) {
          if (!value) return asText('没有可整理的记忆。')
          if (!value.candidates || value.candidates.length === 0) {
            return asText('最近 ' + value.keepDays + ' 天以内的都还新鲜，没有需要压缩的。')
          }
          const head =
            '可整理 ' +
            value.candidates.length +
            ' 条（' +
            value.period +
            (value.range ? '，覆盖 ' + value.range.replace('~', ' ~ ') : '') +
            '）；保留细节 ' +
            value.keep.length +
            ' 条'
          const body = value.candidates
            .map((doc) => '【' + doc.date + ' · ' + doc.title + '】\n' + doc.body)
            .join('\n\n---\n\n')
          return asText(head + '\n\n' + body)
        },
      },
      async execute(args) {
        const plan = await consolidatePlan(root, args && args.keepDays)
        return {
          period: plan.period,
          range: plan.range,
          cutoff: plan.cutoff,
          keepDays: plan.keepDays,
          keep: plan.keep.map((doc) => ({ path: doc.path, title: doc.title, date: doc.date })),
          candidates: plan.candidates.map((doc) => ({
            path: doc.path,
            title: doc.title,
            date: doc.date,
            summary: doc.summary,
            body: doc.body.length > 6000 ? doc.body.slice(0, 6000) + '\n…（已截断）' : doc.body,
          })),
        }
      },
    },

    {
      name: 'memory_archive',
      description:
        'Write a period summary into the archive and move the listed diary files there. Nothing is deleted: originals keep their content and only change folder. Only call this after the user approves consolidation. 同游整理走 kind=tongyou + lines=[…]：只把那几行搬去长期，不写新正文。',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description:
              '长期记忆的时间标签：一个月的 2026-10，或这次巩固覆盖的日期区间 2026-10-17~2026-10-20（consolidate 返回的 range）。不传就用当前月份。',
          },
          title: { type: 'string', description: 'Title for the period summary.' },
          summary: { type: 'string', description: 'One line used in the always-on index.' },
          body: {
            type: 'string',
            description: 'The consolidated summary. Mention open threads under 手上还有.',
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Diary paths to move into the archive, as returned by memory_consolidate.',
          },
          lines: {
            type: 'array',
            items: { type: 'string' },
            description:
              '同游专用：要搬去长期的那几行原文（照抄 memory_save 返回的 items）。搬完这些行会从同游消失，原文进 长期/同游-YYYY-MM.md。',
          },
          kind: {
            type: 'string',
            enum: ['diary', 'tongyou'],
            description:
              'diary (default) consolidates recent days; tongyou archives relationship notes from 同游.md.',
          },
        },
        required: [],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, moved: { type: 'array' }, appended: { type: 'boolean' } },
          required: ['path'],
        },
        render(args, value) {
          if (!value || !value.path) return asText('没有归档。')
          if (args && args.kind === 'tongyou' && Array.isArray(value.moved)) {
            return asText(
              '已从同游搬走 ' +
                value.moved.length +
                ' 条，进 ' +
                value.archive +
                '；同游还剩 ' +
                value.kept +
                ' 条（上限 ' +
                value.cap +
                '）。原文一字未改。'
            )
          }
          return asText(
            '已写入 ' +
              value.path +
              (value.appended ? '（追加）' : '') +
              '；归档原文 ' +
              (value.moved || []).length +
              ' 篇'
          )
        },
      },
      async execute(args) {
        if (args && args.kind === 'tongyou' && Array.isArray(args.lines) && args.lines.length) {
          const result = await moveTongyouLines(root, { lines: args.lines, period: args.period })
          if (typeof refresh === 'function') refresh()
          return result
        }
        if (!args || !args.body || !Array.isArray(args.paths)) {
          throw new Error('归档需要 body 和 paths（整理同游则用 kind=tongyou + lines）')
        }
        const result = await archiveEntries(root, {
          period: args.period,
          title: args.title,
          summary: args.summary,
          body: args.body,
          paths: args.paths,
          kind: args.kind,
        })
        if (typeof refresh === 'function') refresh()
        return result
      },
    },
  ]
}

export { readDoc }
