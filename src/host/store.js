/**
 * Storage adapter for 不忘.
 *
 * Everything that touches the filesystem, the data directory layout, and the
 * document format lives here. A DSH upgrade or a format change should only
 * need to touch this file — the rest of the plugin talks to `readState`,
 * `writeSettings`, and friends.
 *
 * Layout (format 2). Every section is scoped by persona, so one persona's
 * memories never leak into another's:
 *
 *   设置.json                       settings, including activePersona
 *   人格/<persona>.md               one persona per file, only one active
 *   记忆/<persona>/同游.md          always-on: what happened between us
 *   记忆/<persona>/近期/YYYY-MM-DD.md   short-term: one file per day
 *   记忆/<persona>/长期/YYYY-MM.md      long-term: consolidated months
 *   记忆/<persona>/长期/同游-YYYY-MM.md archived relationship notes
 *   工坊/<persona>/常驻|按需/*.md    workshop docs
 *   封存/<persona>/*.md              sealed
 *
 * Data on disk is the source of truth. Nothing here writes into a session.
 */
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

/** Bump when the on-disk shape changes incompatibly. */
export const FORMAT = 2

export const BUDGET_TOKENS = { small: 800, normal: 2000, large: 4000 }

const BASE_DIRS = ['人格', '记忆', '工坊', '封存', '自述']

const DEFAULTS = {
  format: FORMAT,
  name: '我',
  budget: 'normal',
  recentLimit: 40,
  consolidateDays: 30,
  // 索引里露脸的天数：窗口外的短期只留一行「还有 N 条更早的」。
  recentDays: 3,
  // 巩固时一个字都不动的天数：今天 + 昨天。
  keepDays: 2,
  activePersona: '',
}

const DEFAULT_PERSONA = '默认'

const PERSONA_TEMPLATE = [
  '# 默认人格',
  '',
  '<!-- 在这里写：你是谁、怎么说话、什么底线。这段每轮都在。 -->',
  '',
].join('\n')

const TONGYOU_TEMPLATE = [
  '# 同游',
  '',
  '<!-- 一行一条，写清楚是谁对谁：用名字，别用「我 / 你」。这段每轮都在。 -->',
  '',
].join('\n')

/* ------------------------------------------------------------------ */
/* Paths                                                               */
/* ------------------------------------------------------------------ */

/**
 * Where the library lives.
 *
 * The pointer has to live outside the library — storing "which folder am I
 * using" inside that same folder is the chicken and the egg. It sits in the
 * user's home, and tests point BUWANG_POINTER somewhere temporary.
 *
 * Order, highest first: plugin config, then the pointer the panel writes, then
 * BUWANG_HOME, then the default. The panel wins over the environment variable
 * so that what the user picked in the UI is what actually gets used.
 */
export function rootPointerPath() {
  const override = process.env.BUWANG_POINTER
  if (typeof override === 'string' && override.trim()) return path.resolve(override)
  return path.join(os.homedir(), '.buwang', 'root.txt')
}

export function readRootPointer() {
  try {
    const raw = readFileSync(rootPointerPath(), 'utf8').trim()
    return raw ? path.resolve(raw) : ''
  } catch {
    return ''
  }
}

async function writeRootPointer(target) {
  const file = rootPointerPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeTextAtomic(file, target + '\n', 'utf8')
}

/** Forget the pointer so the default (or BUWANG_HOME) applies again. */
export async function resetRootPointer() {
  try {
    await fs.unlink(rootPointerPath())
  } catch {
    // already gone
  }
  return { root: resolveDataDir('') }
}

export function resolveDataDir(configured) {
  if (typeof configured === 'string' && configured.trim()) return path.resolve(configured)
  const pointer = readRootPointer()
  if (pointer) return pointer
  const env = process.env.BUWANG_HOME
  if (typeof env === 'string' && env.trim()) return path.resolve(env)
  return path.join(os.homedir(), 'Documents', 'buwang')
}

function humanSize(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

async function countTree(dir) {
  let files = 0
  let bytes = 0
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return { files, bytes }
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await countTree(abs)
      files += inner.files
      bytes += inner.bytes
      continue
    }
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat) continue
    files += 1
    bytes += stat.size
  }
  return { files, bytes }
}

/**
 * Copy the whole library into a sibling folder, never into itself.
 *
 * A backup is the one thing a memory tool must not get creative about: plain
 * copy, folder next to the original, name carrying the moment it was taken.
 * Nothing is deleted, nothing is overwritten — a second backup in the same
 * minute simply gets a "-2".
 */
export async function backupLibrary(root) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes())

  const parent = path.dirname(path.resolve(root))
  const base = path.basename(path.resolve(root)) + '-备份-' + stamp
  let dest = path.join(parent, base)
  let seq = 2
  while (await exists(dest)) {
    dest = path.join(parent, base + '-' + seq)
    seq += 1
  }

  await fs.cp(root, dest, { recursive: true })
  const { files, bytes } = await countTree(dest)
  return { path: dest, files, bytes, human: humanSize(bytes) }
}

/**
 * Repoint the library at another folder, optionally carrying everything along.
 *
 * Moving copies and never deletes: a half-finished move must not be the moment
 * someone loses every diary they have. The pointer flips only after the copy
 * returns, so a failure leaves the old folder still in use.
 */
export async function setDataRoot(currentRoot, target, options) {  const want = String(target == null ? '' : target).trim()
  if (!want) throw new Error('路径不能为空')

  const from = path.resolve(currentRoot)
  const next = path.resolve(want)
  const move = !!(options && options.move)

  // A path decoded with the wrong encoding arrives full of U+FFFD. It has to
  // stop here: mkdir would cheerfully create a folder with a garbage name.
  if (next.indexOf('\uFFFD') >= 0) {
    throw new Error('路径里有无法识别的字符（编码坏了），请重新选一个文件夹')
  }

  if (next === from) throw new Error('已经就是这个目录了')
  if (next.startsWith(from + path.sep)) throw new Error('新目录不能放在旧目录里面')
  if (from.startsWith(next + path.sep)) throw new Error('旧目录在新目录里面，换个位置')

  const targetExists = await exists(next)
  if (targetExists) {
    const stat = await fs.stat(next).catch(() => null)
    if (!stat || !stat.isDirectory()) throw new Error('目标不是文件夹：' + next)
  }

  if (move) {
    if (targetExists) {
      const inner = await fs.readdir(next).catch(() => [])
      if (inner.length > 0) throw new Error('目标目录不是空的，请选一个空文件夹')
    }
    await fs.mkdir(next, { recursive: true })
    await fs.cp(from, next, { recursive: true })
  } else {
    await fs.mkdir(next, { recursive: true })
    const inner = await fs.readdir(next).catch(() => [])
    if (inner.length > 0) {
      const isLibrary =
        (await exists(path.join(next, '设置.json'))) || (await exists(path.join(next, '人格')))
      if (!isLibrary) throw new Error('这个文件夹里已经有别的东西了，请选空的或个人记忆库')
    }
  }

  await writeRootPointer(next)
  return {
    root: next,
    from,
    moved: move,
    files: move ? await countMarkdown(next) : 0,
    // The running plugin resolved its root at load time.
    needsReload: true,
  }
}

const settingsPath = (root) => path.join(root, '设置.json')
const personaRel = (key) => '人格/' + key + '.md'
const memoryRoot = (key) => '记忆/' + key
const tongyouRel = (key) => memoryRoot(key) + '/同游.md'
const recentRel = (key) => memoryRoot(key) + '/近期'
const longRel = (key) => memoryRoot(key) + '/长期'
const workshopRel = (key, always) => '工坊/' + key + '/' + (always ? '常驻' : '按需')
const sealedRel = (key) => '封存/' + key
// 自述 is the assistant's own diary. It is shown in the panel and nowhere else:
// never indexed, never injected, never returned by recall.
const selfRel = (key) => '自述/' + key

function personaDirs(key) {
  return [
    memoryRoot(key),
    recentRel(key),
    longRel(key),
    '工坊/' + key,
    workshopRel(key, true),
    workshopRel(key, false),
    // 封存/<key> is NOT pre-created: an empty folder would squat on the name and
    // force a sealed persona box to be renamed with a date suffix. It is made on
    // demand by moveToSealed instead.
  ]
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

export async function ensureData(root) {
  const report = { created: false, migrated: [] }

  for (const dir of BASE_DIRS) {
    const target = path.join(root, dir)
    if (!(await exists(target))) {
      await fs.mkdir(target, { recursive: true })
      report.created = true
    }
  }

  // Settings first: migration needs the stored format and writes it back.
  let settings = await readSettings(root)
  if (!(await exists(settingsPath(root)))) {
    await writeTextAtomic(settingsPath(root), JSON.stringify(DEFAULTS, null, 2), 'utf8')
    report.created = true
  }

  const migrated = await migrateLegacy(root, settings)
  if (migrated) {
    report.migrated = migrated.migrated
    settings = migrated.settings
  }

  await pruneLegacyDirs(root)
  await pruneEmptySealedDirs(root)
  report.tidied = await tidyOrphanArchives(root)

  await ensurePersonaSubtree(root, settings)

  // A brand-new library still needs one persona and one 同游 file to open.
  const personas = await readDirDocuments(root, '人格')
  if (personas.length === 0) {
    await writeTextAtomic(path.join(root, '人格', DEFAULT_PERSONA + '.md'), PERSONA_TEMPLATE, 'utf8')
    settings = await writeSettings(root, { activePersona: DEFAULT_PERSONA })
    await ensurePersonaSubtree(root, settings)
    report.created = true
  }

  const active = await resolveActivePersona(root, settings)
  if (active) {
    const tongyou = path.join(root, tongyouRel(active.key))
    if (!(await exists(tongyou))) {
      await writeTextAtomic(
        tongyou,
        frontMatter({ title: '同游' }) + TONGYOU_TEMPLATE,
        'utf8'
      )
    }
  }

  return { root, ...report }
}

/** Create the per-persona folders for whichever persona is active. */
async function ensurePersonaSubtree(root, settings) {
  const active = await resolveActivePersona(root, settings)
  if (!active) return null
  for (const dir of personaDirs(active.key)) {
    const target = path.join(root, dir)
    if (!(await exists(target))) await fs.mkdir(target, { recursive: true })
  }
  await ensureTongyou(root, active.key)
  return active
}

/** Every persona owns one 同游 file; it is created the first time it is needed. */
async function ensureTongyou(root, key) {
  const abs = path.join(root, tongyouRel(key))
  if (await exists(abs)) return
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await writeTextAtomic(
    abs,
    frontMatter({ title: '同游' }) + TONGYOU_TEMPLATE,
    'utf8'
  )
}

/* ------------------------------------------------------------------ */
/* Migration from format 1                                             */
/* ------------------------------------------------------------------ */

const LEGACY_DIRS = [
  '人格/模式',
  '记忆/日记',
  '记忆/日记/近期',
  '记忆/日记/归档',
  '工坊/常驻',
  '工坊/按需',
  '封存',
]

/**
 * Format 1 kept one global set of documents. Format 2 scopes everything by
 * persona, so every legacy document moves into the folder of the persona it
 * belonged to. Nothing is rewritten except the 关于我 → 同游 rename; every
 * other file keeps its bytes and only changes folder.
 */
async function migrateLegacy(root, settings) {
  if ((Number(settings.format) || 0) >= FORMAT) return null

  const moved = []
  const moveTo = async (fromRel, toRel) => {
    const from = path.join(root, fromRel)
    if (!(await exists(from))) return false
    const to = path.join(root, toRel)
    if (await exists(to)) return false
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.rename(from, to)
    moved.push(fromRel + ' → ' + toRel)
    return true
  }

  // 1. The core persona decides the persona key for everything else.
  let key = DEFAULT_PERSONA
  let title = DEFAULT_PERSONA
  const legacyCore = '人格/核心.md'
  if (await exists(path.join(root, legacyCore))) {
    const doc = parseDocument(legacyCore, await fs.readFile(path.join(root, legacyCore), 'utf8'))
    title = doc.title || DEFAULT_PERSONA
    key = slugify(title)
    await moveTo(legacyCore, personaRel(key))
    // Keep the front-matter title equal to the persona name.
    await rewriteTitle(root, personaRel(key), title)
  }

  // 2. Persona modes become dormant personas of their own.
  for (const doc of await readDirDocuments(root, '人格/模式')) {
    const target = slugify(doc.title)
    if (target === key) continue
    if (await moveTo(doc.path, personaRel(target))) {
      await rewriteTitle(root, personaRel(target), target)
    }
  }

  // 3. 关于我 became 同游 — the only document whose name changes on purpose.
  if (await exists(path.join(root, '记忆/关于我.md'))) {
    const raw = await fs.readFile(path.join(root, '记忆/关于我.md'), 'utf8')
    const { meta, body } = splitFrontMatter(raw)
    const renamed = body.replace(/^(\s*)#\s+关于我[^\n]*/, '$1# 同游')
    const text = frontMatter({ ...meta, title: '同游' }) + renamed.replace(/\s+$/, '') + '\n'
    await fs.mkdir(path.join(root, memoryRoot(key)), { recursive: true })
    await writeTextAtomic(path.join(root, tongyouRel(key)), text, 'utf8')
    await fs.rm(path.join(root, '记忆/关于我.md'))
    moved.push('记忆/关于我.md → ' + tongyouRel(key))
  }

  // 4. Diary: short-term and long-term folders move as they are.
  for (const doc of await readDirDocuments(root, '记忆/日记/近期')) {
    await moveTo(doc.path, recentRel(key) + '/' + path.basename(doc.path))
  }
  for (const doc of await readDirDocuments(root, '记忆/日记/归档')) {
    await moveTo(doc.path, longRel(key) + '/' + path.basename(doc.path))
  }

  // 5. Workshop: 常驻/按需 keep their meaning, nested under the persona.
  for (const always of [true, false]) {
    const legacy = '工坊/' + (always ? '常驻' : '按需')
    for (const doc of await readDirDocuments(root, legacy)) {
      await moveTo(doc.path, workshopRel(key, always) + '/' + path.basename(doc.path))
    }
  }

  // 6. Sealed documents follow their persona too.
  for (const doc of await readDirDocuments(root, '封存')) {
    await moveTo(doc.path, sealedRel(key) + '/' + path.basename(doc.path))
  }

  // 7. Legacy folders are pruned by `pruneLegacyDirs`, which runs on every
  // start so a half-migrated library still tidies itself up.
  const next = await writeSettings(root, { format: FORMAT, activePersona: key })

  // The persona template lives in the docs; a migrated library never needs it.
  if (moved.length === 0 && !(await exists(path.join(root, personaRel(DEFAULT_PERSONA))))) {
    await writeTextAtomic(path.join(root, personaRel(DEFAULT_PERSONA)), PERSONA_TEMPLATE, 'utf8')
  }

  return { settings: next, migrated: moved }
}

/**
 * Remove the format-1 folders once they are empty, deepest first, so a parent
 * only disappears after its children are gone. Anything still holding a file
 * is left alone — a half-migrated library must never lose a document.
 */
async function pruneLegacyDirs(root) {
  for (const dir of [...LEGACY_DIRS].reverse()) {
    const target = path.join(root, dir)
    try {
      const left = await fs.readdir(target)
      if (left.length === 0) await fs.rmdir(target)
    } catch {
      // missing or not empty: nothing to do
    }
  }
}

/**
 * Drop empty folders that sit directly under 封存.
 *
 * Older builds created 封存/<persona>/ for every persona before anything was in
 * it. Those husks are both clutter and a name thief — a whole persona box has to
 * land in 封存/<key>/, and the empty one would push it to 封存/<key>-YYYY-MM-DD.
 * Only truly empty folders go; a sealed box always has 人格.md inside.
 */
async function pruneEmptySealedDirs(root) {
  const abs = path.join(root, '封存')
  let entries = []
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(abs, entry.name)
    try {
      const left = await fs.readdir(dir)
      if (left.length === 0) await fs.rmdir(dir)
    } catch {
      // missing or busy: leave it for the next start
    }
  }
}

/**
 * Reunite leftovers with their box.
 *
 * A persona folder with no matching 人格 file (an older delete, a manual move)
 * would otherwise sit in the live folders forever, invisible in the panel but
 * still scanned. Moving it into 封存/<key>/ keeps the whole box together and
 * never touches a document that belongs to a live persona.
 */
async function tidyOrphanArchives(root) {
  const moved = []
  const personas = new Set((await readDirDocuments(root, '人格')).map(personaKeyOf))

  for (const group of [
    { base: '记忆', box: '记忆' },
    { base: '工坊', box: '工坊' },
  ]) {
    let entries = []
    try {
      entries = await fs.readdir(path.join(root, group.base), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || personas.has(entry.name)) continue
      const from = path.join(root, group.base, entry.name)
      const to = path.join(root, '封存', entry.name, group.box)
      if (await exists(to)) continue
      try {
        await fs.mkdir(path.dirname(to), { recursive: true })
        await fs.rename(from, to)
        moved.push(group.base + '/' + entry.name + ' → 封存/' + entry.name + '/' + group.box)
      } catch {
        // a locked folder never fails start-up
      }
    }
  }
  return moved
}

async function rewriteTitle(root, rel, title) {
  const abs = path.join(root, rel)
  if (!(await exists(abs))) return
  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)
  const text = frontMatter({ ...meta, title }) + body.replace(/^\s+/, '')
  if (text !== raw) await writeTextAtomic(abs, text, 'utf8')
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function readSettings(root) {
  try {
    const raw = await fs.readFile(settingsPath(root), 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeSettings(root, patch) {
  const current = await readSettings(root)
  const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) }
  // Only known keys survive, so a bad payload cannot corrupt the file.
  const clean = {}
  for (const key of Object.keys(DEFAULTS)) clean[key] = key === 'format' ? FORMAT : next[key]
  await writeTextAtomic(settingsPath(root), JSON.stringify(clean, null, 2), 'utf8')
  return clean
}

/* ------------------------------------------------------------------ */
/* Document parsing                                                    */
/* ------------------------------------------------------------------ */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseScalar(raw) {
  const text = raw.trim()
  if (text.startsWith('[') && text.endsWith(']')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (/^-?\d+$/.test(text)) return Number(text)
  return text.replace(/^["']|["']$/g, '')
}

function splitFrontMatter(text) {
  const match = FRONT_MATTER.exec(text)
  if (!match) return { meta: {}, body: text }
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    if (!key) continue
    meta[key] = parseScalar(line.slice(at + 1))
  }
  return { meta, body: text.slice(match[0].length) }
}

function firstHeading(body) {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) return trimmed.replace(/^#+\s*/, '').trim()
    return ''
  }
  return ''
}

function firstParagraph(body) {
  const cleaned = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('<!--') && !line.startsWith('-->'))
  return cleaned[0] || ''
}

function clamp(text, max) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** Parse one markdown file into the document shape the panel and tools use. */
export function parseDocument(relPath, text) {
  const { meta, body } = splitFrontMatter(text)
  const base = path.basename(relPath, '.md')
  const dateFromName = /^\d{4}-\d{2}-\d{2}$/.test(base) ? base : ''
  const heading = firstHeading(body)
  const title = typeof meta.title === 'string' && meta.title ? meta.title : heading || dateFromName || base
  const summary =
    typeof meta.summary === 'string' && meta.summary ? meta.summary : clamp(firstParagraph(body), 60)

  return {
    path: relPath,
    title,
    summary,
    date: typeof meta.date === 'string' ? meta.date : dateFromName,
    // 自述 pages keep the hour they were written in; the editor uses it to say
    // which page is earlier when flipping left and right.
    logged: typeof meta.logged === 'string' ? meta.logged : '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    private: meta.private === true,
    always: meta.always === true,
    version: typeof meta.version === 'number' ? meta.version : undefined,
    scope: typeof meta.scope === 'string' ? meta.scope : '',
    share: Array.isArray(meta.shareFrom) ? meta.shareFrom : [],
    body: body.trim(),
  }
}

async function readDirDocuments(root, relDir) {
  const abs = path.join(root, relDir)
  let entries = []
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }
  const docs = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const rel = relDir + '/' + entry.name
    try {
      const text = await fs.readFile(path.join(abs, entry.name), 'utf8')
      docs.push(parseDocument(rel, text))
    } catch {
      // An unreadable file never breaks the panel; it just does not appear.
    }
  }
  return docs
}

/**
 * Read one sealed persona box: a folder under 封存 that still holds 人格.md.
 *
 * A deleted persona moves here whole (人格/记忆/工坊), so it is not a document —
 * it can never be "unsealed" back into a file slot, only carried home as a
 * persona. Listing reads the box itself instead of 封存/<active persona>/, which
 * is why deleted personas used to be invisible in the panel.
 */
async function readSealedPersonas(root) {
  const abs = path.join(root, '封存')
  let entries = []
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return []
  }

  const boxes = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const rel = '封存/' + entry.name
    const dir = path.join(root, rel)
    const personaFile = path.join(dir, '人格.md')
    if (!(await exists(personaFile))) continue

    let title = entry.name
    try {
      const doc = parseDocument(rel + '/人格.md', await fs.readFile(personaFile, 'utf8'))
      if (doc.title) title = doc.title
    } catch {
      // A broken box still shows up by its folder name.
    }

    // 同游 is the standing note, not one of the days — it does not count here.
    const memories = await countMarkdown(path.join(dir, '记忆'), ['同游.md'])
    boxes.push({
      path: rel,
      title,
      // The box is described by what it holds. Quoting the persona's own lines
      // here would spill her body into a list.
      summary: '整个人格 · ' + (memories ? memories + ' 篇记忆' : '没有记忆'),
      date: (entry.name.match(/(\d{4}-\d{2}-\d{2})$/) || [])[1] || '',
      kind: 'persona',
      memories,
    })
  }

  // Newest folder first: a date suffix sorts after the same name without one.
  return boxes.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0))
}

/** Count .md files under a folder, used to describe a sealed persona box. */
async function countMarkdown(abs, skip) {
  let entries = []
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countMarkdown(path.join(abs, entry.name), skip)
    else if (!entry.name.toLowerCase().endsWith('.md')) continue
    else if (skip && skip.indexOf(entry.name) >= 0) continue
    else total += 1
  }
  return total
}

/* ------------------------------------------------------------------ */
/* Read model                                                          */
/* ------------------------------------------------------------------ */

const byTitle = (a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0)

/**
 * A page's sortable moment: the date, plus the hour when the page knows it.
 *
 * 长期 uses a span as its date (`2026-10-17~2026-10-20`), so "this stretch of
 * days" is ordered by where it ends. Same-day pages are ordered by the hour
 * they were written — without this, one day's pages came out in whatever order
 * the folder listed the files, which reads as random in the panel.
 */
function recencyKey(doc) {
  const raw = String(doc.date || '')
  const end = raw.includes('~') ? raw.split('~').pop() : raw
  return (end + ' ' + String(doc.logged || '')).trim()
}

/** `2026-10-20-3.md` is the third page of the day; `2026-10-20.md` is the first. */
function pageSeq(doc) {
  // 只认「日期-序号.md」，别把日期里的 -21 当成页码
  const match = path.basename(String(doc.path || '')).match(/^\d{4}-\d{2}-\d{2}-(\d+)\.md$/)
  return match ? Number(match[1]) : 1
}

const byDateDesc = (a, b) => {
  const ka = recencyKey(a)
  const kb = recencyKey(b)
  if (ka !== kb) return ka < kb ? 1 : -1
  return pageSeq(b) - pageSeq(a)
}

/** The persona key is its file name, so the folder layout always matches. */
export function personaKeyOf(doc) {
  return doc && doc.path ? path.basename(doc.path, '.md') : ''
}

async function resolveActivePersona(root, settings) {
  const personas = (await readDirDocuments(root, '人格')).sort(byTitle)
  if (personas.length === 0) return null
  const wanted = settings && settings.activePersona
  const found = wanted ? personas.find((doc) => personaKeyOf(doc) === wanted) : null
  const active = found || personas[0]
  return { key: personaKeyOf(active), doc: active, personas }
}

export async function readState(root) {
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  const key = resolved ? resolved.key : DEFAULT_PERSONA
  const personas = resolved ? resolved.personas : []

  const [tongyou, recent, archive, always, onDemand, sealed, sealedPersonas, selfNotes] =
    await Promise.all([
      readDirDocuments(root, memoryRoot(key)),
      readDirDocuments(root, recentRel(key)),
      readDirDocuments(root, longRel(key)),
      readDirDocuments(root, workshopRel(key, true)),
      readDirDocuments(root, workshopRel(key, false)),
      readDirDocuments(root, sealedRel(key)),
      readSealedPersonas(root),
      readDirDocuments(root, selfRel(key)),
    ])

  // Shared arcs are read-only windows into another persona's archive. They are
  // never injected into the index — they only widen what recall can reach.
  const sharedKeys = resolved && Array.isArray(resolved.doc.share) ? resolved.doc.share : []
  const shared = []
  for (const other of sharedKeys) {
    if (!other || other === key) continue
    if (!personas.some((doc) => personaKeyOf(doc) === other)) continue
    const [otherTongyou, otherRecent, otherArchive, otherAlways, otherOnDemand] = await Promise.all([
      readDirDocuments(root, memoryRoot(other)),
      readDirDocuments(root, recentRel(other)),
      readDirDocuments(root, longRel(other)),
      readDirDocuments(root, workshopRel(other, true)),
      readDirDocuments(root, workshopRel(other, false)),
    ])
    shared.push({
      key: other,
      readOnly: true,
      tongyou: otherTongyou.find((doc) => /^同游\.md$/.test(path.basename(doc.path))) || null,
      recent: otherRecent.sort(byDateDesc),
      archive: otherArchive.sort(byDateDesc),
      workshop: [].concat(otherAlways, otherOnDemand),
    })
  }

  return {
    format: FORMAT,
    dataDir: root,
    settings,
    personas,
    activePersona: key,
    persona: resolved ? resolved.doc : null,
    share: resolved && Array.isArray(resolved.doc.share) ? resolved.doc.share : [],
    shared,
    tongyou: tongyou.find((doc) => /^同游\.md$/.test(path.basename(doc.path))) || null,
    // Kept as an alias so older call sites keep working while the rename lands.
    about: tongyou.find((doc) => /^同游\.md$/.test(path.basename(doc.path))) || null,
    memory: { recent: recent.sort(byDateDesc), archive: archive.sort(byDateDesc) },
    workshop: { always, onDemand },
    sealed,
    // Whole personas live in sibling folders under 封存, not inside this
    // persona's own 封存/<key>, so they need their own read path.
    sealedPersonas,
    // Her own diary: panel-only, deliberately excluded from the index and from
    // what recall can reach.
    self: selfNotes.sort(byDateDesc),
  }
}

export async function setActivePersona(root, key) {
  const personas = await readDirDocuments(root, '人格')
  const found = personas.find((doc) => personaKeyOf(doc) === key)
  if (!found) throw new Error('找不到这个人格')
  const settings = await writeSettings(root, { activePersona: key })
  await ensurePersonaSubtree(root, settings)
  return { activePersona: key }
}

/** Create one more persona. It stays dormant until the user activates it. */
export async function createPersona(root, input) {
  const title = oneLine(input && input.title ? input.title : '')
  if (!title) throw new Error('标题不能为空')
  const key = slugify(title)
  const rel = personaRel(key)
  if (await exists(path.join(root, rel))) throw new Error('已经有同名人格：' + key)

  const body = String((input && input.body) || '').trim() || '# ' + title + '\n'
  const text =
    frontMatter({ title, summary: oneLine((input && input.summary) || '') }) + body + '\n'
  await fs.mkdir(path.join(root, '人格'), { recursive: true })
  await writeTextAtomic(path.join(root, rel), text, 'utf8')
  await ensurePersonaSubtree(root, await readSettings(root))
  return { path: rel, key, title }
}

/**
 * Retire a persona by moving its whole box into 封存.
 *
 * The box holds the persona file, its memories, and its workshop — everything
 * that belonged to it, so nothing is left orphaned in the live folders. The
 * persona's own sealed documents already live in that folder and stay as they
 * are. Nothing is ever deleted: moving the box back restores the persona.
 */
export async function deletePersona(root, key) {
  const settings = await readSettings(root)
  if (settings.activePersona === key) throw new Error('正在启用的人格不能删除，先启用别的')
  const personas = await readDirDocuments(root, '人格')
  if (personas.length <= 1) throw new Error('至少要留一个人格')

  const abs = path.join(root, personaRel(key))
  if (!(await exists(abs))) throw new Error('找不到这个人格')

  // If this persona already had sealed documents, they occupy 封存/<key>.
  // Move the whole box next to them instead of merging into them.
  let box = '封存/' + key
  if (await exists(path.join(root, box))) box = box + '-' + today()
  const moved = []
  const takeInto = async (fromRel, toRel) => {
    const from = path.join(root, fromRel)
    if (!(await exists(from))) return
    const to = path.join(root, toRel)
    if (await exists(to)) return
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.rename(from, to)
    moved.push(fromRel + ' → ' + toRel)
  }

  await takeInto(personaRel(key), box + '/人格.md')
  await takeInto(memoryRoot(key), box + '/记忆')
  await takeInto('工坊/' + key, box + '/工坊')

  return { path: box, key, moved }
}

/**
 * Decide which other personas this one may read. Sharing is one-way and
 * read-only: it grants a lookup, never a write into someone else's archive.
 */
export async function setPersonaShare(root, key, shareFrom) {
  const abs = path.join(root, personaRel(key))
  if (!(await exists(abs))) throw new Error('找不到这个人格')
  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)
  const list = (Array.isArray(shareFrom) ? shareFrom : []).filter(
    (item) => typeof item === 'string' && item && item !== key
  )

  const fields = { ...meta }
  if (list.length) fields.shareFrom = list
  else delete fields.shareFrom

  await writeTextAtomic(abs, frontMatter(fields) + body.replace(/^\s+/, ''), 'utf8')
  return { key, shareFrom: list }
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Work out which folder "打开目录" should show for a given key.
 *
 * A key that already starts with 封存/ is a literal location (a deleted
 * persona's box, or this persona's sealed folder); anything else is the usual
 * folder name resolved under the active persona. The result is always kept
 * inside the library — a `..` must never walk out of it.
 */
export async function resolveRevealTarget(root, which) {
  const raw = typeof which === 'string' ? which.replace(/\\/g, '/') : ''
  const base = path.resolve(root)
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)

  let target = base
  if (raw.indexOf('封存/') === 0) {
    if (raw.includes('..')) throw new Error('路径不合法')
    target = path.resolve(base, raw)
  } else if (raw) {
    if (raw.includes('..')) throw new Error('路径不合法')
    target =
      raw === '人格' || !resolved
        ? path.resolve(base, raw)
        : path.resolve(base, raw, resolved.key)
  }

  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('路径不合法')
  return target
}

export async function revealFolder(root, which) {
  const target = await resolveRevealTarget(root, which)
  await fs.access(target)
  await new Promise((resolve, reject) => {
    execFile('explorer.exe', [target], (error) => (error ? reject(error) : resolve()))
  })
  return target
}

/**
 * Resolve the folder *above* one sealed item.
 *
 * Opening the box itself drops a beginner into a wall of 人格.md and 记忆/ with
 * no sense of where they are. Opening 封存/ shows the boxes standing side by
 * side, which is how a person actually recognises what they are about to delete.
 */
export async function resolveRevealParent(root, relPath) {
  const rel = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (!rel || rel.includes('..') || rel.startsWith('/')) throw new Error('路径不合法')

  const base = path.resolve(root)
  const target = path.resolve(base, rel)
  if (target === base || !target.startsWith(base + path.sep)) throw new Error('路径不合法')

  const parent = path.dirname(target)
  if (parent === target) throw new Error('路径不合法')
  return parent
}

export async function revealItem(root, relPath) {
  const parent = await resolveRevealParent(root, relPath)
  await fs.access(parent)
  await new Promise((resolve, reject) => {
    execFile('explorer.exe', [parent], (error) => (error ? reject(error) : resolve()))
  })
  return { path: relPath, parent }
}

/**
 * Ask Windows for a folder.
 *
 * The host is plain Node, so the picker comes from PowerShell's forms assembly.
 * Cancelling the dialog yields an empty path and changes nothing.
 */
export async function pickFolder(initial) {
  const seed = String(initial || '').replace(/'/g, "''")
  const outFile = path.join(os.tmpdir(), 'buwang-pick-' + Date.now() + '.txt')
  const quote = (value) => "'" + String(value).replace(/'/g, "''") + "'"

  // The path is written to a UTF-8 file and read back from there. PowerShell's
  // stdout encoding turns a Chinese folder name into U+FFFD placeholders, and a
  // mangled path does not fail — it silently creates a garbage directory.
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = '选一个文件夹放不忘的记忆库'",
    '$d.ShowNewFolderButton = $true',
    seed ? "$d.SelectedPath = '" + seed + "'" : '',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [System.IO.File]::WriteAllText(' +
      quote(outFile) +
      ', $d.SelectedPath, (New-Object System.Text.UTF8Encoding($false)))',
    '}',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-STA', '-Command', script],
        { timeout: 180000 },
        (error) => (error ? reject(error) : resolve())
      )
    })
    const chosen = await fs.readFile(outFile, 'utf8').catch(() => '')
    return { path: String(chosen || '').trim() }
  } finally {
    await fs.unlink(outFile).catch(() => {})
  }
}

export async function appendDraft(root, relPath, text) {
  const target = path.join(root, relPath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.appendFile(target, text, 'utf8')
  return relPath
}

/**
 * Seal one document: it stops being indexed, recalled, injected, or mentioned,
 * but the bytes stay on disk. The original path is written into the front
 * matter so `unseal` can put it back exactly where it came from.
 */
export async function moveToSealed(root, relPath) {
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  const key = resolved ? resolved.key : DEFAULT_PERSONA
  const from = path.join(root, relPath)
  if (!(await exists(from))) throw new Error('找不到这个文档')
  if (relPath.replace(/\\/g, '/').indexOf('封存/') === 0) throw new Error('已经封存过了')

  const stamp = today()
  const base = path.basename(relPath)
  const toRel = sealedRel(key) + '/' + stamp + '-' + base

  const raw = await fs.readFile(from, 'utf8')
  const { meta, body } = splitFrontMatter(raw)
  const text = frontMatter({ ...meta, sealedFrom: relPath, sealedAt: stamp }) + body.replace(/^\s+/, '')
  await writeTextAtomic(from, text, 'utf8')

  await fs.mkdir(path.dirname(path.join(root, toRel)), { recursive: true })
  await fs.rename(from, path.join(root, toRel))
  return { path: toRel, from: relPath }
}

/** Put one sealed document back where it came from. Nothing is merged. */
export async function unseal(root, relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/')
  if (!rel || rel.includes('..') || rel.startsWith('/')) throw new Error('路径不合法')
  if (rel.indexOf('封存/') !== 0) throw new Error('这个文档不在封存里')

  const abs = path.join(root, rel)
  if (!(await exists(abs))) throw new Error('找不到这个文档')

  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)
  const back = typeof meta.sealedFrom === 'string' && meta.sealedFrom ? meta.sealedFrom : ''
  if (!back || back.includes('..') || back.startsWith('/')) throw new Error('这个文档没记着原来的位置')

  const fields = { ...meta }
  delete fields.sealedFrom
  delete fields.sealedAt

  const target = path.join(root, back)
  if (await exists(target)) throw new Error('原来的位置已经有同名文档：' + back)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await writeTextAtomic(abs, frontMatter(fields) + body.replace(/^\s+/, ''), 'utf8')
  await fs.rename(abs, target)
  return { path: back, from: rel }
}

/**
 * Carry a whole sealed persona box back into the live library.
 *
 * The box is 封存/<key>/ or 封存/<key>-YYYY-MM-DD/ holding 人格.md, 记忆/ and
 * 工坊/. Each part returns to its own place; a name clash stops the whole move
 * before anything is touched, because half a persona is worse than none.
 */
export async function restorePersona(root, boxRel) {
  const rel = String(boxRel || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (!rel || rel.includes('..') || rel.startsWith('/')) throw new Error('路径不合法')
  if (rel.indexOf('封存/') !== 0) throw new Error('这个不在封存里')

  const abs = path.join(root, rel)
  if (!(await exists(abs))) throw new Error('找不到这个封存')
  if (!(await exists(path.join(abs, '人格.md')))) throw new Error('这不是一个完整的人格封存')

  const key = path.basename(rel).replace(/-\d{4}-\d{2}-\d{2}$/, '')
  if (await exists(path.join(root, personaRel(key)))) {
    throw new Error('已经有了同名人格「' + key + '」，先把它改名再接回来')
  }
  if (await exists(path.join(root, memoryRoot(key)))) {
    throw new Error('记忆目录「' + memoryRoot(key) + '」已经被占用，先整理好再接回来')
  }

  await fs.mkdir(path.join(root, '人格'), { recursive: true })
  await fs.rename(path.join(abs, '人格.md'), path.join(root, personaRel(key)))
  const moved = [personaRel(key)]

  for (const [from, to] of [
    ['记忆', memoryRoot(key)],
    ['工坊', '工坊/' + key],
  ]) {
    const src = path.join(abs, from)
    if (!(await exists(src))) continue
    await fs.mkdir(path.dirname(path.join(root, to)), { recursive: true })
    await fs.rename(src, path.join(root, to))
    moved.push(to)
  }

  // The box is empty once its three parts left; if a stranger file is still in
  // there, keep the folder so nothing is lost and say so.
  const left = await fs.readdir(abs).catch(() => null)
  const keep = left === null || left.length > 0
  if (!keep) await fs.rmdir(abs)

  await ensurePersonaSubtree(root, await readSettings(root))
  return {
    path: personaRel(key),
    key,
    moved,
    box: keep ? rel : '',
    left: keep && left ? left : [],
  }
}

function today() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
}

function oneLine(text) {
  // Booleans and 0 are real values: `false || ''` would silently blank them.
  if (text === true) return 'true'
  if (text === false) return 'false'
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim()
}

export function slugify(title) {
  const cleaned = String(title || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || '未命名').slice(0, 60)
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Write a text file in one piece.
 *
 * A memory that is half-written is worse than one that was never saved: the
 * panel would show broken front matter and the entry would look corrupted.
 * Write the whole text into a temp file in the same folder, then rename it over
 * the target — a rename is atomic, so the file is either the old version or the
 * new one, never a mix. Windows can hold a short lock on the target (antivirus,
 * search indexer), so the rename gets a few beats of retry.
 */
async function writeTextAtomic(target, text) {
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(
    dir,
    '.buwang-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.tmp'
  )
  await fs.writeFile(temp, text, 'utf8')

  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(temp, target)
      return
    } catch (error) {
      lastError = error
      const code = error && error.code
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)))
        continue
      }
      break
    }
  }
  await fs.rm(temp, { force: true }).catch(() => {})
  throw lastError
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/**
 * The date a person would write on paper.
 *
 * The front matter keeps the ISO date because code sorts and greps by it; the
 * page itself says 「2026年10月20日 星期二」 so a 自述 page reads like a diary
 * instead of a record. The hour rides along when the page title cannot carry it.
 */
function diaryStamp(date, stamp) {
  const [y, m, d] = String(date || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  const week = WEEKDAY_CN[new Date(y, m - 1, d).getDay()] || ''
  const line = y + '年' + m + '月' + d + '日' + (week ? ' 星期' + week : '')
  return '*' + line + (stamp ? ' · ' + stamp : '') + '*'
}

function frontMatter(fields) {
  const lines = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length) lines.push(key + ': [' + value.join(', ') + ']')
      continue
    }
    lines.push(key + ': ' + oneLine(value))
  }
  lines.push('---', '')
  return lines.join('\n')
}

/** Append today's entry, or create today's file when it does not exist yet. */
export async function saveDiary(root, doc) {
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  const key = resolved ? resolved.key : DEFAULT_PERSONA

  const date = /^\d{4}-\d{2}-\d{2}$/.test(doc.date || '') ? doc.date : today()
  const body = String(doc.body || '').trim()
  const logged = new Date().toTimeString().slice(0, 5)

  // One summary = one entry, not one file per day. A second summary on the same
  // day becomes 2026-10-20-2.md; the date stays the tag, and there is no clock
  // header inside, so each entry reads as one whole day's story on its own.
  const base = recentRel(key) + '/' + date
  let rel = base + '.md'
  let seq = 2
  while (await exists(path.join(root, rel))) {
    rel = base + '-' + seq + '.md'
    seq += 1
  }
  const abs = path.join(root, rel)

  const text =
    frontMatter({
      title: doc.title || date,
      summary: doc.summary || '',
      date,
      // Kept, never shown: the panel displays the date only, but recall and
      // sorting can still tell which entry of the day came first.
      logged,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      scope: doc.scope || '',
      persona: key,
    }) +
    '# ' +
    (doc.title || date) +
    '\n\n' +
    body +
    '\n'

  await fs.mkdir(path.dirname(abs), { recursive: true })
  await writeTextAtomic(abs, text, 'utf8')
  return { path: rel, appended: false }
}

/** Create or replace a workshop document; version bumps on update. */
export async function saveWorkshop(root, doc) {
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  const key = resolved ? resolved.key : DEFAULT_PERSONA

  const always = doc.always === true
  const rel = workshopRel(key, always) + '/' + slugify(doc.title) + '.md'
  const abs = path.join(root, rel)
  let version = 1
  if (await exists(abs)) {
    const prior = await fs.readFile(abs, 'utf8')
    const parsed = parseDocument(rel, prior)
    version = (parsed.version || 1) + 1
  }
  const text =
    frontMatter({
      title: doc.title,
      summary: doc.summary || '',
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      always,
      version,
      persona: key,
    }) +
    String(doc.body || '').trim() +
    '\n'
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await writeTextAtomic(abs, text, 'utf8')
  return { path: rel, version, replaced: version > 1 }
}

/**
 * Create one workshop document from the panel.
 *
 * `saveWorkshop` is the tool's path and versions an existing skill on purpose.
 * A person typing a new skill into the panel wants a new file, not a silent
 * overwrite — a name clash stops here and says so.
 *
 * New skills land in 按需 (off) unless the user ticks "直接启用", because a
 * workshop body that nobody asked for must never ride along every turn.
 */
export async function createWorkshopDoc(root, input) {
  const title = oneLine(input && input.title ? input.title : '')
  if (!title) throw new Error('标题不能为空')

  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  const key = resolved ? resolved.key : DEFAULT_PERSONA
  const name = slugify(title) + '.md'
  for (const dir of [workshopRel(key, false), workshopRel(key, true)]) {
    if (await exists(path.join(root, dir, name))) throw new Error('已经有同名技能：' + title)
  }

  const body = String((input && input.body) || '').trim()
  return saveWorkshop(root, {
    title,
    summary: oneLine((input && input.summary) || ''),
    // An empty skill still gets a skeleton: the panel is used by people who do
    // not write Markdown from scratch.
    body: body || '# ' + title + '\n\n## 什么时候用\n\n\n## 怎么做\n\n',
    tags: Array.isArray(input && input.tags) ? input.tags : [],
    always: input && input.always === true,
  })
}

/**
 * Flip one workshop document between 常驻 and 按需.
 *
 * 常驻 = the body is injected every turn (the folder is the rule, so the file
 * moves). 按需 = the name appears in the index and the body waits for a recall.
 * Nothing is deleted: the file keeps its body and only changes folder.
 */
export async function setWorkshopMode(root, relPath, always) {
  const want = always === true
  const rel = String(relPath || '').replace(/\\/g, '/')
  if (!rel || rel.includes('..') || rel.startsWith('/')) throw new Error('路径不合法')
  if (!/^工坊\/[^/]+\/(常驻|按需)\//.test(rel)) throw new Error('不是工坊里的文档')

  const from = path.join(root, rel)
  if (!(await exists(from))) throw new Error('找不到这个文档')

  const raw = await fs.readFile(from, 'utf8')
  const next = withAlways(raw, want)
  const base = path.basename(rel)
  const dir = path.posix.dirname(rel)
  const toRel = path.posix.join(path.posix.dirname(dir), want ? '常驻' : '按需', base)

  if (toRel === rel) {
    if (next !== raw) await writeTextAtomic(from, next, 'utf8')
    return { path: rel, always: want, moved: false }
  }

  const to = path.join(root, toRel)
  if (await exists(to)) throw new Error('对面已经有同名文档：' + toRel)
  await fs.mkdir(path.dirname(to), { recursive: true })
  await writeTextAtomic(to, next, 'utf8')
  await fs.rm(from)
  return { path: toRel, always: want, moved: true }
}

/** Set the `always` flag inside front matter, creating or extending it. */
function withAlways(text, value) {
  const flag = 'always: ' + (value ? 'true' : 'false')
  const match = FRONT_MATTER.exec(text)
  if (!match) return '---\n' + flag + '\n---\n' + text

  const lines = match[1].split(/\r?\n/)
  let found = false
  const next = lines.map((line) => {
    if (/^always\s*:/.test(line)) {
      found = true
      return flag
    }
    return line
  })
  if (!found) next.push(flag)
  return '---\n' + next.join('\n') + '\n---\n' + text.slice(match[0].length)
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

const EDITABLE = /^(人格\/|记忆\/|工坊\/|自述\/)/

/**
 * Save an edit made in the panel: title, one-line summary, body.
 *
 * Front matter the panel does not show (date, tags, always, scope, private) is
 * carried over untouched, so editing text never changes what a document means.
 * Workshop documents bump their version, matching `saveWorkshop`.
 */
export async function saveDoc(root, relPath, input) {
  const rel = String(relPath || '').replace(/\\/g, '/')
  if (!rel || rel.includes('..') || rel.startsWith('/')) throw new Error('路径不合法')
  if (!EDITABLE.test(rel)) throw new Error('这个位置不支持编辑')

  const abs = path.join(root, rel)
  if (!(await exists(abs))) throw new Error('找不到这个文档')

  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)

  const title = oneLine(input.title != null ? input.title : meta.title || '')
  const summary = oneLine(input.summary != null ? input.summary : meta.summary || '')
  let nextBody = String(input.body != null ? input.body : body).replace(/\s+$/, '')

  // A diary heading mirrors its title, so an edit does not leave the two
  // disagreeing. A heading the user wrote themselves is left alone — that is
  // what makes pasting a whole SOUL-style document work.
  const priorTitle = oneLine(meta.title || '')
  if (title && priorTitle && title !== priorTitle) {
    nextBody = nextBody.replace(/^(\s*)#\s+([^\n]*)/, (whole, pad, heading) =>
      heading.trim() === priorTitle ? pad + '# ' + title : whole
    )
  }

  const fields = { ...meta, title, summary }
  if (rel.indexOf('工坊/') === 0) fields.version = (Number(meta.version) || 1) + 1
  if (summary === '') delete fields.summary

  await writeTextAtomic(abs, frontMatter(fields) + nextBody + '\n', 'utf8')
  return { path: rel, title, summary, version: fields.version }
}

/** 同游 rides every turn, so it has a ceiling: past this, the page sheds a few. */
const TONGYOU_CAP = 25

/**
 * Split 同游 into items: a `- ` line or a `## ` heading, plus its continuation.
 * Loose text before the first item is kept as a preamble.
 */
function tongyouItems(body) {
  const leading = []
  const items = []
  let started = false
  for (const line of String(body || '').split(/\r?\n/)) {
    const isItem = /^\s*-\s+/.test(line) || /^\s*##\s+/.test(line)
    if (isItem) {
      started = true
      items.push({ raw: line, label: line.replace(/^\s*-\s+/, '').trim() })
      continue
    }
    if (!started) {
      leading.push(line)
      continue
    }
    if (items.length) items[items.length - 1].raw += '\n' + line
    else leading.push(line)
  }
  return { leading, items }
}

/**
 * Append one standing note to 同游.
 *
 * 同游 is the always-on sheet, so entries must be short and still true
 * tomorrow — a promise, a preference, a rule. Anything that happened today
 * belongs in the diary instead.
 */
export async function saveTongyou(root, input) {
  const key = await activeKey(root)
  await ensureTongyou(root, key)

  const rel = tongyouRel(key)
  const abs = path.join(root, rel)
  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)

  const line = String((input && (input.body || input.text)) || '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
  if (!line) throw new Error('内容不能为空')

  // 去重按「整条一模一样」算。用 body.indexOf(line) 判断时，新写的短句会被
  // 旧的长句「包含」，于是永远存不进去。
  const items = tongyouItems(body).items
  if (items.some((item) => item.label === line)) {
    return { path: rel, line, existed: true, ambiguous: hasLoosePerson(line) }
  }

  if (items.length >= TONGYOU_CAP) {
    // Full: never sneak past the ceiling. The caller picks what to move out,
    // the user nods, then this line goes in.
    return {
      path: rel,
      line,
      existed: false,
      full: true,
      count: items.length,
      cap: TONGYOU_CAP,
      items: items.map((item) => item.label),
    }
  }

  const nextBody = body.replace(/\s+$/, '') + '\n- ' + line + '\n'
  await writeTextAtomic(abs, frontMatter(meta) + nextBody.replace(/^\n+/, ''), 'utf8')
  return { path: rel, line, existed: false, ambiguous: hasLoosePerson(line) }
}

/**
 * 同游 is read many turns later with nobody around to explain who "I" was, so a
 * line using 我/你 is ambiguous by construction. This only reports; the caller
 * decides whether to rewrite the line with names.
 */
function hasLoosePerson(line) {
  return /[我你俺妳]/.test(String(line || ''))
}

/**
 * Her own diary.
 *
 * One entry = one page, not one page per day: a day can hold several thoughts
 * and each deserves its own sheet. Same hour still only gets one entry — a
 * diary written every ten minutes is noise, not a diary.
 *
 * It never reaches the model — not the index, not recall — so it costs no
 * tokens. It is for the person to read.
 */
export async function saveSelfNote(root, input) {
  const key = await activeKey(root)
  const body = String((input && input.body) || '').trim()
  if (!body) throw new Error('内容不能为空')

  const date = today()
  const stamp = new Date().toTimeString().slice(0, 5)
  const hour = stamp.slice(0, 2)
  const dir = selfRel(key)
  const absDir = path.join(root, dir)
  await fs.mkdir(absDir, { recursive: true })

  const existing = (await fs.readdir(absDir)).filter((name) => name.endsWith('.md')).sort()
  for (const name of existing) {
    if (!name.startsWith(date)) continue
    const raw = await fs.readFile(path.join(absDir, name), 'utf8')
    const { meta } = splitFrontMatter(raw)
    if (String(meta.logged || '').slice(0, 2) === hour) {
      return { path: dir + '/' + name, appended: true, skipped: true, reason: '这一小时已经写过一条了' }
    }
  }

  let rel = dir + '/' + date + '.md'
  let seq = 2
  while (await exists(path.join(root, rel))) {
    rel = dir + '/' + date + '-' + seq + '.md'
    seq += 1
  }

  // The hour goes into the title when there is no title of its own: three pages
  // of one day otherwise read identically in the panel list. With a custom
  // title the hour moves down to the date line instead, so nothing is lost.
  const custom = String((input && input.title) || '').trim()
  const title = custom || '自述 · ' + date + ' ' + stamp
  const text =
    frontMatter({
      title,
      summary: oneLine(body).slice(0, 40),
      date,
      // Kept, never shown: it is only here so the once-an-hour guard can tell
      // which hour this page belongs to.
      logged: stamp,
      tags: ['自述'],
      persona: key,
    }) +
    '# ' +
    title +
    '\n\n' +
    diaryStamp(date, custom ? stamp : '') +
    '\n\n' +
    body +
    '\n'

  await writeTextAtomic(path.join(root, rel), text, 'utf8')
  return { path: rel, appended: false, skipped: false }
}

/* ------------------------------------------------------------------ */
/* Consolidation                                                       */
/* ------------------------------------------------------------------ */

function iso(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * A long-term time tag: a whole month (2026-10), a single day (2026-10-17), or
 * the span a consolidation covered (2026-10-17~2026-10-20). A single day is a
 * real case — consolidating only one old entry produces exactly that range.
 */
const PERIOD_RE = /^(\d{4}-\d{2}|\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2})$/

function isPeriod(text) {
  return PERIOD_RE.test(String(text || ''))
}

async function activeKey(root) {
  const settings = await readSettings(root)
  const resolved = await resolveActivePersona(root, settings)
  return resolved ? resolved.key : DEFAULT_PERSONA
}

/**
 * Split the recent diary into what stays detailed and what becomes a period
 * summary. Only entries older than `keepDays` are candidates, so the last few
 * days keep their detail — the same shape human memory has.
 */
export async function consolidatePlan(root, keepDaysOverride) {
  const settings = await readSettings(root)
  const key = await activeKey(root)
  const keepDays = Math.max(1, Number(keepDaysOverride) || Number(settings.keepDays) || 2)
  const recent = await readDirDocuments(root, recentRel(key))

  const now = new Date()
  // keepDays = 保留细节的天数，含今天。2 天 = 今天 + 昨天，所以减的是
  // (keepDays - 1)：写 - keepDays 会把「前天」也算进保留，多留一天。
  const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (keepDays - 1))
  const cutoff = iso(cutoffDate)

  const keep = []
  const candidates = []
  for (const doc of recent) {
    const day = doc.date || ''
    if (day && day >= cutoff) keep.push(doc)
    else candidates.push(doc)
  }

  candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  keep.sort(byDateDesc)

  const latest = candidates.length ? candidates[candidates.length - 1].date || today() : today()
  const period = latest.slice(0, 7)
  // The suggested time tag for the long-term entry: the actual span of days
  // being consolidated, so "2026-10-17 ~ 2026-10-20" reads as a range.
  const from = candidates.length ? candidates[0].date || '' : ''
  const range = from && latest ? (from === latest ? from : from + '~' + latest) : ''

  return {
    period,
    range,
    cutoff,
    keepDays,
    persona: key,
    keep,
    candidates,
    total: recent.length,
  }
}

/**
 * Write the period summary and move the originals into the archive. Nothing is
 * deleted: a moved file keeps its name, only its folder changes.
 *
 * `kind: 'tongyou'` archives the relationship notes instead of the diary, into
 * a 同游-YYYY-MM.md file, so both live in the same long-term folder.
 */
export async function archiveEntries(root, input) {
  const key = await activeKey(root)
  // A long-term entry carries a time tag: one month, or the span of days it
  // consolidated (2026-10-17~2026-10-20). Nothing else is accepted.
  const period = isPeriod(input.period) ? input.period : today().slice(0, 7)
  const pretty = period.replace('~', ' ~ ')
  const tongyou = input.kind === 'tongyou'
  const base = tongyou ? '同游-' + period : period
  const rel = longRel(key) + '/' + base + '.md'
  const abs = path.join(root, rel)
  const body = String(input.body || '').trim()
  const title =
    input.title || (tongyou ? '同游 · ' + pretty : pretty + ' · 这段日子')
  const summary = input.summary || ''
  const existed = await exists(abs)

  await fs.mkdir(path.dirname(abs), { recursive: true })
  if (existed) {
    // 追加也走原子写：先读回来拼好，再整篇写过去。appendFile 半截失败会留下
    // 一篇 front matter 后跟半个段落的残页。
    const prior = await fs.readFile(abs, 'utf8')
    await writeTextAtomic(abs, prior.replace(/\s+$/, '') + '\n\n' + body + '\n', 'utf8')
  } else {
    await writeTextAtomic(
      abs,
      frontMatter({ title, summary, date: period, tags: tongyou ? ['同游', '归档'] : ['归档'] }) +
        body +
        '\n',
      'utf8'
    )
  }

  const moved = []
  for (const relPath of Array.isArray(input.paths) ? input.paths : []) {
    if (!relPath || relPath.includes('..') || relPath.startsWith('/') || relPath.startsWith('\\')) continue
    const from = path.join(root, relPath)
    if (!(await exists(from))) continue

    const name = path.basename(relPath)
    let target = path.join(root, longRel(key), name)
    let attempt = 1
    while (await exists(target)) {
      target = path.join(root, longRel(key), name.replace(/\.md$/, '') + '-' + attempt + '.md')
      attempt += 1
    }
    await fs.rename(from, target)
    moved.push(path.relative(root, target).split(path.sep).join('/'))
  }

  return { path: rel, appended: existed, moved, persona: key }
}

export async function readDoc(root, relPath) {
  const text = await fs.readFile(path.join(root, relPath), 'utf8')
  return parseDocument(relPath, text)
}

/**
 * Move the older half of 同游 into the long-term folder.
 *
 * 同游 rides along in full every turn, so it must stay short. The newest
 * `keepCount` items stay; everything older moves to 长期/同游-YYYY-MM.md and
 * becomes a single index line. Nothing is deleted, and the kept items keep
 * their exact text.
 */
export async function archiveTongyou(root, keepCount) {
  const key = await activeKey(root)
  const rel = tongyouRel(key)
  const abs = path.join(root, rel)
  if (!(await exists(abs))) throw new Error('还没有同游')

  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)

  const { leading, items } = tongyouItems(body)

  const keep = Math.max(1, Math.min(Number(keepCount) || 20, 200))
  if (items.length <= keep) {
    return { path: rel, moved: 0, kept: items.length, archive: '', persona: key }
  }

  const moveOut = items.slice(0, items.length - keep).map((item) => item.raw)
  const stay = items.slice(items.length - keep).map((item) => item.raw)

  const period = today().slice(0, 7)
  const archRel = longRel(key) + '/同游-' + period + '.md'
  const archAbs = path.join(root, archRel)
  const header = '## 从同游搬来 ' + today() + '\n\n'

  if (await exists(archAbs)) {
    // 追加也走原子写：先读回来拼好，再整篇写过去。appendFile 半截失败会留下
    // 一篇 front matter 后跟半个段落的残页。
    const prior = await fs.readFile(archAbs, 'utf8')
    await writeTextAtomic(archAbs, prior.replace(/\s+$/, '') + '\n\n' + header + moveOut.join('\n') + '\n', 'utf8')
  } else {
    await fs.mkdir(path.dirname(archAbs), { recursive: true })
    await writeTextAtomic(
      archAbs,
      frontMatter({
        title: '同游 · ' + period,
        summary: '搬过来的旧事',
        date: period,
        tags: ['同游', '归档'],
      }) +
        header +
        moveOut.join('\n') +
        '\n',
      'utf8'
    )
  }

  const nextBody = leading.join('\n').replace(/\s+$/, '') + '\n\n' + stay.join('\n') + '\n'
  await writeTextAtomic(abs, frontMatter(meta) + nextBody, 'utf8')
  return { path: rel, moved: moveOut.length, kept: stay.length, archive: archRel, persona: key }
}

/**
 * Move exactly these 同游 items into the long-term folder.
 *
 * The page has a ceiling, but which lines leave is a judgement call, not a
 * clock: whoever keeps the page picks the ones that have become history. Text
 * is moved verbatim, and nothing disappears from the library.
 */
export async function moveTongyouLines(root, input) {
  const key = await activeKey(root)
  const rel = tongyouRel(key)
  const abs = path.join(root, rel)
  if (!(await exists(abs))) throw new Error('还没有同游')

  const want = new Set(
    (Array.isArray(input.lines) ? input.lines : []).map((line) => String(line || '').trim()).filter(Boolean)
  )
  if (!want.size) throw new Error('没有指定要搬走的条目')

  const raw = await fs.readFile(abs, 'utf8')
  const { meta, body } = splitFrontMatter(raw)
  const { leading, items } = tongyouItems(body)

  const moveOut = []
  const stay = []
  for (const item of items) {
    if (want.has(item.label)) moveOut.push(item.raw)
    else stay.push(item.raw)
  }
  if (!moveOut.length) throw new Error('同游里没有这几条')

  const period = isPeriod(input.period) ? input.period : today().slice(0, 7)
  const archRel = longRel(key) + '/同游-' + period + '.md'
  const archAbs = path.join(root, archRel)
  const header = '## 从同游搬来 ' + today() + '\n\n'

  if (await exists(archAbs)) {
    // 追加也走原子写：先读回来拼好，再整篇写过去。appendFile 半截失败会留下
    // 一篇 front matter 后跟半个段落的残页。
    const prior = await fs.readFile(archAbs, 'utf8')
    await writeTextAtomic(archAbs, prior.replace(/\s+$/, '') + '\n\n' + header + moveOut.join('\n') + '\n', 'utf8')
  } else {
    await fs.mkdir(path.dirname(archAbs), { recursive: true })
    await writeTextAtomic(
      archAbs,
      frontMatter({
        title: '同游 · ' + period,
        summary: '搬过来的旧事',
        date: period,
        tags: ['同游', '归档'],
      }) +
        header +
        moveOut.join('\n') +
        '\n',
      'utf8'
    )
  }

  const preamble = leading.join('\n').replace(/\s+$/, '')
  const nextBody = (preamble ? preamble + '\n\n' : '') + stay.join('\n') + '\n'
  await writeTextAtomic(abs, frontMatter(meta) + nextBody, 'utf8')
  return { path: rel, archive: archRel, moved: moveOut, kept: stay.length, cap: TONGYOU_CAP, persona: key }
}

/* ------------------------------------------------------------------ */
/* Index text (what each turn sees)                                    */
/* ------------------------------------------------------------------ */

const INDEX_RULE = [
  '【不忘 · 记忆库】下面是索引（只有标题和一句话），正文不在上下文里。',
  '规则：不要主动调用记忆工具；只有用户明确要求（说“读一下那天”“用记忆回答”“翻一下手册”之类）时才调用 memory_recall。',
  '工坊默认完全不加载：用户说“搜索工坊”时用 memory_list kind=workshop 列目录，用户挑中后再用 memory_workshop 启用，启用后正文才每轮都在。',
  '工坊技能是按需开的：用户挑中的那条用 memory_workshop 打开，这件事办完就把它关掉（或提醒用户手动关），别让它一直占上下文。',
  '记忆是当时的记录，不是当下的真相；引用前先确认它还成立。',
  '称呼用户：以人格里写的为准；人格没写称呼时，就用库里记的用户姓名叫。',
].join('\n')

function mmdd(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.slice(5) : date || ''
}

/** First day still shown in the index: today minus (days - 1). */
function cutoffDay(days) {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
  return iso(first)
}

/**
 * Build the always-on index. Sizes are derived from the token budget so the
 * only knob a user turns is the budget itself.
 */
export function buildIndexText(state) {
  const settings = state.settings || {}
  const budget = BUDGET_TOKENS[settings.budget] || BUDGET_TOKENS.normal
  const charBudget = Math.max(600, Math.round(budget * 1.6))

  const blocks = []
  let used = INDEX_RULE.length

  const personaName = state.activePersona || DEFAULT_PERSONA
  const userName = settings.name || '我'

  // The active persona rides along in full: it IS the assistant's self, so it is
  // never truncated and never counted against the memory budget. Paste a whole
  // SOUL-style document here and it takes effect on the next turn.
  const persona = state.persona
  if (persona && String(persona.body || '').trim()) {
    blocks.push('【人格 · ' + personaName + '】\n' + String(persona.body).trim())
  }

  // 同游 is the always-on relationship note, also in full.
  const tongyou = state.tongyou || state.about
  if (tongyou && String(tongyou.body || '').trim()) {
    blocks.push('【同游 · ' + userName + ' 和 ' + personaName + '】\n' + String(tongyou.body).trim())
    used += String(tongyou.body).trim().length
  }

  // Shared personas are reachable, not injected: one line says the door is open.
  const shared = state.shared || []
  if (shared.length) {
    const names = shared.map((item) => item.key).join('、')
    blocks.push('【可以翻的人格 · 只读】\n- ' + names + '（读得到她们的记忆和同游，要看时再用 memory_recall）')
  }

  const recent = (state.memory && state.memory.recent) || []
  if (recent.length) {
    // Only the newest `recentDays` days ride along as individual lines. An old
    // day's detail is one question away, so listing every title would spend
    // context on things nobody is looking at right now.
    const recentDays = Math.max(1, Math.min(Number(settings.recentDays) || 3, 30))
    const cutoff = cutoffDay(recentDays)
    const shown = []
    const older = []
    for (const doc of recent) {
      const day = doc.date || ''
      if (!day || day >= cutoff) shown.push(doc)
      else older.push(doc)
    }

    const lines = []
    for (const doc of shown) {
      const line = '- ' + mmdd(doc.date) + ' ' + doc.title + (doc.summary ? ' — ' + clamp(doc.summary, 36) : '')
      if (used + line.length > charBudget) break
      lines.push(line)
      used += line.length
    }

    // Everything before the window folds into one line: it says the entries
    // exist, how many, and how far back — the date is the handle to ask for.
    if (older.length) {
      const dates = older.map((doc) => doc.date).filter(Boolean).sort()
      const fold =
        '- 还有 ' +
        older.length +
        ' 条更早的' +
        (dates.length ? '（' + dates[0] + ' ~ ' + dates[dates.length - 1] + '）' : '') +
        '，说个日期我去翻'
      lines.push(fold)
    }

    if (lines.length) blocks.push('【最近的日子】\n' + lines.join('\n'))
  }

  const archive = (state.memory && state.memory.archive) || []
  if (archive.length) {
    // One line per period. Moved day files stay in the folder for recall but do
    // not repeat themselves in the always-on index.
    //
    // What counts as a period: a whole month, the span a consolidation covered,
    // or a single day that IS the summary of that day (tagged 归档). A single
    // day file without that tag is an original that was simply moved here, and
    // listing it would duplicate the summary it already sits inside.
    const periods = archive.filter((doc) => {
      const day = String(doc.date || '')
      if (/^\d{4}-\d{2}$/.test(day) || day.indexOf('~') >= 0) return true
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(doc.tags) && doc.tags.includes('归档')
    })
    const lines = []
    for (const doc of periods.slice(0, 12)) {
      const line = '- ' + doc.title + (doc.summary ? ' — ' + clamp(doc.summary, 36) : '')
      if (used + line.length > charBudget) break
      lines.push(line)
      used += line.length
    }
    if (lines.length) blocks.push('【更早】\n' + lines.join('\n'))
  }

  // 工坊 is off by default: disabled documents stay completely out of the
  // context,目录名也不出现。The user asks to search the workshop, picks one,
  // and only then is its body injected every turn.
  const alwaysDocs = (state.workshop && state.workshop.always) || []
  if (alwaysDocs.length) {
    const parts = []
    for (const doc of alwaysDocs) {
      const text = String(doc.body || '').trim()
      if (!text || used + text.length > charBudget) continue
      parts.push('### ' + doc.title + '\n' + text)
      used += text.length
    }
    if (parts.length) blocks.push('【工坊 · 已启用（正文每轮都在）】\n' + parts.join('\n\n'))
  }

  return [INDEX_RULE, ...blocks].join('\n\n')
}

export { DEFAULTS }
export const DIRS = BASE_DIRS
